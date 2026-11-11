import type { RawSearchResult, SyncPayload } from '@resellpilot/shared';

/** Background → content script: búsquedas públicas a medir (Fase 4). */
export interface TrendsRequest {
  kind: 'trends';
  queries: string[];
  intervalS: number;
  lease: string;
}

export interface TrendsPayload {
  /** Id más reciente del catálogo ahora mismo, para estimar antigüedades. */
  max_id_now: number | null;
  results: RawSearchResult[];
}

export type TrendsResponse = { ok: true; payload: TrendsPayload } | { ok: false; stop: boolean; message: string };

export const VINTED_MATCH = 'https://www.vinted.es/*';
export const SERVER = 'http://127.0.0.1:4317';
export const DASHBOARD_URL = 'http://localhost:4317';
export const SYNC_ALARM = 'resellpilot-sync';

/** Estado guardado en `chrome.storage.local`. Nunca contiene datos de sesión de Vinted. */
export interface PanelState {
  /** El usuario ha activado la lectura de su cuenta. */
  enabled: boolean;
  /** La extensión se paró sola (403, 429, captcha…). Solo se reanuda a mano. */
  paused: boolean;
  /** Mensaje para el panel. */
  notice: string;
  lastSyncAt: string | null;
  lastSummary: string | null;
  /** Identifica la lectura en curso: si cambia, el content script se detiene. */
  lease: string | null;
}

export const DEFAULT_STATE: PanelState = {
  enabled: false,
  paused: false,
  notice: '',
  lastSyncAt: null,
  lastSummary: null,
  lease: null,
};

export const getState = async (): Promise<PanelState> =>
  (await chrome.storage.local.get(DEFAULT_STATE as unknown as Record<string, unknown>)) as unknown as PanelState;

export const setState = (patch: Partial<PanelState>): Promise<void> => chrome.storage.local.set(patch);

/** Panel → background. */
export type PanelMessage = { kind: 'activate' } | { kind: 'sync-now' } | { kind: 'deactivate' };

/** Background → content script. */
export interface CollectRequest {
  kind: 'collect';
  /** Segundos mínimos entre lecturas (READ_MIN_INTERVAL_S). */
  intervalS: number;
  lease: string;
}

/** Content script → background. */
export type CollectResponse =
  | { ok: true; payload: SyncPayload }
  /** `stop: true` = Vinted ha respondido algo que obliga a parar (Regla 5). */
  | { ok: false; stop: boolean; message: string };
