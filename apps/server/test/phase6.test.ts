import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DealView, RepricingRow, SourceStatus, SyncPayload, WeeklyReport } from '@resellpilot/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { DEFAULT_EXTENSION_ID } from '../src/config';
import { openDb, type Db } from '../src/db';
import { Ingestor } from '../src/deals/ingest';
import { parsePrivateFeed, parsePrivateMessages } from '../src/deals/parsers';
import { scoringContext } from '../src/deals/service';
import type { Fetcher, HttpResponse } from '../src/http';
import {
  dailySummaryData,
  dailySummarySent,
  listRepricing,
  sendDailySummaryIfDue,
  weeklyReportCsv,
  weeklyReportFor,
} from '../src/reports/service';
import type { Notifier } from '../src/telegram';
import { applySync } from '../src/vinted/sync';

const ORIGIN = `chrome-extension://${DEFAULT_EXTENSION_ID}`;
const NOW = new Date(2026, 10, 15, 12, 0, 0); // domingo
const daysAgo = (days: number, from: Date = NOW): string => new Date(from.getTime() - days * 86_400_000).toISOString();

let dir: string;
let sourcesPath: string;
let blocklistPath: string;
let feedPath: string;
let db: Db;
let app: FastifyInstance;
let ingestor: Ingestor;
let sent: string[];
let telegramOk: boolean;
let configured: boolean;
let pages: Map<string, string>;

const notifier: Notifier = {
  configured: () => configured,
  send: async (text) => {
    sent.push(text);
    return telegramOk ? { ok: true } : { ok: false, error: 'fallo simulado' };
  },
};

