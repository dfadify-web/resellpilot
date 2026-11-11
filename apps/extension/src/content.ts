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
  type RawSearchCard,
  type RawSearchResult,
  type SyncEvent,
  type SyncListing,
  type SyncPayload,
} from '@resellpilot/shared';
import { runCommand } from './commands';
import {
  getState,
  type CollectRequest,
  type CollectResponse,
  type RunCommandRequest,
  type TrendsPayload,
  type TrendsRequest,
  type TrendsResponse,
} from './messages';

/** Vinted ha respondido algo que obliga a parar todas las lecturas (Regla 5). */
class StopError extends Error {}
/** La lectura se canceló desde el panel o empezó otra. */
class CancelledError extends Error {}

const WARDROBE_PER_PAGE = 50;
const WARDROBE_MAX_PAGES = 20;
/** Solo las notificaciones recientes: las antiguas ya se guardaron en syncs anteriores. */
const NOTIFICATION_PAGES = 2;
const TIMEOUT_MS = 30_000;

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

  async function read(path: string, accept: string): Promise<{ status: number; body: string }> {
    const wait = last + intervalS * 1000 - Date.now();
    if (wait > 0) await sleep(wait);

    const state = await getState();
    if (!state.enabled || state.paused || state.lease !== lease) throw new CancelledError('Lectura cancelada.');
    assertNoChallenge();

    last = Date.now();
    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        redirect: 'manual',
        cache: 'no-store',
        headers: { accept },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { status: response.status, body: await response.text().catch(() => '') };
    } catch {
      throw new Error('No se pudo conectar con vinted.es. Se reintentará en la próxima sync.');
    }
  }

  return {
    async json(path: string): Promise<unknown> {
      const { status, body } = await read(path, 'application/json');
      let json: unknown;
      let isJson = false;
      try {
        json = JSON.parse(body);
        isJson = true;
      } catch {
        // Cuerpo no JSON: captcha, página de error o redirección.
      }
      const stop = classifyResponse(status, isJson);
      if (stop !== null) throw new StopError(VINTED_STOP_MESSAGES[stop]);
      return json;
    },

    /** Página HTML pública (resultados de búsqueda). */
    async document(path: string): Promise<Document> {
      const { status, body } = await read(path, 'text/html');
      const stop = classifyResponse(status, true);
      if (stop !== null) throw new StopError(VINTED_STOP_MESSAGES[stop]);
      const doc = new DOMParser().parseFromString(body, 'text/html');
      // Una página sin el buscador del catálogo no es la de resultados: captcha o verificación.
      if (!doc.querySelector('[data-testid="search-text--input"], [data-testid="grid-item"]')) {
        throw new StopError(VINTED_STOP_MESSAGES.verification);
      }
      return doc;
    },
  };
}

// ───────────────────────── cuenta (Fase 3) ─────────────────────────

async function collect({ intervalS, lease }: CollectRequest): Promise<SyncPayload> {
  const readJson = createReader(intervalS, lease).json;

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

// ───────────────────────── búsquedas públicas (Fase 4) ─────────────────────────

/** Tarjetas de la primera página de resultados: id, precio y favoritos (ningún dato de vendedores). */
function extractCards(doc: Document): RawSearchCard[] {
  const cards: RawSearchCard[] = [];
  for (const item of doc.querySelectorAll('[data-testid="grid-item"]')) {
    const holder = item.querySelector('[data-testid^="product-item-id-"]');
    const id = /^product-item-id-(\d+)/.exec(holder?.getAttribute('data-testid') ?? '')?.[1];
    if (!id) continue;
    cards.push({
      id,
      price_text: (item.querySelector('[data-testid$="--price-text"]')?.textContent ?? '').trim().slice(0, 40),
      favs_text: (item.querySelector('[data-testid="favourite-count-text"]')?.textContent ?? '').trim().slice(0, 20),
    });
  }
  return cards.slice(0, 300);
}

async function measureTrends({ queries, intervalS, lease }: TrendsRequest): Promise<TrendsPayload> {
  const reader = createReader(intervalS, lease);

  // Calibración: el id más alto de lo recién publicado equivale a "ahora".
  const newest = extractCards(await reader.document('/catalog?order=newest_first'));
  const maxId = newest.reduce((max, card) => Math.max(max, Number(card.id)), 0);

  const results: RawSearchResult[] = [];
  for (const query of queries) {
    const doc = await reader.document(`/catalog?search_text=${encodeURIComponent(query)}`);
    const total = /\d[\d.\s]*\+?\s*resultados?/i.exec(doc.body?.textContent ?? '')?.[0] ?? '';
    results.push({ query, cards: extractCards(doc), total_text: total.trim().slice(0, 60) });
  }
  return { max_id_now: maxId > 0 ? maxId : null, results };
}

// ───────────────────────── mensajes del service worker ─────────────────────────

type Request = CollectRequest | TrendsRequest | RunCommandRequest;
type Response = CollectResponse | TrendsResponse;

chrome.runtime.onMessage.addListener((message: Request, sender, respond: (response: Response) => void) => {
  // Solo se atiende al service worker de la propia extensión.
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  if (message?.kind === 'run-command') {
    // Fase 5: se ejecuta aquí, en la pestaña, con overlay y botón PARAR.
    void runCommand(message.command);
    return;
  }
  if (message?.kind !== 'collect' && message?.kind !== 'trends') return;

  const work: Promise<Response> =
    message.kind === 'collect'
      ? collect(message).then((payload) => ({ ok: true as const, payload }))
      : measureTrends(message).then((payload) => ({ ok: true as const, payload }));

  work.then(respond).catch((error: unknown) => {
    const stop = error instanceof StopError || error instanceof VintedFormatError;
    respond({ ok: false, stop, message: error instanceof Error ? error.message : 'No se pudo leer Vinted.' });
  });
  return true;
});
