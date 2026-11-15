import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DealView, RawSearchCard, TrendView } from '@resellpilot/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, defaultDealsDeps } from '../src/app';
import { DEFAULT_EXTENSION_ID } from '../src/config';
import { openDb, type Db } from '../src/db';
import { insertDeal } from '../src/deals/repo';
import { rescoreAll, scoringContext } from '../src/deals/service';
import type { Notifier } from '../src/telegram';
import { MAX_QUERIES_PER_SYNC, dueQueries, getIdClock, recordTrends } from '../src/trends/service';

const ORIGIN = `chrome-extension://${DEFAULT_EXTENSION_ID}`;
const DAY = 86_400_000;
const RATE = 13_300_000;
const MAX_ID = 10_700_000_000;

let dir: string;
let blocklistPath: string;
let db: Db;
let app: FastifyInstance;
let sent: string[];

const notifier: Notifier = {
  configured: () => true,
  send: async (text) => {
    sent.push(text);
    return { ok: true };
  },
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'resellpilot-trends-'));
  blocklistPath = join(dir, 'brand-blocklist.json');
  writeFileSync(blocklistPath, JSON.stringify(['Nike']));
  db = openDb(':memory:');
  sent = [];
  app = await buildApp({ db, dashboard: 'none', deals: { ...defaultDealsDeps(db), notifier, blocklistPath } });
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Tarjeta publicada hace `days` días. */
const card = (days: number, price: string, favs = ''): RawSearchCard => ({
  id: String(MAX_ID - days * RATE),
  price_text: price,
  favs_text: favs,
});
// mediana 25 · p25 17,5 · est 21,25 · favs/día 28 / (10 + 5 + 2 + 1) = 1,556
const CARDS = [card(10, '10,00 €', '20'), card(5, '20,00 €', '5'), card(2, '30,00 €'), card(0, '40,00 €', '3')];
const result = (query: string, cards = CARDS, total = '500+ resultados') => ({ query, total_text: total, cards });

const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/settings', payload });
const postTrends = (payload: object, origin = ORIGIN) =>
  app.inject({ method: 'POST', url: '/api/vinted/trends', payload, headers: { origin } });
const trends = async () =>
  (await app.inject({ method: 'GET', url: '/api/trends' })).json() as { trends: TrendView[]; due: number; calibrated_at: string | null };
const deals = async () => (await app.inject({ method: 'GET', url: '/api/deals' })).json() as DealView[];
const config = async () =>
  (await app.inject({ method: 'GET', url: '/api/vinted/config', headers: { origin: ORIGIN } })).json() as { trend_queries: string[] };

function addDeal(title: string, price: number | null, url = `https://tienda.example/${encodeURIComponent(title)}`) {
  const deal = insertDeal(db, { url, source: 'test', title, price, image: null, found_at: new Date().toISOString() });
  rescoreAll(db, scoringContext(db, blocklistPath));
  return deal.id;
}

describe('consultas a medir', () => {
  it('semillas + derivadas de items sin vender y de deals sin riesgo, sin repetir', async () => {
    await put({ trend_seeds: ['Termo acero', '  termo   ACERO ', 'Lámpara LED'] });
    db.prepare("INSERT INTO items (name, stock) VALUES ('Termo de acero 500 ml', 'en_mano'), ('Bolso viejo', 'vendido')").run();
    addDeal('Organizador de cables para escritorio', 6.9);
    addDeal('Sudadera Nike Tech', 20);

    const view = await trends();
    expect(view.trends.map((t) => [t.query, t.origins.sort(), t.pending])).toEqual([
      ['lampara led', ['semilla'], true],
      ['organizador cables escritorio', ['deal'], true],
      ['termo acero', ['item', 'semilla'], true],
    ]);
    expect(view.due).toBe(3);
    // Las semillas van primero.
    expect((await config()).trend_queries).toEqual(['termo acero', 'lampara led', 'organizador cables escritorio']);
  });

  it('respeta la caché, el tope por sync y el límite por hora', async () => {
    await put({ trend_seeds: Array.from({ length: 12 }, (_, i) => `consulta numero${i}`) });
    const first = dueQueries(db);
    expect(first).toHaveLength(MAX_QUERIES_PER_SYNC);

    const now = new Date();
    recordTrends(db, { max_id_now: MAX_ID, results: first.map((query) => result(query)) }, now);
    const second = dueQueries(db, now);
    expect(second).toHaveLength(4);
    expect(second.some((query) => first.includes(query))).toBe(false);

    // Pasada la caché (6 h) vuelven a tocar; primero las nunca medidas.
    const later = new Date(now.getTime() + 7 * 3_600_000);
    expect(dueQueries(db, later).slice(0, 4).sort()).toEqual([...second].sort());

    // Límite por hora: 8 búsquedas + 1 calibración hechas en la última hora + 1 reservada para la
    // próxima calibración → con un máximo de 11 cabe 1 más; con 10, ninguna.
    await put({ settings: { TRENDS_MAX_REQ_PER_HOUR: 11 } });
    expect(dueQueries(db, now)).toHaveLength(1);
    await put({ settings: { TRENDS_MAX_REQ_PER_HOUR: 10 } });
    expect(dueQueries(db, now)).toEqual([]);
    // Pasada la hora, las peticiones anteriores ya no cuentan.
    expect(dueQueries(db, new Date(now.getTime() + 61 * 60_000))).toHaveLength(4);
    await put({ settings: { TRENDS_MAX_REQ_PER_HOUR: 0 } });
    expect(dueQueries(db, later)).toEqual([]);
  });
});