const fetcher: Fetcher = async (url): Promise<HttpResponse> => {
  const text = pages.get(url);
  return text === undefined ? { status: 404, url, location: null, text: '' } : { status: 200, url, location: null, text };
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'resellpilot-f6-'));
  sourcesPath = join(dir, 'sources.json');
  blocklistPath = join(dir, 'brand-blocklist.json');
  feedPath = join(dir, 'telegram-private.json');
  writeFileSync(sourcesPath, '[]');
  writeFileSync(blocklistPath, JSON.stringify(['Nike']));
  sent = [];
  telegramOk = true;
  configured = true;
  pages = new Map();
  db = openDb(':memory:');
  ingestor = new Ingestor({ db, fetcher, notifier, sourcesPath, blocklistPath, privateFeedPath: feedPath, delayMs: 0 });
  app = await buildApp({ db, dashboard: 'none', deals: { ingestor, notifier, blocklistPath } });
});
afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const context = () => scoringContext(db, blocklistPath);
const addItem = (name: string, cost: number, stock = 'en_mano', soldPrice: number | null = null, soldAt: string | null = null): number =>
  Number(
    db
      .prepare('INSERT INTO items (name, cost, stock, sold_price, sold_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, cost, stock, soldPrice, soldAt, daysAgo(60)).lastInsertRowid,
  );
const addListing = (vintedId: string, title: string, price: number | null, listedDaysAgo: number, item: number | null = null, status = 'activo'): number =>
  Number(
    db
      .prepare('INSERT INTO listings (vinted_id, title, price, status, favs, views, listed_at, item_id) VALUES (?, ?, ?, ?, 2, 30, ?, ?)')
      .run(vintedId, title, price, status, daysAgo(listedDaysAgo, new Date()), item).lastInsertRowid,
  );
const actions = (action: string) =>
  db.prepare('SELECT target, result FROM action_log WHERE action = ? ORDER BY id').all(action) as { target: string; result: string }[];

describe('bajadas de precio sugeridas', () => {
  it('lista solo los anuncios stale, con margen si están enlazados, de más a menos días', async () => {
    const item = addItem('Termo', 15);
    addListing('1', 'Termo acero', 20, 40, item);
    addListing('2', 'Lámpara led', 10, 20);
    addListing('3', 'Recién publicado', 10, 3);
    addListing('4', 'Vendido hace tiempo', 10, 90, null, 'vendido');

    const rows = (await app.inject({ method: 'GET', url: '/api/repricing' })).json() as RepricingRow[];
    expect(rows.map((row) => row.vinted_id)).toEqual(['1', '2']);
    expect(rows[0]).toMatchObject({ title: 'Termo acero', price: 20, pct: 10, new_price: 18, total_cost: 15, margin: 3, item_name: 'Termo', below_cost: false });
    expect(rows[1]).toMatchObject({ pct: 5, new_price: 9.5, total_cost: null, margin: null });
  });

  it('tras una bajada no vuelve a sugerir otra hasta que pasen STALE_DAYS días', () => {
    addListing('1', 'Termo acero', 20, 40);
    const log = db.prepare('INSERT INTO action_log (ts, action, target, result) VALUES (?, ?, ?, ?)');
    log.run(daysAgo(3, new Date()), 'price_drop_manual', '1', '22 € → 20 €');
    expect(listRepricing(db)).toHaveLength(0);

    db.prepare('UPDATE action_log SET ts = ?').run(daysAgo(15, new Date()));
    expect(listRepricing(db)).toHaveLength(1);
    // Una simulación no cuenta como bajada.
    log.run(daysAgo(1, new Date()), 'price_drop_dry_run', '1', '20 € → 18 €');
    expect(listRepricing(db)).toHaveLength(1);
  });

  it('respeta STALE_DAYS', () => {
    addListing('1', 'Termo', 20, 10);
    expect(listRepricing(db)).toHaveLength(0);
    db.prepare("UPDATE settings SET value = '7' WHERE key = 'STALE_DAYS'").run();
    expect(listRepricing(db)).toMatchObject([{ pct: 5, days_listed: 10 }]);
  });
});

describe('bajada de precio hecha a mano en Vinted', () => {
  const payload = (price: number, status: SyncPayload['listings'][number]['status'] = 'activo'): SyncPayload => ({
    account: '1234',
    listings: [{ vinted_id: '7001', title: 'Termo acero', price, status, favs: 2, views: 10, listed_at: daysAgo(30) }],
    listings_complete: true,
    events: [
      { vinted_id: 'n:1', type: 'favorito', text: 'ana ha marcado…', listing_vinted_id: '7001', user_id: '555', username: 'ana', at: daysAgo(2), read: true },
    ],
    conversation_user_ids: [],
  });
  const offered = () => (db.prepare('SELECT offered_at FROM favoriters').get() as { offered_at: string | null }).offered_at;

  it('la registra y, si llega al descuento de las ofertas, da por avisados a los favoritos', () => {
    applySync(db, payload(20), NOW);
    expect(actions('price_drop_manual')).toHaveLength(0);

    // −5 %: se registra, pero los favoritos siguen pendientes de oferta.
    applySync(db, payload(19), new Date(NOW.getTime() + 60_000));
    expect(actions('price_drop_manual')).toEqual([{ target: '7001', result: '20 € → 19 €' }]);
    expect(offered()).toBeNull();

    // −10 % o más sobre el precio anterior.
    applySync(db, payload(17), new Date(NOW.getTime() + 120_000));
    expect(actions('price_drop_manual')).toHaveLength(2);
    expect(offered()).not.toBeNull();
  });

  it('no cuenta las subidas, los precios iguales ni los anuncios que ya no están activos', () => {
    applySync(db, payload(20), NOW);
    applySync(db, payload(20), NOW);
    applySync(db, payload(25), NOW);
    applySync(db, payload(10, 'vendido'), NOW);
    expect(actions('price_drop_manual')).toHaveLength(0);
    expect(offered()).toBeNull();
  });
});

describe('informe semanal', () => {
  beforeEach(() => {
    addItem('Termo', 5, 'vendido', 14, new Date(2026, 10, 10, 18, 0).toISOString());
    addItem('Lámpara', 4.5, 'vendido', 12.25, new Date(2026, 10, 14, 9, 0).toISOString());
    addItem('Semana pasada', 3, 'vendido', 9, new Date(2026, 10, 4, 9, 0).toISOString());
    addItem('Sin vender', 3);
  });

  it('suma las ventas de la semana (lunes a domingo)', () => {
    expect(weeklyReportFor(db, NOW)).toMatchObject({ monday: '2026-11-09', sunday: '2026-11-15', sales: 2, revenue: 26.25, cost: 9.5, profit: 16.75 });
    expect(weeklyReportFor(db, NOW, -1)).toMatchObject({ monday: '2026-11-02', sales: 1, profit: 6 });
  });

  it('exporta un CSV para Excel en español con fila de totales', () => {
    const csv = weeklyReportCsv(weeklyReportFor(db, NOW));
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(lines[0]).toBe('id;name;brand;sold_at;sold_price;total_cost;profit;roi');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^\d+;Termo;;2026-11-10T.*;14,00;5,00;9,00;1,8000$/);
    expect(lines[3]).toBe(';TOTAL 2026-11-09 a 2026-11-15 (2 ventas);;;26,25;9,50;16,75;1,7632');
  });

  it('se descarga por la API y valida la semana pedida', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/reports/weekly.csv?week=2026-11-04' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toBe('attachment; filename="resellpilot-beneficios-2026-11-02.csv"');
    expect(response.body).toContain('Semana pasada');
    expect(response.body).not.toContain('Termo');

    expect((await app.inject({ method: 'GET', url: '/api/reports/weekly.csv?week=ayer' })).statusCode).toBe(400);
    const both = (await app.inject({ method: 'GET', url: '/api/reports/weekly' })).json() as { current: WeeklyReport; previous: WeeklyReport };
    expect(both.current.monday > both.previous.monday).toBe(true);
  });
});

