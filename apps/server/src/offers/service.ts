import {
  DEFAULT_OFFER_TEMPLATE,
  dayKey,
  findForbiddenContent,
  formatOfferPrice,
  offerBlocker,
  offerPrice,
  randomDelaySeconds,
  remainingToday,
  renderOfferMessage,
  type CommandLogLine,
  type CommandStatus,
  type CommandStep,
  type CommandType,
  type CommandView,
  type FavoriterState,
  type OfferPlan,
  type OfferPlanRow,
  type Settings,
  type StepResult,
  type StockState,
} from '@resellpilot/shared';
import type { Db } from '../db';
import { logAction } from '../deals/repo';
import { NotFoundError, ValidationError } from '../errors';
import { getRawSetting, getSettings } from '../settings';

const KEY_TEMPLATE = 'OFFER_TEMPLATE';
/** Pausa simulada entre pasos en DRY_RUN (no se espera de verdad el minuto y pico). */
const DRY_RUN_DELAY_S = 1;
const MAX_LOG_LINES = 400;

export const getOfferTemplate = (db: Db): string => getRawSetting(db, KEY_TEMPLATE) ?? DEFAULT_OFFER_TEMPLATE;

// ───────────────────────── plan ─────────────────────────

interface ListingRow {
  id: number;
  vinted_id: string;
  title: string;
  price: number | null;
  status: string | null;
  item_stock: StockState | null;
}

interface FavoriterRow {
  id: number;
  listing_id: number;
  vinted_user_id: string;
  username: string | null;
  offered_at: string | null;
  has_conversation: number;
}

const LISTING_SQL = `SELECT l.id, l.vinted_id, l.title, l.price, l.status, i.stock AS item_stock
                     FROM listings l LEFT JOIN items i ON i.id = l.item_id`;

const favoriterState = (row: FavoriterRow): FavoriterState =>
  row.offered_at !== null ? 'ofertado' : row.has_conversation === 1 ? 'con_conversacion' : 'pendiente';

function listingBlocker(listing: ListingRow): string | null {
  const blocker = offerBlocker(listing, listing.item_stock === null ? null : { stock: listing.item_stock });
  if (blocker) return blocker;
  const forbidden = findForbiddenContent(listing.title);
  return forbidden ? `el título contiene ${forbidden} (los mensajes no pueden llevarlo)` : null;
}

function messageFor(db: Db, settings: Settings, listing: ListingRow, username: string | null): string {
  const price = offerPrice(listing.price as number, settings.OFFER_DISCOUNT_PCT);
  return renderOfferMessage(getOfferTemplate(db), {
    nombre: username ?? '',
    titulo: listing.title,
    precio_final: formatOfferPrice(price),
    horas_envio: String(settings.SHIP_HOURS),
    descuento: String(settings.OFFER_DISCOUNT_PCT).replace('.', ','),
  }).replace(/\s+([,.])/g, '$1');
}

/** Mensajes reales enviados hoy (día local). Persistente: se cuenta en `action_log`. */
export function sentToday(db: Db, now: Date = new Date()): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  return (
    db.prepare("SELECT COUNT(*) AS n FROM action_log WHERE action = 'offer_sent' AND ts >= ? AND ts < ?").get(midnight, nextMidnight) as {
      n: number;
    }
  ).n;
}

const activeCommandId = (db: Db): number | null =>
  (
    db.prepare("SELECT id FROM commands WHERE status IN ('pending', 'running') ORDER BY id LIMIT 1").get() as
      | { id: number }
      | undefined
  )?.id ?? null;