describe('resultados de las búsquedas', () => {
  it('solo los acepta de la extensión y con el formato exacto', async () => {
    await put({ trend_seeds: ['termo acero'] });
    const payload = { max_id_now: MAX_ID, results: [result('termo acero')] };
    expect((await postTrends(payload, 'https://www.vinted.es')).statusCode).toBe(403);
    expect((await postTrends({ ...payload, cookies: 'x' })).statusCode).toBe(400);
    expect((await postTrends({ max_id_now: MAX_ID, results: [{ ...result('termo acero'), html: '<html>' }] })).statusCode).toBe(400);
    expect((await trends()).trends[0]?.pending).toBe(true);
    const ok = await postTrends(payload);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ saved: 1, deals: 0 });
  });

  it('calcula mediana, p25, total, favoritos y favs/día, y ordena por demanda', async () => {
    await put({ trend_seeds: ['termo acero', 'lampara led', 'sin resultados'] });
    await postTrends({
      max_id_now: MAX_ID,
      results: [
        result('Termo Acero'),
        result('lampara led', [card(4, '8,00 €', '40'), card(3, '12,00 €', '30')], '37 resultados'),
        result('sin resultados', [], ''),
        result('consulta que nadie pidió'),
      ],
    });

    const view = await trends();
    expect(view.calibrated_at).not.toBeNull();
    expect(view.due).toBe(0);
    expect(view.trends).toMatchObject([
      { query: 'lampara led', median_price: 10, p25_price: 9, est_price: 9.5, listings_count: 37, avg_favs: 35, favs_per_day: 10, pending: false, week_change: null },
      { query: 'termo acero', median_price: 25, p25_price: 17.5, est_price: 21.25, listings_count: 500, avg_favs: 7, favs_per_day: 1.556, pending: false },
      { query: 'sin resultados', median_price: null, est_price: null, listings_count: 0, favs_per_day: null, pending: false },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM trends').get()).toEqual({ n: 3 });
  });

  it('variación frente a la semana anterior', async () => {
    await put({ trend_seeds: ['termo acero'] });
    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY);
    // Hace una semana: 14 favoritos / 18 días = 0,778 favs/día.
    const older = [card(10, '10,00 €', '10'), card(5, '20,00 €', '2'), card(2, '30,00 €'), card(0, '40,00 €', '2')];
    recordTrends(db, { max_id_now: MAX_ID, results: [result('termo acero', older)] }, weekAgo);
    recordTrends(db, { max_id_now: MAX_ID + 7 * RATE, results: [result('termo acero', CARDS.map((c) => ({ ...c, id: String(Number(c.id) + 7 * RATE) })))] }, new Date(now));

    const [trend] = (await trends()).trends;
    // De 0,778 a 1,556: +100 %
    expect(trend).toMatchObject({ favs_per_day: 1.556, week_change: 1 });
    // El ritmo de ids se calibra con los dos puntos.
    expect(getIdClock(db)?.idsPerDay).toBeCloseTo(RATE, -3);
  });

  it('sin calibración guarda precios pero no demanda', async () => {
    await put({ trend_seeds: ['termo acero'] });
    await postTrends({ max_id_now: null, results: [result('termo acero')] });
    expect((await trends()).trends[0]).toMatchObject({ median_price: 25, favs_per_day: null });
  });
});