describe('resumen diario', () => {
  function seed() {
    const listing = addListing('1', 'Termo acero', 20, 0);
    db.prepare('UPDATE listings SET listed_at = ? WHERE id = ?').run(daysAgo(40), listing);
    const note = db.prepare('INSERT INTO notifications (vinted_id, type, text, listing_id, created_at) VALUES (?, ?, ?, ?, ?)');
    note.run('s:9', 'venta', 'Vendido: Funda móvil (9,00 €)', null, daysAgo(0.5));
    note.run('s:8', 'venta', 'Vendido: Antigua (5,00 €)', null, daysAgo(3));
    note.run('n:1', 'favorito', 'ana ha marcado…', listing, daysAgo(0.2));
    note.run('n:2', 'favorito', 'luis ha marcado…', listing, daysAgo(0.3));
    note.run('n:3', 'favorito', 'viejo…', listing, daysAgo(5));
    addItem('Funda móvil', 2, 'vendido', 9, daysAgo(0.5));
    const deal = db.prepare("INSERT INTO deals (url, title, price, est_price, status) VALUES (?, ?, ?, ?, 'nuevo')");
    deal.run('https://tienda.example/p/1', 'Organizador cables', 3, 14);
    deal.run('https://tienda.example/p/2', 'Zapatillas Nike', 10, 60); // riesgo de marca: nunca recomendada
    deal.run('https://tienda.example/p/3', 'Poco margen', 10, 11);
    ingestor.status(); // sin fuentes
  }

  it('reúne ventas, favoritos y stale de las últimas 24 h y las oportunidades recomendadas', async () => {
    seed();
    await ingestor.runAll(); // puntúa los deals
    const data = dailySummaryData(db, context(), NOW);
    expect(data).toMatchObject({
      sales: ['Vendido: Funda móvil (9,00 €)'],
      sold_items: 1,
      sold_profit: 7,
      new_favs: 2,
      fav_listings: [{ title: 'Termo acero', count: 2 }],
      stale_count: 1,
      stale: [{ title: 'Termo acero', days: 40 }],
    });
    expect(data.deals.map((deal) => deal.title)).toEqual(['Organizador cables']);
  });

  it('se envía una sola vez al día, a partir de las 08:30, y solo con Telegram configurado', async () => {
    seed();
    const early = new Date(2026, 10, 15, 8, 0);
    const morning = new Date(2026, 10, 15, 8, 30);
    expect(await sendDailySummaryIfDue(db, notifier, context(), early)).toBe(false);

    configured = false;
    expect(await sendDailySummaryIfDue(db, notifier, context(), morning)).toBe(false);
    configured = true;

    expect(await sendDailySummaryIfDue(db, notifier, context(), morning)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('ResellPilot · domingo, 15 de noviembre');
    expect(dailySummarySent(db, morning)).toBe(true);

    // El mismo día no se repite (p. ej. al reiniciar el server); al día siguiente sí.
    expect(await sendDailySummaryIfDue(db, notifier, context(), new Date(2026, 10, 15, 20, 0))).toBe(false);
    expect(await sendDailySummaryIfDue(db, notifier, context(), new Date(2026, 10, 16, 9, 0))).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('si Telegram falla no lo da por enviado y lo reintenta', async () => {
    telegramOk = false;
    const morning = new Date(2026, 10, 15, 9, 0);
    expect(await sendDailySummaryIfDue(db, notifier, context(), morning)).toBe(false);
    expect(dailySummarySent(db, morning)).toBe(false);
    expect(actions('telegram_error')).toHaveLength(0); // el intento automático no ensucia el registro
    telegramOk = true;
    expect(await sendDailySummaryIfDue(db, notifier, context(), morning)).toBe(true);
  });

  it('la API da la vista previa y permite enviarlo a mano', async () => {
    const preview = (await app.inject({ method: 'GET', url: '/api/reports/daily' })).json() as { text: string; telegram: boolean; sent_today: boolean };
    expect(preview).toMatchObject({ telegram: true, sent_today: false });
    expect(preview.text).toContain('💰 Ventas (24 h): 0');

    const response = await app.inject({ method: 'POST', url: '/api/reports/daily/send' });
    expect(response.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);

    // Como cualquier otra escritura, solo desde el propio dashboard o la extensión.
    const foreign = await app.inject({ method: 'POST', url: '/api/reports/daily/send', headers: { origin: 'https://otra.example' } });
    expect(foreign.statusCode).toBe(403);
    expect(ORIGIN).toContain('chrome-extension://');
  });
});

describe('grupos privados de Telegram (puente de Telethon)', () => {
  const GROUP = 'https://t.me/c/123456789';
  const PRODUCT = 'https://tienda.example/p/organizador';
  const feed = (updatedAt: string, messages: unknown[]) =>
    writeFileSync(feedPath, JSON.stringify({ updated_at: updatedAt, sources: { [GROUP]: messages } }));
  const run = async () => ((await app.inject({ method: 'POST', url: '/api/ingest/run' })).json() as { sources: SourceStatus[] }).sources;
  const deals = async () => (await app.inject({ method: 'GET', url: '/api/deals' })).json() as DealView[];

  beforeEach(() => {
    writeFileSync(sourcesPath, JSON.stringify([{ name: 'Grupo privado', type: 'telegram_private', url: GROUP, link_regex: 'https?://tienda\\.example/p/[a-z0-9-]+' }]));
    pages.set(PRODUCT, '<html><head><meta property="og:title" content="Organizador de cables"><meta property="product:price:amount" content="3.50"></head></html>');
  });

  it('sin el archivo del puente explica cómo activarlo', async () => {
    expect(await run()).toMatchObject([{ ok: false, error: expect.stringContaining('tools/telethon_bridge.py') }]);
  });

  it('crea deals a partir de los mensajes que deja el puente, sin repetirlos', async () => {
    feed(new Date().toISOString(), [
      { text: `🔥 Organizador de cables magnético\n${PRODUCT}`, date: '2026-11-15T10:00:00Z' },
      { text: 'Mensaje sin enlaces' },
      { text: `Otra vez ${PRODUCT}` },
      { sin_texto: true },
    ]);
    expect(await run()).toMatchObject([{ name: 'Grupo privado', ok: true, found: 1, added: 1, error: null }]);
    expect(await deals()).toMatchObject([{ url: PRODUCT, source: 'Grupo privado', price: 3.5 }]);

    expect(await run()).toMatchObject([{ ok: true, found: 1, added: 0 }]);
    expect(await deals()).toHaveLength(1);
  });

  it('avisa si el puente lleva más de una hora parado o no conoce el grupo', async () => {
    feed(new Date(Date.now() - 2 * 3_600_000).toISOString(), [{ text: PRODUCT }]);
    expect(await run()).toMatchObject([{ ok: false, added: 1, error: expect.stringContaining('más de 1 h') }]);

    writeFileSync(feedPath, JSON.stringify({ updated_at: new Date().toISOString(), sources: {} }));
    expect(await run()).toMatchObject([{ ok: false, error: expect.stringContaining('aún no ha leído este grupo') }]);

    writeFileSync(feedPath, '{ roto');
    expect(await run()).toMatchObject([{ ok: false, error: expect.stringContaining('JSON válido') }]);
  });

  it('el parser tolera cualquier forma del archivo y usa la primera línea como título', () => {
    expect(parsePrivateFeed(null)).toEqual({ updated_at: null, sources: {} });
    expect(parsePrivateFeed({ updated_at: 'ayer', sources: { a: 'x', b: [{ text: ' ' }, { text: 'hola' }, 3] } })).toEqual({
      updated_at: null,
      sources: { b: [{ text: 'hola' }] },
    });
    expect(parsePrivateMessages([{ text: `✨ Termo acero 500 ml ✨\nprecio 4€ ${PRODUCT}` }], 'https?://tienda\\.example/p/[a-z0-9-]+')).toEqual([
      { link: PRODUCT, title: 'Termo acero 500 ml', image: null },
    ]);
  });
});
