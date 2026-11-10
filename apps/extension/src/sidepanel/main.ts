import { VINTED_MATCH, getState, type PanelMessage } from '../messages';

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

async function render(): Promise<void> {
  const state = await getState();
  const tabs = await chrome.tabs.query({ url: VINTED_MATCH });

  let label: string;
  let tone: 'on' | 'warn' | 'off';
  if (!state.enabled) [label, tone] = ['Sin activar', 'off'];
  else if (state.paused) [label, tone] = ['En pausa', 'warn'];
  else if (tabs.length === 0) [label, tone] = ['Desconectado', 'off'];
  else [label, tone] = [state.lease ? 'Sincronizando…' : 'Conectado', 'on'];

  stateText.textContent = label;
  stateRow.dataset.tone = tone;
  lastSync.textContent = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString('es-ES') : 'Todavía no';
  summary.textContent = state.lastSummary ?? '';
  notice.textContent =
    state.notice || (state.enabled && tabs.length === 0 ? 'Abre una pestaña de vinted.es para sincronizar.' : '');
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
