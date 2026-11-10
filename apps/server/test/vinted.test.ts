import type { ListingView, NotificationView, SyncEvent, SyncListing, SyncPayload, VintedStatus } from '@resellpilot/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, defaultDealsDeps } from '../src/app';
import { DEFAULT_EXTENSION_ID, loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db';
import type { Notifier } from '../src/telegram';

const ORIGIN = `chrome-extension://${DEFAULT_EXTENSION_ID}`;

let db: Db;
let app: FastifyInstance;
let sent: string[];
let telegramOk: boolean;

const notifier: Notifier = {
  configured: () => true,
  send: async (text) => {
    sent.push(text);
    return telegramOk ? { ok: true } : { ok: false, error: 'fallo simulado' };
  },
};

beforeEach(async () => {
  db = openDb(':memory:');
  sent = [];
  telegramOk = true;
  app = await buildApp({ db, dashboard: 'none', deals: { ...defaultDealsDeps(db), notifier } });
});
afterEach(async () => {
  await app.close();
  db.close();
});

const listing = (overrides: Partial<SyncListing> = {}): SyncListing => ({
  vinted_id: '7001',
  title: 'Camisa de lino',
  price: 20,
  status: 'activo',
  favs: 3,
  views: 40,
  listed_at: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const favourite = (overrides: Partial<SyncEvent> = {}): SyncEvent => ({
  vinted_id: 'n:aaa-1',
  type: 'favorito',
  text: 'ana ha marcado como favorito tu artículo "Camisa de lino".',
  listing_vinted_id: '7001',
  user_id: '555',
  username: 'ana',
  at: '2026-11-09T10:00:00.000Z',
  read: true,
  ...overrides,
});

const snapshot = (overrides: Partial<SyncPayload> = {}): SyncPayload => ({
  account: '1234',
  listings: [listing()],
  listings_complete: true,
  events: [favourite()],
  conversation_user_ids: [],
  ...overrides,
});

const post = (url: string, payload: unknown, origin: string | null = ORIGIN) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: origin ? { origin } : {} });
const sync = (payload: unknown, origin: string | null = ORIGIN) => post('/api/vinted/sync', payload, origin);
const listings = async () => (await app.inject({ method: 'GET', url: '/api/listings' })).json() as ListingView[];
const notifications = async () =>
  (await app.inject({ method: 'GET', url: '/api/notifications' })).json() as NotificationView[];
const status = async () => (await app.inject({ method: 'GET', url: '/api/vinted/status' })).json() as VintedStatus;

describe('quién puede enviar datos de Vinted', () => {
  it('solo el origen de la extensión, con CORS solo para ella', async () => {
    for (const origin of ['https://www.vinted.es', 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'http://localhost:4317', null]) {
      const res = await sync(snapshot(), origin);
      expect(res.statusCode, String(origin)).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(await listings()).toEqual([]);

    const ok = await sync(snapshot());
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('responde al preflight de la extensión y rechaza el de otros', async () => {
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/vinted/sync', headers: { origin: ORIGIN } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(preflight.headers['access-control-allow-headers']).toBe('content-type');
    const other = await app.inject({ method: 'OPTIONS', url: '/api/vinted/sync', headers: { origin: 'https://evil.example' } });
    expect(other.statusCode).toBe(403);
  });

  it('la configuración de lectura solo se da a la extensión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/vinted/config' })).statusCode).toBe(403);
    const res = await app.inject({ method: 'GET', url: '/api/vinted/config', headers: { origin: ORIGIN } });
    expect(res.json()).toMatchObject({ read_min_interval_s: 3 });
  });

  it('rechaza el envío entero si trae campos de más (cookies, tokens…)', async () => {
    expect((await sync({ ...snapshot(), cookies: 'x' })).statusCode).toBe(400);
    expect((await sync(snapshot({ listings: [{ ...listing(), access_token: 'x' } as SyncListing] }))).statusCode).toBe(400);
    expect((await sync(snapshot({ account: 'no-numérico' }))).statusCode).toBe(400);
    expect((await sync(snapshot({ listings: [listing({ price: -1 })] }))).statusCode).toBe(400);
    expect(await listings()).toEqual([]);
  });

  it('el ID de la extensión se puede cambiar en .env y se valida', () => {
    expect(loadConfig({}).extensionId).toBe(DEFAULT_EXTENSION_ID);
    expect(loadConfig({ EXTENSION_ID: 'abcdefghijklmnopabcdefghijklmnop' }).extensionId).toBe('abcdefghijklmnopabcdefghijklmnop');
    expect(() => loadConfig({ EXTENSION_ID: 'https://evil.example' })).toThrow();
  });

  it('ninguna otra web puede escribir en la API local', async () => {
    const evil = await app.inject({ method: 'POST', url: '/api/notifications/read', headers: { origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    const buy = await app.inject({ method: 'POST', url: '/api/deals/1/buy', headers: { origin: 'https://evil.example', host: 'localhost:4317' } });
    expect(buy.statusCode).toBe(403);
    // El propio dashboard (mismo origen) y las peticiones sin Origin (curl) sí pueden.
    const own = await app.inject({ method: 'POST', url: '/api/notifications/read', headers: { origin: 'http://localhost:4317', host: 'localhost:4317' } });
    expect(own.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/notifications/read' })).statusCode).toBe(200);
    // Las lecturas no se bloquean por origen (el navegador ya impide leer la respuesta).
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example' } })).statusCode).toBe(200);
  });
});

describe('sync de la cuenta', () => {
  it('guarda anuncios, notificaciones y favoriters; la primera sync no avisa', async () => {
    const res = await sync(snapshot());
    expect(res.json()).toMatchObject({ listings: 1, new_events: 1, warning: null });
    expect(sent).toEqual([]);

    const [saved] = await listings();
    expect(saved).toMatchObject({ vinted_id: '7001', title: 'Camisa de lino', price: 20, status: 'activo', favs: 3, views: 40, item_id: null });
    expect(await notifications()).toMatchObject([
      { vinted_id: 'n:aaa-1', type: 'favorito', listing_title: 'Camisa de lino', read: true },
    ]);
    expect(db.prepare('SELECT vinted_user_id, username, has_conversation, offered_at FROM favoriters').all()).toEqual([
      { vinted_user_id: '555', username: 'ana', has_conversation: 0, offered_at: null },
    ]);
    expect(await status()).toMatchObject({ paused: false, notice: null, account: '1234' });
    expect((await status()).last_sync_at).not.toBeNull();
  });

  it('avisa una sola vez de cada favorito y mensaje nuevos', async () => {
    await sync(snapshot());
    const message: SyncEvent = {
      vinted_id: 'm:900:2026-11-10T16:00:00.000Z',
      type: 'mensaje',
      text: 'luis: ¿Me lo dejas en 15?',
      listing_vinted_id: null,
      user_id: '777',
      username: 'luis',
      at: '2026-11-10T16:00:00.000Z',
      read: false,
    };
    const next = snapshot({
      events: [favourite(), favourite({ vinted_id: 'n:aaa-2', user_id: '666', username: 'eva', text: 'eva ha marcado como favorito tu artículo "Camisa de lino".' }), message],
    });
    expect((await sync(next)).json()).toMatchObject({ new_events: 2 });
    expect(sent).toEqual([
      '⭐ Nuevo favorito\neva ha marcado como favorito tu artículo "Camisa de lino".',
      '💬 Nuevo mensaje\nluis: ¿Me lo dejas en 15?',
    ]);

    await sync(next);
    expect(sent).toHaveLength(2);
    expect(await notifications()).toHaveLength(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM favoriters').get()).toEqual({ n: 2 });
  });

  it('detecta una venta cuando un anuncio conocido pasa a vendido', async () => {
    await sync(snapshot());
    const sold = snapshot({ listings: [listing({ status: 'vendido' })] });
    await sync(sold);
    expect(sent).toEqual(['💰 Venta\nVendido: Camisa de lino (20,00 €)']);
    expect((await notifications())[0]).toMatchObject({ vinted_id: 's:7001', type: 'venta', read: false, listing_title: 'Camisa de lino' });

    await sync(sold);
    expect(sent).toHaveLength(1);
    expect((await listings())[0]?.status).toBe('vendido');
  });

  it('las notificaciones de tipo "otro" se guardan pero no avisan', async () => {
    await sync(snapshot());
    await sync(snapshot({ events: [favourite(), favourite({ vinted_id: 'n:bbb', type: 'otro', text: 'Tu pedido está en camino', listing_vinted_id: null })] }));
    expect(sent).toEqual([]);
    expect(await notifications()).toHaveLength(2);
  });

  it('agrupa los avisos si llegan muchos de golpe', async () => {
    await sync(snapshot());
    const many = Array.from({ length: 11 }, (_, i) => favourite({ vinted_id: `n:lote-${i}`, user_id: String(1000 + i), username: `u${i}` }));
    await sync(snapshot({ events: many }));
    expect(sent).toHaveLength(9);
    expect(sent[8]).toBe('…y 3 novedades más en Vinted. Míralas en Notificaciones.');
  });

  it('si Telegram falla, la sync se guarda y devuelve un aviso', async () => {
    await sync(snapshot());
    telegramOk = false;
    const res = await sync(snapshot({ events: [favourite({ vinted_id: 'n:ccc', user_id: '888' })] }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ new_events: 1, warning: 'fallo simulado' });
    expect(await notifications()).toHaveLength(2);
  });

  it('actualiza los anuncios y conserva el enlace con el item', async () => {
    await sync(snapshot());
    const itemId = Number(db.prepare("INSERT INTO items (name, stock) VALUES ('Camisa', 'listado')").run().lastInsertRowid);
    const [saved] = await listings();
    const link = await app.inject({ method: 'PATCH', url: `/api/listings/${saved?.id}`, payload: { item_id: itemId } });
    expect(link.statusCode).toBe(200);
    expect(link.json()).toMatchObject({ item_id: itemId, item_name: 'Camisa' });

    await sync(snapshot({ listings: [listing({ price: 18, favs: 5, views: 61, title: 'Camisa de lino blanca', listed_at: null })] }));
    expect((await listings())[0]).toMatchObject({
      title: 'Camisa de lino blanca',
      price: 18,
      favs: 5,
      views: 61,
      item_id: itemId,
      listed_at: '2026-10-01T10:00:00.000Z',
    });
  });

  it('un anuncio que desaparece del armario completo deja de estar activo', async () => {
    await sync(snapshot({ listings: [listing(), listing({ vinted_id: '7002', title: 'Pantalón' }), listing({ vinted_id: '7003', title: 'Bolso', status: 'vendido' })] }));
    await sync(snapshot({ listings: [listing()], listings_complete: false }));
    expect((await listings()).map((l) => l.status).sort()).toEqual(['activo', 'activo', 'vendido']);

    await sync(snapshot({ listings: [listing()] }));
    const byId = Object.fromEntries((await listings()).map((l) => [l.vinted_id, l.status]));
    expect(byId).toEqual({ '7001': 'activo', '7002': 'no_visible', '7003': 'vendido' });
    expect(sent).toEqual([]);
  });

  it('marca has_conversation en los favoriters con los que ya se ha hablado', async () => {
    await sync(snapshot({ conversation_user_ids: ['555', '999'] }));
    expect(db.prepare('SELECT has_conversation FROM favoriters').get()).toEqual({ has_conversation: 1 });
  });

  it('no mezcla dos cuentas de Vinted', async () => {
    await sync(snapshot());
    const other = await sync(snapshot({ account: '9999', listings: [listing({ vinted_id: '8001' })] }));
    expect(other.statusCode).toBe(409);
    expect(await listings()).toHaveLength(1);

    await app.inject({ method: 'POST', url: '/api/vinted/forget-account' });
    expect((await sync(snapshot({ account: '9999' }))).statusCode).toBe(200);
    expect(sent).toEqual([]);
  });
});

describe('anuncios y notificaciones en el dashboard', () => {
  it('calcula días publicado y marca stale solo los activos', async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await sync(
      snapshot({
        listings: [
          listing({ vinted_id: '1', listed_at: old }),
          listing({ vinted_id: '2', listed_at: recent }),
          listing({ vinted_id: '3', listed_at: old, status: 'vendido' }),
          listing({ vinted_id: '4', listed_at: null }),
        ],
        events: [],
      }),
    );
    const byId = Object.fromEntries((await listings()).map((l) => [l.vinted_id, [l.days_listed, l.stale]]));
    expect(byId).toEqual({ '1': [20, true], '2': [3, false], '3': [20, false], '4': [null, false] });

    db.prepare("UPDATE settings SET value = '30' WHERE key = 'STALE_DAYS'").run();
    expect((await listings()).some((l) => l.stale)).toBe(false);
  });

  it('enlazar valida item, anuncio y que el item no esté ya enlazado', async () => {
    await sync(snapshot({ listings: [listing(), listing({ vinted_id: '7002', title: 'Pantalón' })] }));
    const itemId = Number(db.prepare("INSERT INTO items (name) VALUES ('Camisa')").run().lastInsertRowid);
    const [a, b] = await listings();
    const patch = (id: unknown, payload: object) => app.inject({ method: 'PATCH', url: `/api/listings/${id}`, payload });

    expect((await patch(a?.id, { item_id: itemId })).statusCode).toBe(200);
    const duplicate = await patch(b?.id, { item_id: itemId });
    expect(duplicate.statusCode).toBe(400);
    expect((duplicate.json() as { issues: { message: string }[] }).issues[0]?.message).toMatch(/ya está enlazado/);
    expect((await patch(a?.id, { item_id: itemId })).statusCode).toBe(200);
    expect((await patch(a?.id, { item_id: 9999 })).statusCode).toBe(404);
    expect((await patch(9999, { item_id: null })).statusCode).toBe(404);
    expect((await patch('abc', { item_id: null })).statusCode).toBe(404);
    expect((await patch(a?.id, { item_id: 'x' })).statusCode).toBe(400);

    expect((await patch(a?.id, { item_id: null })).json()).toMatchObject({ item_id: null, item_name: null });
    expect((await patch(b?.id, { item_id: itemId })).statusCode).toBe(200);

    // Borrar el item deshace el enlace sin borrar el anuncio.
    await app.inject({ method: 'DELETE', url: `/api/items/${itemId}` });
    expect((await listings()).map((l) => l.item_id)).toEqual([null, null]);
  });

  it('las notificaciones se marcan como leídas en ResellPilot y la sync no lo deshace', async () => {
    await sync(snapshot({ events: [favourite({ read: false }), favourite({ vinted_id: 'n:aaa-2', user_id: '666', read: false })] }));
    const [first] = await notifications();
    expect((await post('/api/notifications/read', { ids: [first?.id] }, null)).json()).toEqual({ updated: 1 });
    expect((await notifications()).map((n) => n.read).sort()).toEqual([false, true]);

    await sync(snapshot({ events: [favourite({ read: false }), favourite({ vinted_id: 'n:aaa-2', user_id: '666', read: false })] }));
    expect((await notifications()).filter((n) => n.read)).toHaveLength(1);

    expect((await post('/api/notifications/read', {}, null)).json()).toEqual({ updated: 1 });
    expect((await notifications()).every((n) => n.read)).toBe(true);
  });
});

describe('pausa de la extensión', () => {
  it('guarda el motivo y avisa por Telegram una sola vez', async () => {
    const notice = 'Vinted respondió 403 (acceso denegado).';
    expect((await post('/api/vinted/state', { paused: true, notice }, 'https://www.vinted.es')).statusCode).toBe(403);
    expect((await post('/api/vinted/state', { paused: true, notice })).statusCode).toBe(200);
    await post('/api/vinted/state', { paused: true, notice });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('ha pausado la lectura de Vinted');
    expect(sent[0]).toContain(notice);
    expect(await status()).toMatchObject({ paused: true, notice });

    // Una sync correcta posterior limpia la pausa.
    await sync(snapshot());
    expect(await status()).toMatchObject({ paused: false, notice: null });
  });
});