/** Qué se ofrecería a quién: anuncios con favoriters, precio nuevo y mensaje exacto de cada uno. */
export function buildPlan(db: Db, now: Date = new Date()): OfferPlan {
  const settings = getSettings(db);
  const favoriters = db
    .prepare('SELECT id, listing_id, vinted_user_id, username, offered_at, has_conversation FROM favoriters ORDER BY seen_at DESC, id DESC')
    .all() as FavoriterRow[];
  const byListing = new Map<number, FavoriterRow[]>();
  for (const row of favoriters) byListing.set(row.listing_id, [...(byListing.get(row.listing_id) ?? []), row]);

  const rows: OfferPlanRow[] = (db.prepare(`${LISTING_SQL} ORDER BY l.listed_at DESC, l.id DESC`).all() as ListingRow[])
    .filter((listing) => byListing.has(listing.id))
    .map((listing) => {
      const blocker = listingBlocker(listing);
      const recipients = (byListing.get(listing.id) ?? []).map((row) => {
        const state = favoriterState(row);
        return {
          favoriter_id: row.id,
          username: row.username,
          state,
          message: blocker === null && state === 'pendiente' ? messageFor(db, settings, listing, row.username) : null,
        };
      });
      return {
        listing_id: listing.id,
        vinted_id: listing.vinted_id,
        title: listing.title,
        price: listing.price,
        new_price: listing.price === null ? null : offerPrice(listing.price, settings.OFFER_DISCOUNT_PCT),
        blocker,
        recipients,
        pending: recipients.filter((recipient) => recipient.state === 'pendiente').length,
      };
    })
    // Primero lo que se puede ofertar; al final los anuncios bloqueados o sin pendientes.
    .sort((a, b) => Number(b.blocker === null && b.pending > 0) - Number(a.blocker === null && a.pending > 0));

  const sent = sentToday(db, now);
  return {
    rows,
    dry_run: settings.DRY_RUN,
    discount_pct: settings.OFFER_DISCOUNT_PCT,
    max_per_day: settings.MAX_MESSAGES_PER_DAY,
    sent_today: sent,
    remaining_today: remainingToday(settings.MAX_MESSAGES_PER_DAY, sent),
    active_command_id: activeCommandId(db),
  };
}

// ───────────────────────── comandos ─────────────────────────

type Step =
  | {
      kind: 'message';
      favoriter_id: number;
      listing_id: number;
      listing_vinted_id: string;
      user_id: string;
      username: string | null;
      title: string;
      message: string;
      new_price: number;
    }
  | { kind: 'price'; listing_id: number; listing_vinted_id: string; title: string; old_price: number; new_price: number };

interface Payload {
  dry_run: boolean;
  steps: Step[];
  /** Índice del siguiente paso a entregar. */
  cursor: number;
  /** Pasos ejecutados con éxito. */
  done: number;
  /** Paso entregado a la extensión cuyo resultado aún no ha llegado. */
  awaiting: number | null;
  next_allowed_at: string | null;
  log: CommandLogLine[];
}

interface CommandRow {
  id: number;
  type: CommandType;
  payload: string;
  status: CommandStatus;
  progress: number;
  error: string | null;
  created_at: string;
}

function load(db: Db, id: number): { row: CommandRow; payload: Payload } {
  const row = db.prepare('SELECT id, type, payload, status, progress, error, created_at FROM commands WHERE id = ?').get(id) as
    | CommandRow
    | undefined;
  if (!row) throw new NotFoundError('El comando');
  return { row, payload: JSON.parse(row.payload) as Payload };
}

function save(db: Db, id: number, payload: Payload, status: CommandStatus, error: string | null = null): void {
  payload.log = payload.log.slice(-MAX_LOG_LINES);
  const progress = payload.steps.length === 0 ? 1 : Math.min(1, payload.cursor / payload.steps.length);
  db.prepare('UPDATE commands SET payload = ?, status = ?, progress = ?, error = ? WHERE id = ?').run(
    JSON.stringify(payload),
    status,
    progress,
    error,
    id,
  );
}

const toView = (row: CommandRow, payload: Payload): CommandView => ({
  id: row.id,
  type: row.type,
  status: row.status,
  dry_run: payload.dry_run,
  total: payload.steps.length,
  done: payload.done,
  progress: row.progress,
  error: row.error,
  created_at: row.created_at,
  log: payload.log,
});

export function getCommand(db: Db, id: number): CommandView {
  const { row, payload } = load(db, id);
  return toView(row, payload);
}

export function listCommands(db: Db, limit = 10): CommandView[] {
  const rows = db
    .prepare('SELECT id, type, payload, status, progress, error, created_at FROM commands ORDER BY id DESC LIMIT ?')
    .all(limit) as CommandRow[];
  return rows.map((row) => toView(row, JSON.parse(row.payload) as Payload));
}

export interface CommandInput {
  type: CommandType;
  /** Modo B: favoriters marcados en la lista de confirmación. */
  favoriter_ids?: number[];
  /** Modo A: anuncios marcados en la lista de confirmación. */
  listing_ids?: number[];
}

