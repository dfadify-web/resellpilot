import {
  FULL_INBOX_EVERY_H,
  daysListed,
  formatOfferPrice,
  isStale,
  marketFor,
  normalizeForMatch,
  offerPrice,
  orderState,
  type OrderState,
  type OrderView,
  type ListingStatus,
  type ListingView,
  type NotificationType,
  type NotificationView,
  type SyncPayload,
  type VintedStatus,
} from '@resellpilot/shared';
import type { Db } from '../db';
import { hasAction, logAction } from '../deals/repo';
import { getRawSetting, getSettings, setRawSetting } from '../settings';
import type { Notifier } from '../telegram';
import { latestTrends } from '../trends/service';

const KEY_ACCOUNT = 'VINTED_ACCOUNT';
const KEY_LAST_SYNC = 'VINTED_LAST_SYNC';
const KEY_PAUSED = 'VINTED_PAUSED';
const KEY_NOTICE = 'VINTED_NOTICE';
const KEY_INBOX_FULL = 'VINTED_INBOX_FULL_AT';
/** Margen para no perder avisos por desfases de reloj entre Vinted y este equipo. */
const ALERT_MARGIN_MS = 60 * 60 * 1000;

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

interface SoldItemRow {
  id: number;
  stock: string;
  cost: number;
  shipping_cost: number;
  extra_costs: number;
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
  const lastSync = getRawSetting(db, KEY_LAST_SYNC);
  const firstSync = lastSync === null;
  // Solo se avisa de lo ocurrido desde la última sync: lo antiguo que aparece ahora (p. ej. conversaciones
  // de páginas que antes no se leían) se guarda sin mandar avisos.
  const alertSince = lastSync === null ? null : Date.parse(lastSync) - ALERT_MARGIN_MS;
  const isRecent = (iso: string | null | undefined): boolean => alertSince === null || !iso || Date.parse(iso) >= alertSince;
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
      `INSERT INTO listings (vinted_id, title, price, status, favs, views, listed_at, last_seen_at, photo, brand, size, condition, url)
       VALUES (@vinted_id, @title, @price, @status, @favs, @views, @listed_at, @at, @photo, @brand, @size, @condition, @url)
       ON CONFLICT (vinted_id) DO UPDATE SET
         title = excluded.title, price = excluded.price, status = excluded.status,
         favs = excluded.favs, views = excluded.views,
         listed_at = COALESCE(excluded.listed_at, listings.listed_at),
         last_seen_at = excluded.last_seen_at,
         photo = COALESCE(excluded.photo, listings.photo), brand = COALESCE(excluded.brand, listings.brand),
         size = COALESCE(excluded.size, listings.size), condition = COALESCE(excluded.condition, listings.condition),
         url = COALESCE(excluded.url, listings.url)`,
    );
    // Con pedidos (extensión 0.9+) las ventas y sus avisos salen de los pedidos, con el precio real.
    const ordersAvailable = payload.orders !== undefined;
    const markLinkedItemSold = db.prepare(
      `SELECT i.id, i.stock, i.cost, i.shipping_cost, i.extra_costs
       FROM listings l JOIN items i ON i.id = l.item_id WHERE l.vinted_id = ?`,
    );
    const setItemSold = db.prepare("UPDATE items SET stock = 'vendido', sold_price = ?, sold_at = ? WHERE id = ?");
    const insertEvent = db.prepare(
      `INSERT OR IGNORE INTO notifications (vinted_id, type, text, listing_id, read, created_at, photo, link)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const listingId = db.prepare('SELECT id FROM listings WHERE vinted_id = ?');
    const findListing = (vintedId: string | null): number | null =>
      vintedId === null ? null : ((listingId.get(vintedId) as { id: number } | undefined)?.id ?? null);

    for (const listing of payload.listings) {
      upsert.run({
        ...listing,
        at,
        photo: listing.photo ?? null,
        brand: listing.brand ?? null,
        size: listing.size ?? null,
        condition: listing.condition ?? null,
        url: listing.url ?? null,
      });

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
        // Si el anuncio está enlazado a un item, el inventario se pone al día solo: vendido al precio del anuncio.
        const sold = markLinkedItemSold.get(listing.vinted_id) as SoldItemRow | undefined;
        let profitNote = '';
        if (sold && sold.stock !== 'vendido' && listing.price !== null) {
          setItemSold.run(listing.price, at, sold.id);
          const gain = Math.round((listing.price - sold.cost - sold.shipping_cost - sold.extra_costs) * 100) / 100;
          profitNote = ` · inventario actualizado, beneficio ${gain > 0 ? '+' : ''}${eur(gain)}`;
          logAction(db, 'item_vendido_auto', String(sold.id), `${listing.vinted_id} · ${eur(listing.price)}`, at);
        }
        const text = `Vendido: ${listing.title} (${eur(listing.price)})${profitNote}`;
        if (!ordersAvailable) {
          const inserted = insertEvent.run(`s:${listing.vinted_id}`, 'venta', text, findListing(listing.vinted_id), 0, at, listing.photo ?? null, listing.url ?? null);
          if (inserted.changes > 0) {
            newEvents += 1;
            if (!firstSync) alerts.push({ type: 'venta', text });
          }
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
      const inserted = insertEvent.run(
        event.vinted_id,
        event.type,
        event.text,
        listing,
        event.read ? 1 : 0,
        event.at ?? at,
        event.photo ?? null,
        event.link ?? null,
      );
      if (event.type === 'favorito' && listing !== null && event.user_id !== null) {
        addFavoriter.run(listing, event.user_id, event.username, event.at ?? at);
      }
      if (inserted.changes > 0) {
        newEvents += 1;
        if (!firstSync && event.type !== 'otro' && isRecent(event.at)) alerts.push({ type: event.type, text: event.text });
      }
    }

    const markConversation = db.prepare('UPDATE favoriters SET has_conversation = 1 WHERE vinted_user_id = ?');
    for (const userId of payload.conversation_user_ids) markConversation.run(userId);

    if (payload.orders) {
      const result = applyOrders(db, payload.orders, { at, firstSync, insertEvent });
      newEvents += result.newEvents;
      alerts.push(...result.alerts);
    }

    setRawSetting(db, KEY_ACCOUNT, payload.account);
    setRawSetting(db, KEY_LAST_SYNC, at);
    if (payload.inbox_complete) setRawSetting(db, KEY_INBOX_FULL, at);
    setRawSetting(db, KEY_PAUSED, 'false');
    setRawSetting(db, KEY_NOTICE, '');
  })();

  return { at, listings: payload.listings.length, new_events: newEvents, alerts };
}

const ALERT_TITLES: Record<Alert['type'], string> = {
  favorito: '⭐ Nuevo favorito',
  mensaje: '💬 Nuevo mensaje',
  venta: '💰 Venta',
  pedido: '📦 Pedido',
};

// ───────────────────────── pedidos vendidos ─────────────────────────

interface OrderRow {
  vinted_id: string;
  state: OrderState;
  listing_id: number | null;
}

interface LinkedItemRow {
  id: number;
  stock: string;
  sold_price: number | null;
  cost: number;
  shipping_cost: number;
  extra_costs: number;
}

interface OrdersContext {
  at: string;
  firstSync: boolean;
  insertEvent: { run: (...params: unknown[]) => { changes: number } };
}

const inboxUrl = (conversationId: string | null): string | null =>
  conversationId ? `https://www.vinted.es/inbox/${conversationId}` : null;

/**
 * Pedidos vendidos: el registro fiable de las ventas. Por cada pedido:
 * - se enlaza con su anuncio por el título;
 * - si el anuncio está enlazado a un item, el inventario queda vendido con el PRECIO REAL del pedido (y se
 *   corrige si antes se puso el del anuncio); si el pedido se cancela, se deshace lo que se hizo solo;
 * - avisos: venta nueva, «tienes que enviar» (también en la primera sync: es algo pendiente) y cancelación.
 * El inventario se revisa en cada sync, así que un enlace hecho más tarde también se aplica.
 */
function applyOrders(
  db: Db,
  orders: NonNullable<SyncPayload['orders']>,
  { at, firstSync, insertEvent }: OrdersContext,
): { newEvents: number; alerts: Alert[] } {
  const alerts: Alert[] = [];
  let newEvents = 0;
  const known = new Map((db.prepare('SELECT vinted_id, state, listing_id FROM orders').all() as OrderRow[]).map((row) => [row.vinted_id, row]));

  const byTitle = new Map<string, { id: number; status: string | null }[]>();
  for (const row of db.prepare('SELECT id, title, status FROM listings ORDER BY id DESC').all() as { id: number; title: string; status: string | null }[]) {
    const key = normalizeForMatch(row.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), row]);
  }

  const upsert = db.prepare(
    `INSERT INTO orders (vinted_id, conversation_id, title, price, status_text, state, at, photo, listing_id, first_seen_at, updated_at)
     VALUES (@vinted_id, @conversation_id, @title, @price, @status_text, @state, @at, @photo, @listing_id, @now, @now)
     ON CONFLICT (vinted_id) DO UPDATE SET
       conversation_id = COALESCE(excluded.conversation_id, orders.conversation_id), title = excluded.title,
       price = COALESCE(excluded.price, orders.price), status_text = excluded.status_text, state = excluded.state,
       at = COALESCE(excluded.at, orders.at), photo = COALESCE(excluded.photo, orders.photo),
       listing_id = COALESCE(orders.listing_id, excluded.listing_id), updated_at = excluded.updated_at`,
  );
  const linkedItem = db.prepare(
    `SELECT i.id, i.stock, i.sold_price, i.cost, i.shipping_cost, i.extra_costs
     FROM listings l JOIN items i ON i.id = l.item_id WHERE l.id = ?`,
  );
  const setSold = db.prepare("UPDATE items SET stock = 'vendido', sold_price = ?, sold_at = ? WHERE id = ?");
  const setPrice = db.prepare('UPDATE items SET sold_price = ?, sold_at = COALESCE(?, sold_at) WHERE id = ?');
  const unsell = db.prepare("UPDATE items SET stock = 'en_mano', sold_price = NULL, sold_at = NULL WHERE id = ?");

  /**
   * `createdAt`: la fecha real del hecho (la venta), no la de la sync. En la primera sync el historial entra
   * como leído; lo pendiente (enviar) no.
   */
  const event = (
    id: string,
    type: Alert['type'],
    text: string,
    listingId: number | null,
    photo: string | null,
    link: string | null,
    alert: boolean,
    createdAt: string = at,
  ) => {
    const read = firstSync && !alert ? 1 : 0;
    if (insertEvent.run(id, type, text, listingId, read, createdAt, photo, link).changes === 0) return;
    newEvents += 1;
    if (alert) alerts.push({ type, text });
  };

  for (const order of orders) {
    const state = orderState(order.user_status);
    const previous = known.get(order.vinted_id);
    const candidates = byTitle.get(normalizeForMatch(order.title)) ?? [];
    const listingId =
      previous?.listing_id ??
      (candidates.find((row) => row.status === 'vendido') ?? candidates.find((row) => row.status === 'reservado') ?? candidates[0])?.id ??
      null;
    upsert.run({ ...order, state, listing_id: listingId, now: at });

    // Inventario (idempotente): solo items enlazados; lo hecho a mano se respeta.
    let profitNote = '';
    const item = listingId === null ? undefined : (linkedItem.get(listingId) as LinkedItemRow | undefined);
    if (item && order.price !== null) {
      const autoSold = hasAction(db, 'item_vendido_auto', String(item.id));
      if (state === 'cancelado') {
        if (item.stock === 'vendido' && autoSold && !hasAction(db, 'item_venta_cancelada', `${item.id}:${order.vinted_id}`)) {
          unsell.run(item.id);
          logAction(db, 'item_venta_cancelada', `${item.id}:${order.vinted_id}`, order.title, at);
        }
      } else if (item.stock !== 'vendido') {
        setSold.run(order.price, order.at ?? at, item.id);
        logAction(db, 'item_vendido_auto', String(item.id), `pedido ${order.vinted_id} · ${eur(order.price)}`, at);
      } else if (autoSold && (item.sold_price !== order.price || !hasAction(db, 'item_precio_real', `${item.id}:${order.vinted_id}`))) {
        // Vendido solo con el precio del anuncio: se corrige con el precio y la fecha reales del pedido (una vez).
        setPrice.run(order.price, order.at, item.id);
        logAction(db, 'item_precio_real', `${item.id}:${order.vinted_id}`, `${eur(item.sold_price)} → ${eur(order.price)}`, at);
      }
      if (state !== 'cancelado') {
        const gain = Math.round((order.price - item.cost - item.shipping_cost - item.extra_costs) * 100) / 100;
        profitNote = ` · beneficio ${gain > 0 ? '+' : ''}${eur(gain)}`;
      }
    }

    const link = inboxUrl(order.conversation_id);
    const changed = previous !== undefined && previous.state !== state;
    if (!previous) {
      event(`o:${order.vinted_id}:venta`, 'venta', `Vendido: ${order.title} por ${eur(order.price)}${profitNote}`, listingId, order.photo, link, !firstSync, order.at ?? at);
    }
    if (state === 'enviar' && (!previous || changed)) {
      // Algo pendiente: se avisa también en la primera sync.
      event(`o:${order.vinted_id}:enviar`, 'pedido', `Tienes que enviar: ${order.title} (${eur(order.price)}). Imprime la etiqueta en Vinted.`, listingId, order.photo, link, true, order.at ?? at);
    }
    if (state === 'cancelado' && changed) {
      event(`o:${order.vinted_id}:cancelado`, 'pedido', `Pedido cancelado: ${order.title}. Revisa el item en Inventario.`, listingId, order.photo, link, true);
    }
    if (state === 'completado' && changed) {
      event(`o:${order.vinted_id}:completado`, 'pedido', `Pedido completado: ${order.title} (${eur(order.price)})`, listingId, order.photo, link, false);
    }
  }
  return { newEvents, alerts };
}

