/**
 * Service worker. Programa la sync (cada ~15 min con jitter), pide al content script de una
 * pestaña de vinted.es que lea la cuenta y envía el resultado al server local.
 */
import { nextSyncDelayMinutes, pickCommandTab } from '@resellpilot/shared';
import {
  COMMANDS_ALARM,
  SERVER,
  SYNC_ALARM,
  VINTED_MATCH,
  getState,
  setState,
  type CollectRequest,
  type CollectResponse,
  type CommandInfo,
  type ContentMessage,
  type PanelMessage,
  type RunCommandRequest,
  type TrendsRequest,
  type TrendsResponse,
} from './messages';

let running = false;

/** El server local no responde. */
class ServerDownError extends Error {}

async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(SERVER + path, {
      method: body === undefined ? 'GET' : 'POST',
      // Chrome no siempre envía Origin desde la extensión: esta cabecera la identifica ante el server.
      headers: {
        'x-resellpilot-client': 'extension',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ServerDownError('ResellPilot no está en marcha en este equipo (pnpm dev).');
  }
  if (response.status === 409) throw new Error('Esta cuenta de Vinted no es la que ya está sincronizada. Cámbiala en Ajustes.');
  if (response.status === 403) {
    throw new Error('ResellPilot no reconoce la extensión (403). Actualiza el server (reinicia pnpm dev) y recarga la extensión.');
  }
  if (!response.ok) throw new Error(`El server local rechazó los datos (${response.status}).`);
  return (await response.json()) as T;
}

const scheduleNext = () => chrome.alarms.create(SYNC_ALARM, { delayInMinutes: nextSyncDelayMinutes() });

/** Para todas las lecturas y avisa: en el panel, en el icono y (vía server) por Telegram. */
async function pause(reason: string): Promise<void> {
  const notice = `${reason} Revisa vinted.es y pulsa «Reanudar».`;
  await setState({ paused: true, notice, lease: null });
  await chrome.alarms.clear(SYNC_ALARM);
  await chrome.alarms.clear(COMMANDS_ALARM);
  await chrome.action.setBadgeBackgroundColor({ color: '#ff4b1f' });
  await chrome.action.setBadgeText({ text: '!' });
  await api('/api/vinted/state', { paused: true, notice: reason }).catch(() => undefined);
}

async function sync(): Promise<void> {
  if (running) return;
  running = true;
  // La siguiente sync se programa ya: si el service worker muere a mitad, la cadena no se corta.
  await scheduleNext();
  const lease = crypto.randomUUID();

  try {
    const state = await getState();
    if (!state.enabled || state.paused) {
      await chrome.alarms.clear(SYNC_ALARM);
      return;
    }

    const tabs = await chrome.tabs.query({ url: VINTED_MATCH, discarded: false });
    const tab = tabs.find((candidate) => candidate.active) ?? tabs[0];
    if (tab?.id === undefined) {
      await setState({ notice: 'Abre una pestaña de vinted.es para sincronizar.' });
      return;
    }

    // Primero el server: si no está, no se hace ni una petición a Vinted.
    const config = await api<{ read_min_interval_s: number; trend_queries?: string[]; inbox_since?: string | null }>('/api/vinted/config');
    await setState({ notice: 'Leyendo tu cuenta de Vinted…', lease });

    let answer: CollectResponse | undefined;
    try {
      const request: CollectRequest = { kind: 'collect', intervalS: config.read_min_interval_s, lease, inboxSince: config.inbox_since ?? null };
      answer = await chrome.tabs.sendMessage(tab.id, request);
    } catch {
      await setState({ notice: 'Recarga la pestaña de vinted.es (F5) y pulsa «Sincronizar ahora».' });
      return;
    }

    if (!answer) return;
    if (!answer.ok) {
      if (answer.stop) await pause(answer.message);
      else if ((await getState()).lease === lease) await setState({ notice: answer.message });
      return;
    }

    const saved = await api<{ at: string; listings: number; new_events: number; warning: string | null }>(
      '/api/vinted/sync',
      answer.payload,
    );
    const warning = saved.warning ? `Sincronizado, pero Telegram falló: ${saved.warning}` : '';
    const summary = `${saved.listings} anuncios · ${saved.new_events} novedades`;
    await setState({ lastSyncAt: saved.at, lastSummary: summary, notice: warning });

    // Tendencias (Fase 4): búsquedas públicas que el server dice que toca medir ahora.
    const queries = config.trend_queries ?? [];
    if (queries.length === 0) return;
    await setState({ notice: `Midiendo tendencias (${queries.length} búsquedas)…` });

    const trendsRequest: TrendsRequest = { kind: 'trends', queries, intervalS: config.read_min_interval_s, lease };
    let trends: TrendsResponse | undefined;
    try {
      trends = await chrome.tabs.sendMessage(tab.id, trendsRequest);
    } catch {
      await setState({ notice: warning });
      return;
    }
    if (!trends) return;
    if (!trends.ok) {
      if (trends.stop) await pause(trends.message);
      else if ((await getState()).lease === lease) await setState({ notice: trends.message });
      return;
    }
    await api('/api/vinted/trends', trends.payload);
    await setState({ lastSummary: `${summary} · ${queries.length} tendencias`, notice: warning });
  } catch (error) {
    await setState({ notice: error instanceof Error ? error.message : 'No se pudo sincronizar.' });
  } finally {
    if ((await getState()).lease === lease) await setState({ lease: null });
    running = false;
  }
}

/**
 * Comandos confirmados en el dashboard (Fase 5). Se entregan a una pestaña de vinted.es, que es
 * donde se ejecutan con el overlay y el botón PARAR. Si ya hay uno en marcha, la pestaña lo ignora.
 */
async function checkCommands(): Promise<void> {
  const state = await getState();
  if (!state.enabled || state.paused) return;
  let command: CommandInfo | null;
  try {
    command = (await api<{ command: CommandInfo | null }>('/api/vinted/commands/next')).command;
  } catch {
    return;
  }
  if (!command) {
    if (state.commandRun) await setState({ commandRun: null });
    return;
  }
  const tabs = await chrome.tabs.query({ url: VINTED_MATCH, discarded: false });
  // Siempre la misma pestaña mientras exista: si no, al cambiar de pestaña correría en dos a la vez.
  const tabId = pickCommandTab(tabs, state.commandRun, command.id);
  if (tabId === null) {
    await setState({ notice: 'Hay ofertas confirmadas: abre una pestaña de vinted.es para ejecutarlas.' });
    return;
  }
  if (state.commandRun?.id !== command.id || state.commandRun.tabId !== tabId) {
    await setState({ commandRun: { id: command.id, tabId } });
  }
  const request: RunCommandRequest = { kind: 'run-command', command };
  await chrome.tabs.sendMessage(tabId, request).catch(() => undefined);
}

/**
 * Búsquedas pedidas desde el dashboard (Calculadora, Oportunidades, Tendencias). Se miden enseguida, en la
 * pestaña de vinted.es y con las mismas reglas que las tendencias: ritmo mínimo, límite por hora y parada
 * ante 403, 429 o verificación.
 */
async function searchNow(): Promise<void> {
  if (running) return;
  const state = await getState();
  if (!state.enabled || state.paused) return;

  let next: { queries: string[]; read_min_interval_s: number };
  try {
    next = await api('/api/vinted/searches/next');
  } catch {
    return;
  }
  if (next.queries.length === 0) return;

  const tabs = await chrome.tabs.query({ url: VINTED_MATCH, discarded: false });
  const tab = tabs.find((candidate) => candidate.active) ?? tabs[0];
  if (tab?.id === undefined) {
    await setState({ notice: 'Hay búsquedas de precio pendientes: abre una pestaña de vinted.es.' });
    return;
  }

  running = true;
  const lease = crypto.randomUUID();
  try {
    await setState({ notice: `Buscando precios en Vinted (${next.queries.length})…`, lease });
    const request: TrendsRequest = { kind: 'trends', queries: next.queries, intervalS: next.read_min_interval_s, lease };
    let trends: TrendsResponse | undefined;
    try {
      trends = await chrome.tabs.sendMessage(tab.id, request);
    } catch {
      await setState({ notice: 'Recarga la pestaña de vinted.es (F5) para buscar precios.' });
      return;
    }
    if (!trends) return;
    if (!trends.ok) {
      if (trends.stop) await pause(trends.message);
      else if ((await getState()).lease === lease) await setState({ notice: trends.message });
      return;
    }
    await api('/api/vinted/trends', trends.payload);
    await setState({ notice: '' });
  } catch (error) {
    await setState({ notice: error instanceof Error ? error.message : 'No se pudieron buscar los precios.' });
  } finally {
    if ((await getState()).lease === lease) await setState({ lease: null });
    running = false;
  }
}

// Cada 30 s (el mínimo de Chrome): comandos confirmados y búsquedas de precio pedidas.
const scheduleCommands = () => chrome.alarms.create(COMMANDS_ALARM, { periodInMinutes: 0.5 });

/** Al arrancar el navegador o actualizar la extensión: retoma la programación si procede. */
async function resume(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const state = await getState();
  await chrome.action.setBadgeText({ text: state.paused ? '!' : '' });
  if (state.enabled && !state.paused) {
    if (!(await chrome.alarms.get(SYNC_ALARM))) await scheduleNext();
    await scheduleCommands();
  }
}

// Al instalar o actualizar la extensión se borran los avisos viejos (p. ej. el de una versión anterior).
chrome.runtime.onInstalled.addListener(() => void setState({ notice: '' }).then(resume));
chrome.runtime.onStartup.addListener(() => void resume());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void sync();
  if (alarm.name === COMMANDS_ALARM) void checkCommands().then(searchNow);
});

