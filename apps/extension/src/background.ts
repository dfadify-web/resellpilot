/**
 * Service worker. Programa la sync (cada ~15 min con jitter), pide al content script de una
 * pestaña de vinted.es que lea la cuenta y envía el resultado al server local.
 */
import { nextSyncDelayMinutes } from '@resellpilot/shared';
import {
  SERVER,
  SYNC_ALARM,
  VINTED_MATCH,
  getState,
  setState,
  type CollectRequest,
  type CollectResponse,
  type PanelMessage,
} from './messages';

let running = false;

/** El server local no responde. */
class ServerDownError extends Error {}

async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(SERVER + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ServerDownError('ResellPilot no está en marcha en este equipo (pnpm dev).');
  }
  if (response.status === 409) throw new Error('Esta cuenta de Vinted no es la que ya está sincronizada. Cámbiala en Ajustes.');
  if (!response.ok) throw new Error(`El server local rechazó los datos (${response.status}).`);
  return (await response.json()) as T;
}

const scheduleNext = () => chrome.alarms.create(SYNC_ALARM, { delayInMinutes: nextSyncDelayMinutes() });

/** Para todas las lecturas y avisa: en el panel, en el icono y (vía server) por Telegram. */
async function pause(reason: string): Promise<void> {
  const notice = `${reason} Revisa vinted.es y pulsa «Reanudar».`;
  await setState({ paused: true, notice, lease: null });
  await chrome.alarms.clear(SYNC_ALARM);
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
    const config = await api<{ read_min_interval_s: number }>('/api/vinted/config');
    await setState({ notice: 'Leyendo tu cuenta de Vinted…', lease });

    let answer: CollectResponse | undefined;
    try {
      const request: CollectRequest = { kind: 'collect', intervalS: config.read_min_interval_s, lease };
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
    await setState({
      lastSyncAt: saved.at,
      lastSummary: `${saved.listings} anuncios · ${saved.new_events} novedades`,
      notice: saved.warning ? `Sincronizado, pero Telegram falló: ${saved.warning}` : '',
    });
  } catch (error) {
    await setState({ notice: error instanceof Error ? error.message : 'No se pudo sincronizar.' });
  } finally {
    if ((await getState()).lease === lease) await setState({ lease: null });
    running = false;
  }
}

/** Al arrancar el navegador o actualizar la extensión: retoma la programación si procede. */
async function resume(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const state = await getState();
  await chrome.action.setBadgeText({ text: state.paused ? '!' : '' });
  if (state.enabled && !state.paused && !(await chrome.alarms.get(SYNC_ALARM))) await scheduleNext();
}

chrome.runtime.onInstalled.addListener(() => void resume());
chrome.runtime.onStartup.addListener(() => void resume());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void sync();
});

chrome.runtime.onMessage.addListener((message: PanelMessage, sender, respond) => {
  // Solo el panel lateral de la propia extensión puede dar órdenes (nunca una página web).
  if (sender.id !== chrome.runtime.id || sender.tab) return;

  if (message.kind === 'activate' || message.kind === 'sync-now') {
    void (async () => {
      // Activar o reanudar es siempre una pulsación explícita del usuario.
      await setState({ enabled: true, paused: false, notice: '' });
      await chrome.action.setBadgeText({ text: '' });
      await api('/api/vinted/state', { paused: false, notice: '' }).catch(() => undefined);
      await sync();
      respond(true);
    })();
    return true;
  }

  if (message.kind === 'deactivate') {
    void (async () => {
      await setState({ enabled: false, paused: false, notice: '', lease: null });
      await chrome.alarms.clear(SYNC_ALARM);
      await chrome.action.setBadgeText({ text: '' });
      respond(true);
    })();
    return true;
  }
});
