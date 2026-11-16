import { SERVER, VINTED_MATCH, getState, type PanelMessage } from '../messages';

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta #${id} en el panel`);
  return element as T;
};

const stateRow = byId('estado-fila');
const stateText = byId('estado');
const lastSync = byId('ultima-sync');
const summary = byId('resumen');
const notice = byId('aviso');
const action = byId<HTMLButtonElement>('accion');
const deactivate = byId<HTMLButtonElement>('desactivar');

let busy = false;

const SERVER_DOWN =
  'ResellPilot no está en marcha en este equipo. Abre una terminal en la carpeta resellpilot, ejecuta «pnpm dev» y vuelve a pulsar el botón.';

/** ¿Responde el server local? Se comprueba en cada repintado para no mostrar «Conectado» con el server apagado. */
async function serverUp(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function render(): Promise<void> {
  const [state, tabs, up] = await Promise.all([getState(), chrome.tabs.query({ url: VINTED_MATCH }), serverUp()]);

  let label: string;
  let tone: 'on' | 'warn' | 'off';
  if (!up) [label, tone] = ['Server apagado', 'warn'];
  else if (!state.enabled) [label, tone] = ['Sin activar', 'off'];
  else if (state.paused) [label, tone] = ['En pausa', 'warn'];
  else if (tabs.length === 0) [label, tone] = ['Desconectado', 'off'];
  else [label, tone] = [state.lease ? 'Sincronizando…' : 'Conectado', 'on'];

  stateText.textContent = label;
  stateRow.dataset.tone = tone;
  lastSync.textContent = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString('es-ES') : 'Todavía no';
  summary.textContent = state.lastSummary ?? '';
  notice.textContent = !up
    ? SERVER_DOWN
    : state.notice || (state.enabled && tabs.length === 0 ? 'Abre una pestaña de vinted.es para sincronizar.' : '');
  notice.hidden = notice.textContent === '';

  action.textContent = !state.enabled ? 'Activar lectura' : state.paused ? 'Reanudar' : 'Sincronizar ahora';
  action.disabled = busy || state.lease !== null;
  deactivate.hidden = !state.enabled;
}

async function send(message: PanelMessage): Promise<void> {
  busy = true;
  await render();
  try {
    await chrome.runtime.sendMessage(message);
  } finally {
    busy = false;
    await render();
  }
}

action.addEventListener('click', () => {
  void getState().then((state) => send({ kind: state.enabled ? 'sync-now' : 'activate' }));
});
deactivate.addEventListener('click', () => void send({ kind: 'deactivate' }));

chrome.storage.onChanged.addListener(() => void render());
chrome.tabs.onUpdated.addListener(() => void render());
chrome.tabs.onRemoved.addListener(() => void render());
void render();
// El server puede arrancarse o pararse con el panel abierto.
setInterval(() => void render(), 10_000);
