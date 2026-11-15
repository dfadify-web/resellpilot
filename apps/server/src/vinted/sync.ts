import {
  daysListed,
  formatOfferPrice,
  isStale,
  offerPrice,
  type ListingStatus,
  type ListingView,
  type NotificationType,
  type NotificationView,
  type SyncPayload,
  type VintedStatus,
} from '@resellpilot/shared';
import type { Db } from '../db';
import { logAction } from '../deals/repo';
import { getRawSetting, getSettings, setRawSetting } from '../settings';
import type { Notifier } from '../telegram';

const KEY_ACCOUNT = 'VINTED_ACCOUNT';
const KEY_LAST_SYNC = 'VINTED_LAST_SYNC';
const KEY_PAUSED = 'VINTED_PAUSED';
const KEY_NOTICE = 'VINTED_NOTICE';

/** La extensión está leyendo una cuenta distinta a la que ya hay guardada. */
export class AccountMismatchError extends Error {
  constructor() {
    super('La cuenta de Vinted abierta no es la misma que la ya sincronizada.');
    this.name = 'AccountMismatchError';
  }
}

export interface Alert {
  type: Exclude<NotificationType, 'otro'>;
  text: string;
}

export interface SyncResult {
  at: string;
  listings: number;
  new_events: number;
  alerts: Alert[];
}

const eur = (value: number | null): string =>
  value === null ? 'sin precio' : `${value.toFixed(2).replace('.', ',')} €`;

/**
 * Guarda un snapshot de la cuenta. Todo o nada.
 * Devuelve los avisos a enviar: favoritos, mensajes y ventas que no se habían visto antes.
 * La primera sync no avisa de nada (sería todo el historial).
 */