describe('precio estimado automático de los deals', () => {
  it('rellena est_price, demanda y competencia, recalcula el score y avisa', async () => {
    const id = addDeal('Termo de acero inoxidable 500ml', 6.9);
    addDeal('Sudadera Nike Tech', 10);
    await put({ trend_seeds: ['sudadera'] });

    const res = await postTrends({
      max_id_now: MAX_ID,
      results: [result('termo acero inoxidable'), result('sudadera', CARDS, '200 resultados')],
    });
    expect(res.json()).toEqual({ saved: 2, deals: 1 });

    const all = await deals();
    const termo = all.find((d) => d.id === id);
    // landed 7,20 · beneficio 14,05 · roi 1,9514
    // score = 100·(0,35·1,9514/3 + 0,25·14,05/30 + 0,25·1,556/2 + 0,15·(1 − 1)) = 53,9
    expect(termo).toMatchObject({
      est_price: 21.25,
      est_manual: false,
      demand: 1.556,
      competition: 500,
      est_profit: 14.05,
      roi: 1.9514,
      score: 53.9,
      recommended: true,
    });
    // El deal con riesgo de marca no recibe nada.
    expect(all.find((d) => d.title === 'Sudadera Nike Tech')).toMatchObject({ est_price: null, demand: null, score: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Termo de acero inoxidable 500ml');
  });

  it('un precio escrito a mano no se pisa; al borrarlo vuelve el automático', async () => {
    const id = addDeal('Termo de acero inoxidable 500ml', 6.9);
    await app.inject({ method: 'PATCH', url: `/api/deals/${id}`, payload: { est_price: 30 } });
    await postTrends({ max_id_now: MAX_ID, results: [result('termo acero inoxidable')] });

    let deal = (await deals()).find((d) => d.id === id);
    expect(deal).toMatchObject({ est_price: 30, est_manual: true, demand: 1.556, competition: 500 });

    const cleared = await app.inject({ method: 'PATCH', url: `/api/deals/${id}`, payload: { est_price: null } });
    expect(cleared.json()).toMatchObject({ est_price: 21.25, est_manual: false });
    deal = (await deals()).find((d) => d.id === id);
    expect(deal?.est_price).toBe(21.25);
  });

  it('no usa tendencias con menos de 5 anuncios ni sin precios', async () => {
    const id = addDeal('Termo de acero inoxidable 500ml', 6.9);
    await postTrends({
      max_id_now: MAX_ID,
      results: [result('termo acero inoxidable', [card(1, '50,00 €')], '1 resultado')],
    });
    expect((await deals()).find((d) => d.id === id)).toMatchObject({ est_price: null, demand: null });
  });
});

describe('ajustes', () => {
  it('devuelve ajustes, valores por defecto, semillas y URL de búsqueda', async () => {
    const res = (await app.inject({ method: 'GET', url: '/api/settings' })).json();
    expect(res).toMatchObject({
      settings: { STALE_DAYS: 14, DRY_RUN: true, MIN_ROI_PCT: 80 },
      defaults: { STALE_DAYS: 14 },
      trend_seeds: [],
      hacoo_search_url: 'https://dripsource.fit/',
    });
  });

  it('guarda cambios válidos y recalcula los deals', async () => {
    const id = addDeal('Organizador de cables', 6.9);
    await app.inject({ method: 'PATCH', url: `/api/deals/${id}`, payload: { est_price: 12 } });
    // beneficio 4,80 < 5 → no recomendado
    expect((await deals())[0]?.recommended).toBe(false);

    const res = await put({ settings: { MIN_PROFIT_EUR: 2, MIN_ROI_PCT: 50, PACKAGING_EUR: 0, STALE_DAYS: 21 }, hacoo_search_url: 'https://tienda.example/buscar?q={query}' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ settings: { MIN_PROFIT_EUR: 2, STALE_DAYS: 21, PACKAGING_EUR: 0 }, hacoo_search_url: 'https://tienda.example/buscar?q={query}' });
    expect((await deals())[0]).toMatchObject({ est_profit: 5.1, landed_cost: 6.9, recommended: true });
  });

  it('valida rangos, tipos y coherencia; con un error no guarda nada', async () => {
    const cases: [object, string][] = [
      [{ settings: { STALE_DAYS: 0 } }, 'STALE_DAYS'],
      [{ settings: { STALE_DAYS: 2.5 } }, 'STALE_DAYS'],
      [{ settings: { READ_MIN_INTERVAL_S: 0.1 } }, 'READ_MIN_INTERVAL_S'],
      [{ settings: { MAX_MESSAGES_PER_DAY: 500 } }, 'MAX_MESSAGES_PER_DAY'],
      [{ settings: { MSG_DELAY_MIN_S: 300, MSG_DELAY_MAX_S: 100 } }, 'MSG_DELAY_MAX_S'],
      [{ settings: { NO_EXISTE: 1 } }, 'NO_EXISTE'],
      [{ settings: { DRY_RUN: false } }, 'DRY_RUN'],
      [{ settings: { MIN_ROI_PCT: 10, STALE_DAYS: -1 } }, 'STALE_DAYS'],
      [{ hacoo_search_url: 'javascript:alert(1)' }, 'hacoo_search_url'],
    ];
    for (const [payload, path] of cases) {
      const res = await put(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect((res.json() as { issues: { path: string }[] }).issues.map((i) => i.path)).toContain(path);
    }
    expect((await put({ trend_seeds: ['x'] })).statusCode).toBe(400);
    const after = (await app.inject({ method: 'GET', url: '/api/settings' })).json() as { settings: Record<string, unknown> };
    expect(after.settings).toMatchObject({ STALE_DAYS: 14, MIN_ROI_PCT: 80, MSG_DELAY_MIN_S: 45, DRY_RUN: true });
  });
});