chrome.runtime.onMessage.addListener((message: PanelMessage | ContentMessage, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;

  // Content script de vinted.es: pide el siguiente paso de un comando o lo cancela (PARAR).
  if (sender.tab) {
    if (!sender.url?.startsWith('https://www.vinted.es/')) return;
    if (message.kind === 'command-step') {
      api(`/api/vinted/commands/${message.id}/step`, { last: message.last })
        .then(respond)
        .catch((error: unknown) => respond({ action: 'error', message: error instanceof Error ? error.message : 'Error' }));
      return true;
    }
    if (message.kind === 'command-cancel') {
      api(`/api/vinted/commands/${message.id}/cancel`, {})
        .then(() => respond(true))
        .catch(() => respond(false));
      return true;
    }
    return;
  }

  // Panel lateral de la propia extensión: activar, sincronizar o desactivar.

  if (message.kind === 'activate' || message.kind === 'sync-now') {
    void (async () => {
      // Activar o reanudar es siempre una pulsación explícita del usuario.
      await setState({ enabled: true, paused: false, notice: '' });
      await chrome.action.setBadgeText({ text: '' });
      await api('/api/vinted/state', { paused: false, notice: '' }).catch(() => undefined);
      await scheduleCommands();
      await sync();
      await checkCommands();
      await searchNow();
      respond(true);
    })();
    return true;
  }

  if (message.kind === 'deactivate') {
    void (async () => {
      await setState({ enabled: false, paused: false, notice: '', lease: null, commandRun: null });
      await chrome.alarms.clear(SYNC_ALARM);
      await chrome.alarms.clear(COMMANDS_ALARM);
      await chrome.action.setBadgeText({ text: '' });
      respond(true);
    })();
    return true;
  }
});