/** Pedidos vendidos para el dashboard: primero los que hay que enviar, después los más recientes. */
export function listOrders(db: Db, limit = 200): OrderView[] {
  const rows = db
    .prepare(
      `SELECT o.id, o.vinted_id, o.conversation_id, o.title, o.price, o.status_text, o.state, o.at, o.photo, o.listing_id,
              l.item_id, i.name AS item_name
       FROM orders o LEFT JOIN listings l ON l.id = o.listing_id LEFT JOIN items i ON i.id = l.item_id
       ORDER BY (o.state = 'enviar') DESC, COALESCE(o.at, o.first_seen_at) DESC, o.id DESC LIMIT ?`,
    )
    .all(limit) as (Omit<OrderView, 'url'> & { conversation_id: string | null })[];
  return rows.map(({ conversation_id: conversationId, ...row }) => ({ ...row, url: inboxUrl(conversationId) }));
}
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

/** La extensión se pausó por una respuesta de Vinted (403, 429, captcha…). Regla 5. */
export const isVintedPaused = (db: Db): boolean => getRawSetting(db, KEY_PAUSED) === 'true';

/**
 * Desde cuándo leer la bandeja de mensajes en esta sync: `null` = entera (la primera vez y cada
 * `FULL_INBOX_EVERY_H` horas); si no, hasta una hora antes de la última sync.
 */
