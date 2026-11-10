/**
 * Lectura de la cuenta de Vinted (Fase 3): tipos del snapshot que la extensión envía al server
 * y normalizadores puros de las respuestas de vinted.es. Ver `docs/vinted-endpoints.md`.
 */

const DAY_MS = 86_400_000;

// ───────────────────────── tipos ─────────────────────────

/** Estado de un anuncio, derivado de los flags de Vinted. `no_visible` lo pone el server. */
export const LISTING_STATUSES = [
  'activo',
  'reservado',
  'vendido',
  'oculto',
  'borrador',
  'cerrado',
  'no_visible',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  activo: 'Activo',
  reservado: 'Reservado',
  vendido: 'Vendido',
  oculto: 'Oculto',
  borrador: 'Borrador',
  cerrado: 'Cerrado',
  no_visible: 'Ya no está',
};

export const NOTIFICATION_TYPES = ['favorito', 'mensaje', 'venta', 'otro'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  favorito: 'Favorito',
  mensaje: 'Mensaje',
  venta: 'Venta',
  otro: 'Otro',
};

/** Anuncio tal como lo envía la extensión. */
export interface SyncListing {
  vinted_id: string;
  title: string;
  price: number | null;
  status: Exclude<ListingStatus, 'no_visible'>;
  favs: number;
  views: number;
  listed_at: string | null;
}

/** Notificación o mensaje tal como lo envía la extensión. */
export interface SyncEvent {
  /** Único y estable: `n:<id>` para notificaciones, `m:<conversación>:<fecha>` para mensajes. */
  vinted_id: string;
  type: NotificationType;
  text: string;
  /** `vinted_id` del anuncio al que se refiere, si se conoce. */
  listing_vinted_id: string | null;
  user_id: string | null;
  username: string | null;
  at: string | null;
  read: boolean;
}

export interface SyncPayload {
  /** Id numérico de la cuenta de Vinted (no es un secreto; evita mezclar dos cuentas). */
  account: string;
  listings: SyncListing[];
  /** `true` si se leyeron todas las páginas del armario. */
  listings_complete: boolean;
  events: SyncEvent[];
  /** Ids de usuarios con los que ya hay conversación. */
  conversation_user_ids: string[];
}

/** Fila de `listings` tal como la devuelve la API del dashboard. */
export interface ListingView {
  id: number;
  vinted_id: string;
  title: string;
  price: number | null;
  status: ListingStatus;
  favs: number;
  views: number;
  listed_at: string | null;
  last_seen_at: string | null;
  item_id: number | null;
  item_name: string | null;
  days_listed: number | null;
  stale: boolean;
}

export interface NotificationView {
  id: number;
  vinted_id: string | null;
  type: NotificationType;
  text: string | null;
  listing_id: number | null;
  listing_title: string | null;
  read: boolean;
  created_at: string;
}

/** Estado de la conexión con la extensión, para el dashboard. */
export interface VintedStatus {
  last_sync_at: string | null;
  /** `true` si la extensión se pausó sola (403, 429, captcha, sesión cerrada…). */
  paused: boolean;
  notice: string | null;
  account: string | null;
}

// ───────────────────────── utilidades ─────────────────────────

type Raw = Record<string, unknown>;

const asObject = (value: unknown): Raw =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};

/** Id de Vinted como texto: entero seguro o cadena corta sin espacios. */
export function toId(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value === 'string') return /^[\w-]{1,64}$/.test(value) ? value : null;
  return null;
}

const toText = (value: unknown, max = 400): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, max);
};

const toCount = (value: unknown): number => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

/** Precio: `{ amount: "20.0" }`, número o texto con punto decimal. */
const toPrice = (value: unknown): number | null => {
  const raw = asObject(value).amount ?? value;
  const number = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
};

