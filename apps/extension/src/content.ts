/**
 * Content script de vinted.es. Lee la cuenta del usuario con su propia sesión del navegador:
 * peticiones GET del mismo origen, sin tocar cookies ni tokens y sin escribir nada en Vinted.
 * Endpoints documentados en `docs/vinted-endpoints.md`.
 */
import {
  VINTED_STOP_MESSAGES,
  VintedFormatError,
  classifyResponse,
  parseInboxPage,
  parseNotificationsPage,
  parseWardrobePage,
  toId,
  type Page,
  type SyncEvent,
  type SyncListing,
  type SyncPayload,
} from '@resellpilot/shared';
import { getState, type CollectRequest, type CollectResponse } from './messages';

/** Vinted ha respondido algo que obliga a parar todas las lecturas (Regla 5). */
class StopError extends Error {}
/** La lectura se canceló desde el panel o empezó otra. */
class CancelledError extends Error {}

const WARDROBE_PER_PAGE = 50;
const WARDROBE_MAX_PAGES = 20;
/** Solo las notificaciones recientes: las antiguas ya se guardaron en syncs anteriores. */
const NOTIFICATION_PAGES = 2;
const TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function assertNoChallenge(): void {
  const challenge = document.querySelector(
    'iframe[src*="captcha-delivery"], iframe[src*="challenges.cloudflare"], #challenge-form, #px-captcha',
  );
  if (challenge || /captcha|just a moment|verif(y|ica)/i.test(document.title)) {
    throw new StopError(VINTED_STOP_MESSAGES.verification);
  }
}

/** Lector con ritmo: una petición cada `intervalS` segundos como mínimo. */
function createReader(intervalS: number, lease: string) {
  let last = 0;

  return async function readJson(path: string): Promise<unknown> {
    const wait = last + intervalS * 1000 - Date.now();
    if (wait > 0) await sleep(wait);

    const state = await getState();
    if (!state.enabled || state.paused || state.lease !== lease) throw new CancelledError('Lectura cancelada.');
    assertNoChallenge();

    last = Date.now();
    let response: Response;
    try {
      response = await fetch(path, {
        credentials: 'same-origin',
        redirect: 'manual',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error('No se pudo conectar con vinted.es. Se reintentará en la próxima sync.');
    }

    const body = await response.text().catch(() => '');
    let json: unknown;
    let isJson = false;
    try {
      json = JSON.parse(body);
      isJson = true;
    } catch {
      // Cuerpo no JSON: captcha, página de error o redirección.
    }

    const stop = classifyResponse(response.status, isJson);
    if (stop !== null) throw new StopError(VINTED_STOP_MESSAGES[stop]);
    return json;
  };
}

async function collect({ intervalS, lease }: CollectRequest): Promise<SyncPayload> {
  const readJson = createReader(intervalS, lease);

  const current = (await readJson('/api/v2/users/current')) as { user?: { id?: unknown } } | null;
  const account = toId(current?.user?.id);
  if (!account) throw new StopError(VINTED_STOP_MESSAGES.logged_out);

  // Armario completo (paginado).
  const listings: SyncListing[] = [];
  let listingsComplete = false;
  for (let page = 1; page <= WARDROBE_MAX_PAGES; page++) {
    const result: Page<SyncListing> = parseWardrobePage(
      await readJson(`/api/v2/wardrobe/${account}/items?page=${page}&per_page=${WARDROBE_PER_PAGE}&order=relevance`),
    );
    listings.push(...result.rows);
    if (page >= result.totalPages || result.rows.length === 0) {
      listingsComplete = true;
      break;
    }
  }

  // Notificaciones recientes. Aviso: leerlas las marca como leídas en Vinted (igual que abrir la campana).
  const events: SyncEvent[] = [];
  for (let page = 1; page <= NOTIFICATION_PAGES; page++) {
    const result = parseNotificationsPage(await readJson(`/web/api/notifications/notifications?page=${page}&per_page=20`));
    events.push(...result.rows);
    if (page >= result.totalPages) break;
  }

  // Bandeja: solo la lista (no se abre ninguna conversación).
  const inbox = parseInboxPage(await readJson('/api/v2/inbox?page=1&per_page=20'));
  const conversationUserIds = new Set<string>();
  for (const conversation of inbox.rows) {
    if (conversation.user_id) conversationUserIds.add(conversation.user_id);
    if (conversation.event) events.push(conversation.event);
  }

  const unique = <T, K>(rows: T[], key: (row: T) => K): T[] => [...new Map(rows.map((row) => [key(row), row])).values()];
  return {
    account,
    listings: unique(listings, (row) => row.vinted_id),
    listings_complete: listingsComplete,
    events: unique(events, (row) => row.vinted_id),
    conversation_user_ids: [...conversationUserIds],
  };
}

chrome.runtime.onMessage.addListener((message: CollectRequest, sender, respond: (response: CollectResponse) => void) => {
  // Solo se atiende al service worker de la propia extensión.
  if (sender.id !== chrome.runtime.id || sender.tab || message?.kind !== 'collect') return;

  collect(message)
    .then((payload) => respond({ ok: true, payload }))
    .catch((error: unknown) => {
      const stop = error instanceof StopError || error instanceof VintedFormatError;
      const message = error instanceof Error ? error.message : 'No se pudo leer Vinted.';
      respond({ ok: false, stop, message });
    });
  return true;
});
