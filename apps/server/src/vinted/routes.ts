import { NOTIFICATION_TYPES } from '@resellpilot/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { NotFoundError, ValidationError } from '../errors';
import { getSettings } from '../settings';
import type { Notifier } from '../telegram';
import { dueQueries } from '../trends/service';
import {
  AccountMismatchError,
  applySync,
  forgetAccount,
  getVintedStatus,
  listListings,
  listNotifications,
  reportVintedState,
  sendAlerts,
} from './sync';

export interface VintedDeps {
  notifier: Notifier;
  /** Único origen que puede escribir datos de Vinted: `chrome-extension://<id>`. */
  extensionOrigin: string;
}

const id = z.string().regex(/^[\w:.+-]{1,160}$/);
const text = z.string().max(400);
const iso = z.string().datetime();
const count = z.number().int().min(0).max(10_000_000);

// `.strict()`: cualquier campo de más (p. ej. cookies o tokens) hace que se rechace el envío entero.
const syncSchema = z
  .object({
    account: z.string().regex(/^\d{1,20}$/),
    listings: z
      .array(
        z
          .object({
            vinted_id: z.string().regex(/^\d{1,20}$/),
            title: text.min(1),
            price: z.number().min(0).max(1_000_000).nullable(),
            status: z.enum(['activo', 'reservado', 'vendido', 'oculto', 'borrador', 'cerrado']),
            favs: count,
            views: count,
            listed_at: iso.nullable(),
          })
          .strict(),
      )
      .max(5000),
    listings_complete: z.boolean(),
    events: z
      .array(
        z
          .object({
            vinted_id: id,
            type: z.enum(NOTIFICATION_TYPES),
            text: text.min(1),
            listing_vinted_id: z.string().regex(/^\d{1,20}$/).nullable(),
            user_id: z.string().regex(/^\d{1,20}$/).nullable(),
            username: z.string().max(60).nullable(),
            at: iso.nullable(),
            read: z.boolean(),
          })
          .strict(),
      )
      .max(2000),
    conversation_user_ids: z.array(z.string().regex(/^\d{1,20}$/)).max(2000),
  })
  .strict();

const stateSchema = z.object({ paused: z.boolean(), notice: z.string().max(300) }).strict();
const linkSchema = z.object({ item_id: z.number().int().positive().nullable() }).strict();
const readSchema = z.object({ ids: z.array(z.number().int().positive()).max(2000).optional() }).strict();
const idParam = z.coerce.number().int().positive();

export function registerVintedRoutes(app: FastifyInstance, db: Db, deps: VintedDeps): void {
  const { notifier, extensionOrigin } = deps;

  /** Rutas de la extensión: solo su origen, y CORS solo para él. */
  async function onlyExtension(request: FastifyRequest, reply: FastifyReply) {
    if (request.headers.origin !== extensionOrigin) {
      return reply.code(403).send({ error: 'forbidden_origin' });
    }
    reply.header('access-control-allow-origin', extensionOrigin).header('vary', 'Origin');
  }
  const extension = { onRequest: onlyExtension };

  app.options('/api/vinted/*', extension, async (_request, reply) =>
    reply
      .header('access-control-allow-methods', 'GET, POST, OPTIONS')
      .header('access-control-allow-headers', 'content-type')
      .header('access-control-max-age', '600')
      .code(204)
      .send(),
  );

  app.get('/api/vinted/config', extension, async () => ({
    read_min_interval_s: Math.max(1, getSettings(db).READ_MIN_INTERVAL_S),
    // Búsquedas públicas que toca medir en esta sync (Fase 4), ya limitadas por caché y por hora.
    trend_queries: dueQueries(db),
  }));

  app.post('/api/vinted/sync', { ...extension, bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const payload = syncSchema.parse(request.body);
    let result;
    try {
      result = applySync(db, payload);
    } catch (error) {
      if (error instanceof AccountMismatchError) {
        return reply.code(409).send({ error: 'account_mismatch', message: error.message });
      }
      throw error;
    }
    const warning = await sendAlerts(db, notifier, result.alerts);
    return { at: result.at, listings: result.listings, new_events: result.new_events, warning };
  });

  app.post('/api/vinted/state', extension, async (request) => {
    const { paused, notice } = stateSchema.parse(request.body);
    if (reportVintedState(db, paused, notice) && notifier.configured()) {
      await notifier.send(
        `⚠️ ResellPilot ha pausado la lectura de Vinted\n${notice}\nRevisa vinted.es y reanuda desde el panel de la extensión.`,
      );
    }
    return { ok: true };
  });

  // ── Dashboard ──

  app.get('/api/vinted/status', async () => getVintedStatus(db));

  app.post('/api/vinted/forget-account', async () => {
    forgetAccount(db);
    return getVintedStatus(db);
  });

  app.get('/api/listings', async () => listListings(db));

  app.patch('/api/listings/:id', async (request) => {
    const listing = idParam.safeParse((request.params as { id?: unknown }).id);
    if (!listing.success) throw new NotFoundError('El anuncio');
    const { item_id: itemId } = linkSchema.parse(request.body);

    if (itemId !== null) {
      if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(itemId)) throw new NotFoundError('El item');
      const other = db.prepare('SELECT title FROM listings WHERE item_id = ? AND id <> ?').get(itemId, listing.data) as
        | { title: string }
        | undefined;
      if (other) {
        throw new ValidationError([{ path: 'item_id', message: `ese item ya está enlazado al anuncio «${other.title}»` }]);
      }
    }
    const changed = db.prepare('UPDATE listings SET item_id = ? WHERE id = ?').run(itemId, listing.data).changes;
    if (changed === 0) throw new NotFoundError('El anuncio');
    return listListings(db).find((row) => row.id === listing.data);
  });

  app.get('/api/notifications', async () => listNotifications(db));

  /** Marca como leídas en ResellPilot (no toca Vinted). Sin `ids`, todas. */
  app.post('/api/notifications/read', async (request) => {
    const { ids } = readSchema.parse(request.body ?? {});
    if (ids === undefined) {
      return { updated: db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run().changes };
    }
    const mark = db.prepare('UPDATE notifications SET read = 1 WHERE id = ?');
    let updated = 0;
    db.transaction(() => {
      for (const one of ids) updated += mark.run(one).changes;
    })();
    return { updated };
  });
}