export function inboxSince(db: Db, now: Date = new Date()): string | null {
  const full = getRawSetting(db, KEY_INBOX_FULL);
  const last = getRawSetting(db, KEY_LAST_SYNC);
  if (!full || !last || now.getTime() - Date.parse(full) >= FULL_INBOX_EVERY_H * 60 * 60 * 1000) return null;
  return new Date(Date.parse(last) - ALERT_MARGIN_MS).toISOString();
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

interface ListingRow extends Omit<ListingView, 'days_listed' | 'stale' | 'status' | 'market'> {
  status: string | null;
}

export function listListings(db: Db, now: Date = new Date()): ListingView[] {
  const staleDays = getSettings(db).STALE_DAYS;
  const trends = latestTrends(db);
  const rows = db
    .prepare(
      `SELECT l.id, l.vinted_id, l.title, l.price, l.status, l.favs, l.views, l.listed_at, l.last_seen_at,
              l.item_id, i.name AS item_name, l.photo, l.brand, l.size, l.condition, l.url
       FROM listings l LEFT JOIN items i ON i.id = l.item_id
       ORDER BY (l.status = 'activo') DESC, l.listed_at DESC, l.id DESC`,
    )
    .all() as ListingRow[];
  return rows.map((row) => ({
    ...row,
    status: (row.status ?? 'activo') as ListingStatus,
    days_listed: daysListed(row.listed_at, now),
    stale: isStale(row, staleDays, now),
    market: marketFor(row, trends),
  }));
}

export function listNotifications(db: Db, limit = 500): NotificationView[] {
  const rows = db
    .prepare(
      `SELECT n.id, n.vinted_id, n.type, n.text, n.listing_id, l.title AS listing_title, n.read, n.created_at,
              COALESCE(n.photo, l.photo) AS photo, COALESCE(n.link, l.url) AS link
       FROM notifications n LEFT JOIN listings l ON l.id = n.listing_id
       ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
    )
    .all(limit) as (Omit<NotificationView, 'read'> & { read: number })[];
  return rows.map((row) => ({ ...row, read: row.read === 1 }));
}