/**
 * Crea un comando a partir de lo que el usuario ha confirmado en el dashboard (Regla 6).
 * Se vuelve a validar todo: nada entra en el comando si ya no es elegible.
 */
export function createCommand(db: Db, input: CommandInput, now: Date = new Date()): CommandView {
  if (activeCommandId(db) !== null) {
    throw new ValidationError([{ path: 'command', message: 'ya hay un comando en curso: espera a que termine o cancélalo' }]);
  }
  const settings = getSettings(db);
  const listings = new Map((db.prepare(LISTING_SQL).all() as ListingRow[]).map((listing) => [listing.id, listing]));
  const steps: Step[] = [];

  if (input.type === 'send_offers') {
    const find = db.prepare('SELECT id, listing_id, vinted_user_id, username, offered_at, has_conversation FROM favoriters WHERE id = ?');
    for (const id of [...new Set(input.favoriter_ids ?? [])]) {
      const row = find.get(id) as FavoriterRow | undefined;
      const listing = row && listings.get(row.listing_id);
      if (!row || !listing || favoriterState(row) !== 'pendiente' || listingBlocker(listing) !== null) continue;
      const message = messageFor(db, settings, listing, row.username);
      // Regla 9, sobre el mensaje ya montado (el nombre de usuario también cuenta).
      if (findForbiddenContent(message) !== null) continue;
      steps.push({
        kind: 'message',
        favoriter_id: row.id,
        listing_id: listing.id,
        listing_vinted_id: listing.vinted_id,
        user_id: row.vinted_user_id,
        username: row.username,
        title: listing.title,
        message,
        new_price: offerPrice(listing.price as number, settings.OFFER_DISCOUNT_PCT),
      });
    }
  } else {
    const pending = db.prepare(
      'SELECT COUNT(*) AS n FROM favoriters WHERE listing_id = ? AND offered_at IS NULL AND has_conversation = 0',
    );
    for (const id of [...new Set(input.listing_ids ?? [])]) {
      const listing = listings.get(id);
      if (!listing || listingBlocker(listing) !== null) continue;
      if ((pending.get(id) as { n: number }).n === 0) continue;
      const newPrice = offerPrice(listing.price as number, settings.OFFER_DISCOUNT_PCT);
      if (newPrice <= 0 || newPrice >= (listing.price as number)) continue;
      steps.push({
        kind: 'price',
        listing_id: listing.id,
        listing_vinted_id: listing.vinted_id,
        title: listing.title,
        old_price: listing.price as number,
        new_price: newPrice,
      });
    }
  }

  if (steps.length === 0) {
    throw new ValidationError([{ path: 'command', message: 'nada de lo seleccionado se puede ofertar ahora mismo' }]);
  }

  const payload: Payload = {
    dry_run: settings.DRY_RUN,
    steps,
    cursor: 0,
    done: 0,
    awaiting: null,
    next_allowed_at: null,
    log: [
      {
        at: now.toISOString(),
        ok: true,
        text: `${settings.DRY_RUN ? 'SIMULACIÓN · ' : ''}${
          input.type === 'send_offers' ? `${steps.length} mensaje(s) confirmados` : `${steps.length} bajada(s) de precio confirmadas`
        }. Esperando a la extensión (pestaña de vinted.es abierta).`,
      },
    ],
  };
  const info = db
    .prepare("INSERT INTO commands (type, payload, status, progress, created_at) VALUES (?, ?, 'pending', 0, ?)")
    .run(input.type, JSON.stringify(payload), now.toISOString());
  logAction(db, 'command_created', String(info.lastInsertRowid), `${input.type} · ${steps.length} · ${settings.DRY_RUN ? 'dry_run' : 'real'}`);
  return getCommand(db, Number(info.lastInsertRowid));
}

/** Comando que la extensión debe ejecutar ahora (el más antiguo sin terminar), o `null`. */
export function nextCommand(db: Db): { id: number; type: CommandType; total: number; dry_run: boolean } | null {
  const id = activeCommandId(db);
  if (id === null) return null;
  const { row, payload } = load(db, id);
  return { id, type: row.type, total: payload.steps.length, dry_run: payload.dry_run };
}