export function applySync(db: Db, payload: SyncPayload, now: Date = new Date()): SyncResult {
  const account = getRawSetting(db, KEY_ACCOUNT);
  if (account && account !== payload.account) throw new AccountMismatchError();

  const at = now.toISOString();
  const firstSync = getRawSetting(db, KEY_LAST_SYNC) === null;
  const alerts: Alert[] = [];
  let newEvents = 0;

  db.transaction(() => {
    const known = db.prepare('SELECT vinted_id, status, price FROM listings').all() as {
      vinted_id: string;
      status: string | null;
      price: number | null;
    }[];
    const previous = new Map(known.map((row) => [row.vinted_id, row.status]));
    const previousPrice = new Map(known.map((row) => [row.vinted_id, row.price]));
    const discountPct = getSettings(db).OFFER_DISCOUNT_PCT;
    const markOffered = db.prepare(
      'UPDATE favoriters SET offered_at = ? WHERE offered_at IS NULL AND listing_id = (SELECT id FROM listings WHERE vinted_id = ?)',
    );

    const upsert = db.prepare(
      `INSERT INTO listings (vinted_id, title, price, status, favs, views, listed_at, last_seen_at)
       VALUES (@vinted_id, @title, @price, @status, @favs, @views, @listed_at, @at)
       ON CONFLICT (vinted_id) DO UPDATE SET
         title = excluded.title, price = excluded.price, status = excluded.status,
         favs = excluded.favs, views = excluded.views,
         listed_at = COALESCE(excluded.listed_at, listings.listed_at),
         last_seen_at = excluded.last_seen_at`,
    );
    const insertEvent = db.prepare(
      `INSERT OR IGNORE INTO notifications (vinted_id, type, text, listing_id, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const listingId = db.prepare('SELECT id FROM listings WHERE vinted_id = ?');
    const findListing = (vintedId: string | null): number | null =>
      vintedId === null ? null : ((listingId.get(vintedId) as { id: number } | undefined)?.id ?? null);

    for (const listing of payload.listings) {
      upsert.run({ ...listing, at });

      // Bajada de precio hecha a mano en Vinted (p. ej. desde una sugerencia): queda registrada.
      // Si llega al descuento de las ofertas, Vinted ya ha avisado a quienes dieron favorito.
      const oldPrice = previousPrice.get(listing.vinted_id) ?? null;
      if (listing.status === 'activo' && oldPrice !== null && listing.price !== null && listing.price < oldPrice) {
        logAction(db, 'price_drop_manual', listing.vinted_id, `${formatOfferPrice(oldPrice)} € → ${formatOfferPrice(listing.price)} €`, at);
        if (listing.price <= offerPrice(oldPrice, discountPct)) markOffered.run(at, listing.vinted_id);
      }

      // Venta: un anuncio que ya conocíamos pasa a vendido.
      const before = previous.get(listing.vinted_id);
      if (listing.status === 'vendido' && before !== undefined && before !== 'vendido') {
        const text = `Vendido: ${listing.title} (${eur(listing.price)})`;
        const inserted = insertEvent.run(`s:${listing.vinted_id}`, 'venta', text, findListing(listing.vinted_id), 0, at);
        if (inserted.changes > 0) {
          newEvents += 1;
          if (!firstSync) alerts.push({ type: 'venta', text });
        }
      }
    }

    // Lo que ya no aparece en el armario completo deja de contarse como activo.
    if (payload.listings_complete) {
      db.prepare(
        `UPDATE listings SET status = 'no_visible'
         WHERE (last_seen_at IS NULL OR last_seen_at < ?) AND status NOT IN ('vendido', 'no_visible')`,
      ).run(at);
    }

    const addFavoriter = db.prepare(
      `INSERT INTO favoriters (listing_id, vinted_user_id, username, seen_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (listing_id, vinted_user_id) DO UPDATE SET username = COALESCE(favoriters.username, excluded.username)`,
    );
    for (const event of payload.events) {
      const listing = findListing(event.listing_vinted_id);
      // El estado de lectura solo se toma la primera vez: leer las notificaciones las marca como leídas en Vinted.
      const inserted = insertEvent.run(event.vinted_id, event.type, event.text, listing, event.read ? 1 : 0, event.at ?? at);
      if (event.type === 'favorito' && listing !== null && event.user_id !== null) {
        addFavoriter.run(listing, event.user_id, event.username, event.at ?? at);
      }
      if (inserted.changes > 0) {
        newEvents += 1;
        if (!firstSync && event.type !== 'otro') alerts.push({ type: event.type, text: event.text });
      }
    }

    const markConversation = db.prepare('UPDATE favoriters SET has_conversation = 1 WHERE vinted_user_id = ?');
    for (const userId of payload.conversation_user_ids) markConversation.run(userId);

    setRawSetting(db, KEY_ACCOUNT, payload.account);
    setRawSetting(db, KEY_LAST_SYNC, at);
    setRawSetting(db, KEY_PAUSED, 'false');
    setRawSetting(db, KEY_NOTICE, '');
  })();

  return { at, listings: payload.listings.length, new_events: newEvents, alerts };
}

const ALERT_TITLES: Record<Alert['type'], string> = {
  favorito: '⭐ Nuevo favorito',
  mensaje: '💬 Nuevo mensaje',
  venta: '💰 Venta',
};
const MAX_ALERT_MESSAGES = 8;

/** Envía los avisos por Telegram. Devuelve un texto de aviso si algo falló. Nunca lanza. */
export async function sendAlerts(db: Db, notifier: Notifier, alerts: readonly Alert[]): Promise<string | null> {
  if (alerts.length === 0 || !notifier.configured()) return null;

  const messages = alerts.slice(0, MAX_ALERT_MESSAGES).map((alert) => `${ALERT_TITLES[alert.type]}\n${alert.text}`);
  const rest = alerts.length - messages.length;
  if (rest > 0) messages.push(`…y ${rest} novedades más en Vinted. Míralas en Notificaciones.`);

  for (const message of messages) {
    const result = await notifier.send(message);
    if (!result.ok) {
      logAction(db, 'telegram_error', 'vinted', result.error ?? 'error');
      return result.error ?? 'Telegram no disponible.';
    }
  }
  return null;
}

export function getVintedStatus(db: Db): VintedStatus {
  return {
    last_sync_at: getRawSetting(db, KEY_LAST_SYNC),
    paused: getRawSetting(db, KEY_PAUSED) === 'true',
    notice: getRawSetting(db, KEY_NOTICE) || null,
    account: getRawSetting(db, KEY_ACCOUNT),
  };
}

/**
 * La extensión informa de que se ha pausado (403, 429, captcha…) o reanudado.
 * Devuelve `true` si acaba de pasar a pausada (para avisar una sola vez).
 */
export function reportVintedState(db: Db, paused: boolean, notice: string): boolean {
  const wasPaused = getRawSetting(db, KEY_PAUSED) === 'true';
  setRawSetting(db, KEY_PAUSED, String(paused));
  setRawSetting(db, KEY_NOTICE, notice);
  if (paused && !wasPaused) {
    logAction(db, 'vinted_pausa', 'extension', notice);
    return true;
  }
  return false;
}

/** Olvida la cuenta guardada (para cambiar de cuenta de Vinted). No borra anuncios ni notificaciones. */
export function forgetAccount(db: Db): void {
  db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(KEY_ACCOUNT, KEY_LAST_SYNC);
}

interface ListingRow extends Omit<ListingView, 'days_listed' | 'stale' | 'status'> {
  status: string | null;
}

export function listListings(db: Db, now: Date = new Date()): ListingView[] {
  const staleDays = getSettings(db).STALE_DAYS;
  const rows = db
    .prepare(
      `SELECT l.id, l.vinted_id, l.title, l.price, l.status, l.favs, l.views, l.listed_at, l.last_seen_at,
              l.item_id, i.name AS item_name
       FROM listings l LEFT JOIN items i ON i.id = l.item_id
       ORDER BY (l.status = 'activo') DESC, l.listed_at DESC, l.id DESC`,
    )
    .all() as ListingRow[];
  return rows.map((row) => ({
    ...row,
    status: (row.status ?? 'activo') as ListingStatus,
    days_listed: daysListed(row.listed_at, now),
    stale: isStale(row, staleDays, now),
  }));
}

export function listNotifications(db: Db, limit = 500): NotificationView[] {
  const rows = db
    .prepare(
      `SELECT n.id, n.vinted_id, n.type, n.text, n.listing_id, l.title AS listing_title, n.read, n.created_at
       FROM notifications n LEFT JOIN listings l ON l.id = n.listing_id
       ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
    )
    .all(limit) as (Omit<NotificationView, 'read'> & { read: number })[];
  return rows.map((row) => ({ ...row, read: row.read === 1 }));
}