/** Fecha ISO a partir de un timestamp Unix (segundos o ms) o de un texto ISO. */
export function toIso(value: unknown): string | null {
  const ms =
    typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/** Vinted cambió el formato de una respuesta: se para la lectura en vez de guardar basura. */
export class VintedFormatError extends Error {
  constructor(what: string) {
    super(`Vinted cambió el formato de ${what}. La lectura se detiene hasta revisar la extensión.`);
    this.name = 'VintedFormatError';
  }
}

export interface Page<T> {
  rows: T[];
  totalPages: number;
}

function pageOf<T>(json: unknown, key: string, what: string, normalize: (raw: Raw) => T | null): Page<T> {
  const data = asObject(json);
  const list = data[key];
  if (!Array.isArray(list)) throw new VintedFormatError(what);
  const rows = list.map((entry) => normalize(asObject(entry))).filter((row): row is T => row !== null);
  // Si había filas y ninguna se entiende, el formato ha cambiado.
  if (list.length > 0 && rows.length === 0) throw new VintedFormatError(what);
  const total = asObject(data.pagination).total_pages;
  return { rows, totalPages: typeof total === 'number' && total >= 1 ? Math.floor(total) : 1 };
}

// ───────────────────────── armario ─────────────────────────

function listingStatus(raw: Raw): SyncListing['status'] {
  if (raw.is_draft === true) return 'borrador';
  if (raw.item_closing_action === 'sold') return 'vendido';
  if (raw.is_closed === true) return 'cerrado';
  if (raw.is_reserved === true) return 'reservado';
  if (raw.is_hidden === true) return 'oculto';
  return 'activo';
}

/**
 * Anuncio de `GET /api/v2/wardrobe/{user}/items`.
 * La fecha de publicación no viene como campo: se usa la de subida de la primera foto.
 */
export function normalizeListing(raw: Raw): SyncListing | null {
  const id = toId(raw.id);
  const title = toText(raw.title, 300);
  if (!id || !title) return null;

  const photos = Array.isArray(raw.photos) ? raw.photos.map(asObject) : [];
  const timestamps = photos
    .map((photo) => asObject(photo.high_resolution).timestamp)
    .map((value) => (typeof value === 'string' ? Number(value) : value))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  return {
    vinted_id: id,
    title,
    price: toPrice(raw.price),
    status: listingStatus(raw),
    favs: toCount(raw.favourite_count),
    views: toCount(raw.view_count),
    listed_at: toIso(raw.created_at_ts ?? raw.created_at) ?? (timestamps.length > 0 ? toIso(Math.min(...timestamps)) : null),
  };
}

export const parseWardrobePage = (json: unknown): Page<SyncListing> =>
  pageOf(json, 'items', 'el armario', normalizeListing);

// ───────────────────────── notificaciones ─────────────────────────

/** `entry_type` de Vinted para "X ha marcado como favorito tu artículo". */
const ENTRY_FAVOURITE = 20;

function notificationType(entryType: unknown, text: string): NotificationType {
  if (entryType === ENTRY_FAVOURITE || /marcado como favorito|favorit/i.test(text)) return 'favorito';
  if (/has vendido|se ha vendido|ha comprado|vendid[oa]/i.test(text)) return 'venta';
  if (/mensaje/i.test(text)) return 'mensaje';
  return 'otro';
}

/** Notificación de `GET /web/api/notifications/notifications`. */
export function normalizeNotification(raw: Raw): SyncEvent | null {
  const id = toId(raw.id);
  const text = toText(raw.body);
  if (!id || !text) return null;

  const type = notificationType(raw.entry_type, text);
  const link = typeof raw.link === 'string' ? raw.link : '';
  const linkedItem = /\/items\/(\d+)/.exec(link)?.[1] ?? null;
  // En los favoritos el cuerpo empieza por el nombre de usuario: "ana ha marcado como favorito…".
  const username = type === 'favorito' ? (/^(\S{1,60}) ha marcado/.exec(text)?.[1] ?? null) : null;

  return {
    vinted_id: `n:${id}`,
    type,
    text,
    listing_vinted_id: linkedItem ?? (type === 'favorito' ? toId(raw.subject_id) : null),
    user_id: toId(raw.user_id),
    username,
    at: toIso(raw.updated_at),
    read: raw.is_read === true,
  };
}

export const parseNotificationsPage = (json: unknown): Page<SyncEvent> =>
  pageOf(json, 'notifications', 'las notificaciones', normalizeNotification);

// ───────────────────────── bandeja de mensajes ─────────────────────────

export interface SyncConversation {
  user_id: string | null;
  /** Evento "mensaje nuevo" si la conversación tiene mensajes sin leer. */
  event: SyncEvent | null;
}

/**
 * Conversación de `GET /api/v2/inbox`. La lista solo trae un resumen: quién, si hay algo
 * sin leer y cuándo se actualizó. No se abre ninguna conversación (eso la marcaría como leída).
 */
export function normalizeConversation(raw: Raw): SyncConversation | null {
  const id = toId(raw.id);
  if (!id) return null;
  const user = asObject(raw.opposite_user);
  const userId = toId(user.id);
  const username = toText(user.login, 60);
  const at = toIso(raw.updated_at);

  const event: SyncEvent | null =
    raw.unread === true && at
      ? {
          vinted_id: `m:${id}:${at}`,
          type: 'mensaje',
          text: `${username ?? 'Alguien'}: ${toText(raw.description, 200) ?? 'mensaje nuevo'}`,
          listing_vinted_id: null,
          user_id: userId,
          username,
          at,
          read: false,
        }
      : null;
  return { user_id: userId, event };
}

export const parseInboxPage = (json: unknown): Page<SyncConversation> =>
  pageOf(json, 'conversations', 'la bandeja de mensajes', normalizeConversation);

// ───────────────────────── reglas de la sync ─────────────────────────

/** Sync cada 15 min con jitter de ±2 min. `random` en [0, 1). */
export function nextSyncDelayMinutes(random: number = Math.random()): number {
  return 13 + Math.min(Math.max(random, 0), 1) * 4;
}

/** Días completos que lleva publicado un anuncio. */
export function daysListed(listedAt: string | null, now: Date = new Date()): number | null {
  if (!listedAt) return null;
  const ms = now.getTime() - Date.parse(listedAt);
  return Number.isNaN(ms) ? null : Math.max(0, Math.floor(ms / DAY_MS));
}

/** Stale: anuncio aún en venta que lleva más de `staleDays` días publicado. */
export function isStale(
  listing: { status: string | null; listed_at: string | null },
  staleDays: number,
  now: Date = new Date(),
): boolean {
  if (listing.status !== 'activo') return false;
  const days = daysListed(listing.listed_at, now);
  return days !== null && days > staleDays;
}

/** Respuestas de Vinted que obligan a parar (Regla 5). */
export type VintedStop = 'blocked' | 'rate_limited' | 'logged_out' | 'verification' | 'redirect' | 'error';

/** Clasifica el estado HTTP de una lectura. `null` = se puede seguir. */
export function classifyResponse(status: number, isJson: boolean): VintedStop | null {
  if (status === 403) return 'blocked';
  if (status === 429) return 'rate_limited';
  if (status === 401) return 'logged_out';
  if (status === 0 || (status >= 300 && status < 400)) return 'redirect';
  if (status >= 200 && status < 300) return isJson ? null : 'verification';
  return 'error';
}

export const VINTED_STOP_MESSAGES: Record<VintedStop, string> = {
  blocked: 'Vinted respondió 403 (acceso denegado).',
  rate_limited: 'Vinted respondió 429 (demasiadas peticiones).',
  logged_out: 'La sesión de Vinted está cerrada. Inicia sesión en vinted.es.',
  verification: 'Vinted pide una verificación o captcha.',
  redirect: 'Vinted redirigió la petición (posible verificación o sesión cerrada).',
  error: 'Vinted devolvió un error inesperado.',
};