export function cancelCommand(db: Db, id: number, reason: string, now: Date = new Date()): CommandView {
  const { row, payload } = load(db, id);
  if (row.status === 'pending' || row.status === 'running') {
    payload.awaiting = null;
    payload.log.push({ at: now.toISOString(), ok: false, text: reason });
    save(db, id, payload, 'cancelled', reason);
    logAction(db, 'command_cancelled', String(id), reason);
  }
  return getCommand(db, id);
}

const stepLabel = (step: Step): string =>
  step.kind === 'message' ? `${step.username ?? 'usuario'} · ${step.title}` : step.title;

/** Motivo por el que un paso ya no debe ejecutarse (se revalida justo antes de entregarlo). */
function skipReason(db: Db, step: Step): string | null {
  const listing = db.prepare(`${LISTING_SQL} WHERE l.id = ?`).get(step.listing_id) as ListingRow | undefined;
  if (!listing) return 'el anuncio ya no existe';
  const blocker = listingBlocker(listing);
  if (blocker) return blocker;

  if (step.kind === 'price') {
    return listing.price === step.old_price ? null : 'el precio del anuncio ha cambiado desde la confirmación';
  }
  const favoriter = db
    .prepare('SELECT id, listing_id, vinted_user_id, username, offered_at, has_conversation FROM favoriters WHERE id = ?')
    .get(step.favoriter_id) as FavoriterRow | undefined;
  if (!favoriter) return 'ya no está entre los favoritos';
  if (favoriter.offered_at !== null) return 'ya se le hizo una oferta por este anuncio';
  if (favoriter.has_conversation === 1) return 'ya hay conversación con este usuario';
  // Nunca dos veces al mismo usuario por el mismo anuncio, aunque aparezca duplicado en `favoriters`.
  const already = db
    .prepare('SELECT 1 FROM favoriters WHERE listing_id = ? AND vinted_user_id = ? AND offered_at IS NOT NULL LIMIT 1')
    .get(step.listing_id, step.user_id);
  return already ? 'ya se le hizo una oferta por este anuncio' : null;
}

export interface StepOptions {
  now?: Date;
  /** Aleatorio en [0, 1) para la espera. Inyectable en los tests. */
  random?: () => number;
}

/**
 * Motor de ejecución. La extensión informa del resultado del paso anterior y recibe el siguiente:
 * esperar, ejecutar o terminar. Aquí se aplican el límite diario, las esperas, los duplicados y las paradas.
 */
export function advanceCommand(db: Db, id: number, last: StepResult | undefined, options: StepOptions = {}): CommandStep {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const at = now.toISOString();
  const settings = getSettings(db);

  return db.transaction((): CommandStep => {
    const { row, payload } = load(db, id);
    const finished = (status: CommandStatus, error: string | null): CommandStep => {
      payload.awaiting = null;
      payload.log.push({ at, ok: status === 'done', text: error ?? 'Terminado.' });
      save(db, id, payload, status, error);
      logAction(db, `command_${status}`, String(id), error ?? `${payload.done}/${payload.steps.length}`, at);
      return { action: 'finished', status, error };
    };

    if (row.status !== 'pending' && row.status !== 'running') {
      return { action: 'finished', status: row.status, error: row.error };
    }
    const mode = payload.dry_run ? 'SIMULACIÓN · ' : '';

    // 1. Resultado del paso que estaba entregado.
    if (payload.awaiting !== null) {
      const step = payload.steps[payload.awaiting] as Step;
      if (!last || last.index !== payload.awaiting) {
        // La extensión se reinició a mitad de un paso: en simulación se repite; en real nunca se reenvía.
        if (!payload.dry_run) {
          return finished('failed', `No se sabe si el paso «${stepLabel(step)}» llegó a ejecutarse. Revísalo en Vinted antes de repetir.`);
        }
        payload.awaiting = null;
      } else if (!last.ok) {
        // Regla 5 / F5.7: cualquier fallo en Vinted para el comando entero; no se reintenta.
        const reason = last.error ?? 'Vinted rechazó la acción.';
        payload.log.push({ at, ok: false, text: `${stepLabel(step)}: ${reason}` });
        return finished('failed', `${last.stop ? 'Parada: ' : 'Fallo: '}${reason}`);
      } else {
        if (step.kind === 'message') {
          const wait = randomDelaySeconds(settings.MSG_DELAY_MIN_S, settings.MSG_DELAY_MAX_S, random());
          if (payload.dry_run) {
            logAction(db, 'offer_dry_run', `${step.listing_vinted_id}:${step.user_id}`, step.message, at);
            payload.log.push({ at, ok: true, text: `${mode}mensaje a ${step.username ?? step.user_id} por «${step.title}»: ${step.message} (espera real: ${wait} s)` });
            payload.next_allowed_at = new Date(now.getTime() + DRY_RUN_DELAY_S * 1000).toISOString();
          } else {
            db.prepare('UPDATE favoriters SET offered_at = ? WHERE listing_id = ? AND vinted_user_id = ?').run(at, step.listing_id, step.user_id);
            logAction(db, 'offer_sent', `${step.listing_vinted_id}:${step.user_id}`, step.message, at);
            payload.log.push({ at, ok: true, text: `Mensaje enviado a ${step.username ?? step.user_id} por «${step.title}». Siguiente en ${wait} s.` });
            payload.next_allowed_at = new Date(now.getTime() + wait * 1000).toISOString();
          }
        } else {
          const change = `${formatOfferPrice(step.old_price)} € → ${formatOfferPrice(step.new_price)} €`;
          if (payload.dry_run) {
            logAction(db, 'price_drop_dry_run', step.listing_vinted_id, change, at);
            payload.log.push({ at, ok: true, text: `${mode}bajaría «${step.title}»: ${change}` });
            payload.next_allowed_at = new Date(now.getTime() + DRY_RUN_DELAY_S * 1000).toISOString();
          } else {
            db.prepare('UPDATE listings SET price = ? WHERE id = ?').run(step.new_price, step.listing_id);
            // Vinted avisa de la bajada a quienes dieron favorito: cuentan como ofertados.
            db.prepare('UPDATE favoriters SET offered_at = ? WHERE listing_id = ? AND offered_at IS NULL').run(at, step.listing_id);
            logAction(db, 'price_drop', step.listing_vinted_id, change, at);
            payload.log.push({ at, ok: true, text: `Precio bajado en «${step.title}»: ${change}` });
            payload.next_allowed_at = new Date(now.getTime() + settings.READ_MIN_INTERVAL_S * 1000).toISOString();
          }
        }
        payload.done += 1;
        payload.cursor = payload.awaiting + 1;
        payload.awaiting = null;
      }
    }

    // 2. Siguiente paso válido (los que ya no proceden se saltan y quedan en el log).
    while (payload.cursor < payload.steps.length) {
      const step = payload.steps[payload.cursor] as Step;
      const reason = skipReason(db, step);
      if (reason === null) break;
      payload.log.push({ at, ok: false, text: `Omitido · ${stepLabel(step)}: ${reason}.` });
      payload.cursor += 1;
    }
    if (payload.cursor >= payload.steps.length) return finished('done', null);

    const step = payload.steps[payload.cursor] as Step;

    // 3. Límite diario (solo envíos reales).
    if (step.kind === 'message' && !payload.dry_run && sentToday(db, now) >= settings.MAX_MESSAGES_PER_DAY) {
      const left = payload.steps.length - payload.cursor;
      return finished(
        'done',
        `Límite diario alcanzado (${settings.MAX_MESSAGES_PER_DAY} mensajes el ${dayKey(now)}). Quedan ${left} sin enviar: vuelve a lanzarlos mañana.`,
      );
    }

    // 4. Espera entre pasos.
    if (payload.next_allowed_at !== null) {
      const seconds = Math.ceil((Date.parse(payload.next_allowed_at) - now.getTime()) / 1000);
      if (seconds > 0) {
        save(db, id, payload, 'running');
        return { action: 'wait', seconds, done: payload.done, total: payload.steps.length };
      }
    }

    // 5. Entrega.
    payload.awaiting = payload.cursor;
    save(db, id, payload, 'running');
    return {
      action: 'do',
      index: payload.cursor,
      done: payload.done,
      total: payload.steps.length,
      dry_run: payload.dry_run,
      kind: step.kind,
      label: stepLabel(step),
      listing_vinted_id: step.listing_vinted_id,
      user_id: step.kind === 'message' ? step.user_id : null,
      message: step.kind === 'message' ? step.message : null,
      new_price: step.new_price,
    };
  })();
}
