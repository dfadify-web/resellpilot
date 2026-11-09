import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DealView, ItemWithCalc, SourceStatus } from '@resellpilot/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb, type Db } from '../src/db';
import { Ingestor } from '../src/deals/ingest';
import { loadBlocklist, loadSources } from '../src/deals/sources';
import type { Fetcher, HttpResponse } from '../src/http';
import { getRawSetting } from '../src/settings';
import { createTelegramNotifier, type Notifier } from '../src/telegram';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string): string => readFileSync(join(fixturesDir, name), 'utf8');

const TELEGRAM_URL = 'https://t.me/s/canal_prueba';
const WEB_URL = 'https://catalogo.example/categorie/accessoires';
const ORGANIZER = 'https://catalogo.example/produit/organisateur-cables-179000000000001';
const BAG = 'https://catalogo.example/produit/ralph-lauren-179000000000002';

const SOURCES = [
  { type: 'telegram_public', url: TELEGRAM_URL, link_regex: 'https?://c\\.onlyaff\\.app/[A-Za-z0-9]+' },
  { name: 'Catálogo', type: 'web', url: WEB_URL, link_regex: '/produit/[a-z0-9-]+' },
];

type Route = { status?: number; location?: string; text?: string } | Error;

let dir: string;
let sourcesPath: string;
let blocklistPath: string;
let db: Db;
let app: FastifyInstance;
let ingestor: Ingestor;
let routes: Map<string, Route>;
let requests: string[];
let sent: string[];
let notifierOk: boolean;

const fetcher: Fetcher = async (url): Promise<HttpResponse> => {
  requests.push(url);
  const route = routes.get(url);
  if (route instanceof Error) throw route;
  if (!route) return { status: 404, url, location: null, text: '' };
  return { status: route.status ?? 200, url, location: route.location ?? null, text: route.text ?? '' };
};

const notifier: Notifier = {
  configured: () => true,
  send: async (text) => {
    sent.push(text);
    return notifierOk ? { ok: true } : { ok: false, error: 'fallo simulado' };
  },
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'resellpilot-deals-'));
  sourcesPath = join(dir, 'sources.json');
  blocklistPath = join(dir, 'brand-blocklist.json');
  writeFileSync(sourcesPath, JSON.stringify(SOURCES));
  writeFileSync(blocklistPath, JSON.stringify(['Nike', 'Ralph Lauren']));

  const shell = fixture('hacoo-spa-shell.html');
  routes = new Map<string, Route>([
    [TELEGRAM_URL, { text: fixture('telegram-channel.html') }],
    ['https://c.onlyaff.app/abc111', { status: 302, location: 'https://www.hacoo.pl/p/111?f=p_aff.o_uno&ets=1' }],
    ['https://www.hacoo.pl/p/111?f=p_aff.o_uno&ets=1', { text: shell }],
    ['https://c.onlyaff.app/abc222', { status: 302, location: 'https://www.hacoo.pl/p/222?f=p_aff.o_uno&ets=2' }],
    ['https://www.hacoo.pl/p/222?f=p_aff.o_uno&ets=2', { text: shell }],
    // Otro enlace corto al mismo producto 111, con otro afiliado.
    ['https://c.onlyaff.app/abc333', { status: 302, location: 'https://www.hacoo.pl/p/111?f=p_aff.o_otro&ets=3' }],
    ['https://www.hacoo.pl/p/111?f=p_aff.o_otro&ets=3', { text: shell }],
    [WEB_URL, { text: fixture('web-listing.html') }],
    [ORGANIZER, { text: fixture('product-jsonld.html') }],
    [BAG, { text: fixture('product-jsonld-brand.html') }],
  ]);
  requests = [];
  sent = [];
  notifierOk = true;

  db = openDb(':memory:');
  ingestor = new Ingestor({ db, fetcher, notifier, sourcesPath, blocklistPath, delayMs: 0 });
  app = await buildApp({ db, dashboard: 'none', deals: { ingestor, notifier, blocklistPath } });
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const deals = async (query = '') =>
  (await app.inject({ method: 'GET', url: `/api/deals${query}` })).json() as DealView[];
const byUrl = async (url: string) => (await deals()).find((deal) => deal.url === url) as DealView;
const patch = (id: number, payload: object) => app.inject({ method: 'PATCH', url: `/api/deals/${id}`, payload });
const run = async () =>
  ((await app.inject({ method: 'POST', url: '/api/ingest/run' })).json() as { sources: SourceStatus[] }).sources;

describe('ingesta', () => {
  it('crea un deal por producto: resuelve enlaces cortos, normaliza la URL y deduplica', async () => {
    const statuses = await run();
    expect(statuses).toMatchObject([
      { name: '@canal_prueba', type: 'telegram_public', ok: true, found: 3, added: 2, error: null },
      { name: 'Catálogo', type: 'web', ok: true, found: 2, added: 2, error: null },
    ]);

    const all = await deals();
    expect(all.map((d) => d.url).sort()).toEqual([
      ORGANIZER,
      BAG,
      'https://www.hacoo.pl/p/111',
      'https://www.hacoo.pl/p/222',
    ].sort());
    expect(all.every((d) => d.status === 'nuevo')).toBe(true);
  });

  it('si el parser no saca datos guarda el deal con price = null y las pistas del mensaje', async () => {
    await run();
    expect(await byUrl('https://www.hacoo.pl/p/111')).toMatchObject({
      source: '@canal_prueba',
      title: 'Termo acero 500ml',
      price: null,
      image: 'https://cdn4.telesco.pe/file/foto-termo-1.jpg',
      est_price: null,
      est_profit: null,
      roi: null,
      score: 0,
      risk_flags: [],
      recommended: false,
      landed_cost: null,
    });
  });

  it('lee título, precio e imagen de la página de producto', async () => {
    await run();
    expect(await byUrl(ORGANIZER)).toMatchObject({
      source: 'Catálogo',
      title: 'Organisateur de câbles',
      price: 6.9,
      image: 'https://img.example/179000000000001_1.jpg',
      risk_flags: [],
      landed_cost: 7.2,
    });
  });

  it('marca riesgo_marca por el título o por la marca que declara la página', async () => {
    await run();
    expect(await byUrl('https://www.hacoo.pl/p/222')).toMatchObject({
      title: 'Sudadera Nike Tech & pantalón',
      risk_flags: ['riesgo_marca'],
    });
    expect(await byUrl(BAG)).toMatchObject({
      title: 'Sac bandoulière · Ralph Lauren',
      price: 45.4,
      risk_flags: ['riesgo_marca'],
    });
  });

  it('una segunda ejecución no vuelve a pedir enlaces ya vistos ni duplica deals', async () => {
    await run();
    requests = [];
    const statuses = await run();
    expect(requests.sort()).toEqual([TELEGRAM_URL, WEB_URL].sort());
    expect(statuses.map((s) => [s.found, s.added])).toEqual([[3, 0], [2, 0]]);
    expect(await deals()).toHaveLength(4);
  });

  it('respeta el máximo de enlaces nuevos por ejecución y sigue en la siguiente', async () => {
    const limited = new Ingestor({ db, fetcher, notifier, sourcesPath, blocklistPath, delayMs: 0, maxNewPerRun: 1 });
    expect((await limited.runAll()).map((s) => s.added)).toEqual([1, 1]);
    expect((await limited.runAll()).map((s) => s.added)).toEqual([1, 1]);
    expect(await deals()).toHaveLength(4);
  });

  it('un fallo de red no marca el enlace como visto: se reintenta', async () => {
    routes.set(ORGANIZER, new Error('timeout'));
    let statuses = await run();
    expect(statuses[1]).toMatchObject({ ok: false, added: 1 });
    expect(statuses[1]?.error).toMatch(/1 enlace/);
    expect(await deals()).toHaveLength(3);

    routes.set(ORGANIZER, { text: fixture('product-jsonld.html') });
    statuses = await run();
    expect(statuses[1]).toMatchObject({ ok: true, added: 1, error: null });
    expect(await deals()).toHaveLength(4);
  });

  it('un 404 se descarta para siempre; otros errores HTTP crean el deal sin datos', async () => {
    routes.set(ORGANIZER, { status: 404 });
    routes.set(BAG, { status: 403, text: 'Forbidden' });
    await run();
    const all = await deals();
    expect(all.find((d) => d.url === ORGANIZER)).toBeUndefined();
    expect(all.find((d) => d.url === BAG)).toMatchObject({ title: null, price: null, risk_flags: [] });

    requests = [];
    await run();
    expect(requests).not.toContain(ORGANIZER);
  });

  it('si una fuente falla, las demás siguen', async () => {
    routes.set(TELEGRAM_URL, { status: 500 });
    const statuses = await run();
    expect(statuses[0]).toMatchObject({ ok: false, added: 0, error: 'La fuente respondió 500.' });
    expect(statuses[1]).toMatchObject({ ok: true, added: 2 });
  });

  it('nunca pide direcciones locales aunque una fuente redirija a ellas', async () => {
    routes.set('https://c.onlyaff.app/abc111', { status: 302, location: 'http://127.0.0.1:4317/api/items' });
    const statuses = await run();
    expect(statuses[0]?.ok).toBe(false);
    expect(requests.some((url) => url.includes('127.0.0.1'))).toBe(false);
  });

  it('dos ejecuciones simultáneas comparten el mismo trabajo', async () => {
    await Promise.all([ingestor.runAll(), ingestor.runAll()]);
    expect(requests.filter((url) => url === TELEGRAM_URL)).toHaveLength(1);
    expect(await deals()).toHaveLength(4);
  });

  it('GET /api/sources lista las fuentes y su última ejecución', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/sources' })).json() as {
      telegram: boolean;
      sources: SourceStatus[];
    };
    expect(before.telegram).toBe(true);
    expect(before.sources.map((s) => [s.name, s.ok, s.last_run_at])).toEqual([
      ['@canal_prueba', null, null],
      ['Catálogo', null, null],
    ]);
    await run();
    const after = (await app.inject({ method: 'GET', url: '/api/sources' })).json() as { sources: SourceStatus[] };
    expect(after.sources.every((s) => s.ok === true && s.last_run_at !== null)).toBe(true);
  });

  it('los grupos privados quedan pendientes de Telethon', async () => {
    writeFileSync(
      sourcesPath,
      JSON.stringify([{ type: 'telegram_private', url: 'https://t.me/+abcdef', link_regex: 'https?://\\S+' }]),
    );
    const [status] = await run();
    expect(status).toMatchObject({ ok: false, added: 0 });
    expect(status?.error).toMatch(/Telethon/);
  });
});

describe('lista de marcas editable', () => {
  it('editar brand-blocklist.json cambia el riesgo en la siguiente ejecución', async () => {
    await run();
    expect((await byUrl('https://www.hacoo.pl/p/111')).risk_flags).toEqual([]);

    writeFileSync(blocklistPath, JSON.stringify(['Termo']));
    await run();
    expect((await byUrl('https://www.hacoo.pl/p/111')).risk_flags).toEqual(['riesgo_marca']);
    expect((await byUrl('https://www.hacoo.pl/p/222')).risk_flags).toEqual([]);
  });

  it('acepta un array o { brands } y avisa si el archivo está roto', () => {
    writeFileSync(blocklistPath, JSON.stringify({ brands: ['Nike', '', 3, 'Adidas'] }));
    expect(loadBlocklist(blocklistPath)).toEqual(['Nike', 'Adidas']);
    expect(loadBlocklist(join(dir, 'no-existe.json'))).toEqual([]);
    writeFileSync(blocklistPath, '{ roto');
    expect(() => loadBlocklist(blocklistPath)).toThrow(/JSON válido/);
    writeFileSync(blocklistPath, '"Nike"');
    expect(() => loadBlocklist(blocklistPath)).toThrow(/lista de marcas/);
  });
});

describe('sources.json', () => {
  it('valida tipo, URL y link_regex', () => {
    expect(loadSources(sourcesPath).map((s) => s.name)).toEqual(['@canal_prueba', 'Catálogo']);
    expect(loadSources(join(dir, 'no-existe.json'))).toEqual([]);

    const bad = [
      [{ type: 'rss', url: 'https://x.example', link_regex: 'a' }],
      [{ type: 'web', url: 'no-es-url', link_regex: 'a' }],
      [{ type: 'web', url: 'https://x.example', link_regex: '(' }],
      { type: 'web' },
    ];
    for (const content of bad) {
      writeFileSync(sourcesPath, JSON.stringify(content));
      expect(() => loadSources(sourcesPath), JSON.stringify(content)).toThrow(/sources\.json/);
    }
    writeFileSync(sourcesPath, 'roto');
    expect(() => loadSources(sourcesPath)).toThrow(/JSON válido/);
  });

  it('pone nombre por defecto a las fuentes web', () => {
    writeFileSync(sourcesPath, JSON.stringify([{ type: 'web', url: 'https://www.tienda.example/ofertas/', link_regex: 'a' }]));
    expect(loadSources(sourcesPath)[0]?.name).toBe('tienda.example/ofertas');
  });
});

describe('oportunidades: precio estimado, scoring y aviso', () => {
  it('al poner est_price calcula beneficio, ROI y score, y avisa una sola vez', async () => {
    await run();
    const organizer = await byUrl(ORGANIZER);
    expect(sent).toEqual([]);

    const res = await patch(organizer.id, { est_price: 20 });
    expect(res.statusCode).toBe(200);
    // landed 6,90 + 0,30 = 7,20 · beneficio 12,80 · roi 1,7778 · score 100·(0,35·1,7778/3 + 0,25·12,8/30) = 31,4
    expect(res.json()).toMatchObject({
      est_price: 20,
      landed_cost: 7.2,
      est_profit: 12.8,
      roi: 1.7778,
      score: 31.4,
      recommended: true,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Organisateur de câbles');
    expect(sent[0]).toContain('Precio: 6,90 € · Venta estimada: 20,00 €');
    expect(sent[0]).toContain('Beneficio estimado: 12,80 € · ROI 178 % · Score 31,4');
    expect(sent[0]).toContain(ORGANIZER);

    await patch(organizer.id, { est_price: 22 });
    expect(sent).toHaveLength(1);
  });

  it('ordena por score y filtra por estado', async () => {
    await run();
    const organizer = await byUrl(ORGANIZER);
    await patch(organizer.id, { est_price: 20 });
    expect((await deals())[0]?.id).toBe(organizer.id);
    expect(await deals('?status=descartado')).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/deals?status=roto' })).statusCode).toBe(400);
  });

  it('precio manual cuando el parser no lo sacó', async () => {
    await run();
    const termo = await byUrl('https://www.hacoo.pl/p/111');
    const res = await patch(termo.id, { price: 4.5, est_price: 15 });
    // landed 4,80 · beneficio 10,20 · roi 2,125
    expect(res.json()).toMatchObject({ price: 4.5, landed_cost: 4.8, est_profit: 10.2, roi: 2.125, recommended: true });
    expect(sent).toHaveLength(1);
  });

  it('con riesgo de marca: score 0, no se recomienda y no se avisa', async () => {
    await run();
    const bag = await byUrl(BAG);
    const res = await patch(bag.id, { est_price: 120 });
    expect(res.json()).toMatchObject({ est_profit: 74.3, score: 0, recommended: false, risk_flags: ['riesgo_marca'] });
    expect(sent).toEqual([]);
  });

  it('cambiar el título reevalúa la lista de marcas', async () => {
    await run();
    const organizer = await byUrl(ORGANIZER);
    const res = await patch(organizer.id, { title: 'Organizador Nike', est_price: 20 });
    expect(res.json()).toMatchObject({ risk_flags: ['riesgo_marca'], score: 0, recommended: false });
    expect(sent).toEqual([]);
  });

  it('no se recomienda si no llega al beneficio o ROI mínimos', async () => {
    await run();
    const organizer = await byUrl(ORGANIZER);
    // beneficio 4,80 < 5
    expect((await patch(organizer.id, { est_price: 12 })).json()).toMatchObject({ est_profit: 4.8, recommended: false });
    // respeta los ajustes guardados
    db.prepare("UPDATE settings SET value = '2' WHERE key = 'MIN_PROFIT_EUR'").run();
    expect((await patch(organizer.id, { est_price: 12 })).json()).toMatchObject({ recommended: false, roi: 0.6667 });
    db.prepare("UPDATE settings SET value = '50' WHERE key = 'MIN_ROI_PCT'").run();
    expect((await patch(organizer.id, { est_price: 12 })).json()).toMatchObject({ recommended: true });
    expect(sent).toHaveLength(1);
  });

  it('si Telegram falla no rompe la petición y se reintenta en el siguiente cambio', async () => {
    await run();
    const organizer = await byUrl(ORGANIZER);
    notifierOk = false;
    expect((await patch(organizer.id, { est_price: 20 })).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    notifierOk = true;
    await patch(organizer.id, { est_price: 21 });
    expect(sent).toHaveLength(2);
    await patch(organizer.id, { est_price: 22 });
    expect(sent).toHaveLength(2);
  });

  it('valida la entrada', async () => {
    await run();
    const organizer = await byUrl(ORGANIZER);
    for (const payload of [{ price: -1 }, { est_price: 'veinte' }, { status: 'comprado' }, { title: '  ' }]) {
      expect((await patch(organizer.id, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await patch(99999, { est_price: 1 })).statusCode).toBe(404);
  });
});

describe('descartar y comprar', () => {
  it('descartar saca el deal de la lista de nuevos y se puede restaurar', async () => {
    await run();
    const organizer = await byUrl(ORGANIZER);
    await patch(organizer.id, { est_price: 20 });

    const discarded = (await patch(organizer.id, { status: 'descartado' })).json() as DealView;
    expect(discarded).toMatchObject({ status: 'descartado', recommended: false });
    expect((await deals('?status=nuevo')).map((d) => d.id)).not.toContain(organizer.id);
    expect((await deals('?status=descartado')).map((d) => d.id)).toEqual([organizer.id]);

    expect((await patch(organizer.id, { status: 'nuevo' })).json()).toMatchObject({ status: 'nuevo', recommended: true });
  });

  it('"Comprado" crea un item en estado pedido con su coste', async () => {
    await run();
    const organizer = await byUrl(ORGANIZER);
    const res = await app.inject({ method: 'POST', url: `/api/deals/${organizer.id}/buy` });
    expect(res.statusCode).toBe(201);
    const { deal, item } = res.json() as { deal: DealView; item: ItemWithCalc };
    expect(deal).toMatchObject({ id: organizer.id, status: 'comprado', recommended: false });
    expect(item).toMatchObject({
      name: 'Organisateur de câbles',
      source_url: ORGANIZER,
      cost: 6.9,
      shipping_cost: 0,
      extra_costs: 0,
      stock: 'pedido',
      total_cost: 6.9,
    });

    const items = (await app.inject({ method: 'GET', url: '/api/items' })).json() as ItemWithCalc[];
    expect(items.map((i) => i.id)).toEqual([item.id]);

    // No se puede comprar dos veces ni descartar algo ya comprado.
    expect((await app.inject({ method: 'POST', url: `/api/deals/${organizer.id}/buy` })).statusCode).toBe(400);
    expect((await patch(organizer.id, { status: 'descartado' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/items' })).json()).toHaveLength(1);
  });

  it('no deja comprar sin precio', async () => {
    await run();
    const termo = await byUrl('https://www.hacoo.pl/p/111');
    const res = await app.inject({ method: 'POST', url: `/api/deals/${termo.id}/buy` });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { issues: { path: string }[] }).issues[0]?.path).toBe('price');
    expect((await app.inject({ method: 'GET', url: '/api/items' })).json()).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/api/deals/99999/buy' })).statusCode).toBe(404);
  });
});

describe('notificador de Telegram', () => {
  const TOKEN = '123456:TOKEN-DE-PRUEBA';
  type Call = { url: string; body: Record<string, unknown> };

  function fakeTelegram(replies: Record<string, unknown>) {
    const calls: Call[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      const method = url.split('/').pop() ?? '';
      return new Response(JSON.stringify(replies[method] ?? { ok: false, description: 'método no simulado' }));
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('sin token no está configurado y no envía', async () => {
    const telegram = createTelegramNotifier({ token: '', chatId: '', db });
    expect(telegram.configured()).toBe(false);
    expect((await telegram.send('hola')).ok).toBe(false);
  });

  it('envía al chat fijado en .env', async () => {
    const { calls, fetchImpl } = fakeTelegram({ sendMessage: { ok: true, result: {} } });
    const telegram = createTelegramNotifier({ token: TOKEN, chatId: '42', db, fetchImpl });
    expect(await telegram.send('hola')).toEqual({ ok: true });
    expect(calls).toEqual([
      { url: `https://api.telegram.org/bot${TOKEN}/sendMessage`, body: { chat_id: '42', text: 'hola' } },
    ]);
  });

  it('detecta el chat con el primer /start y lo recuerda', async () => {
    const { calls, fetchImpl } = fakeTelegram({
      getUpdates: {
        ok: true,
        result: [
          { update_id: 1, message: { chat: { id: -100, type: 'group' }, text: 'hola' } },
          { update_id: 2, message: { chat: { id: 777, type: 'private' }, text: '/start' } },
        ],
      },
      sendMessage: { ok: true, result: {} },
    });
    const telegram = createTelegramNotifier({ token: TOKEN, chatId: '', db, fetchImpl });
    expect(await telegram.send('uno')).toEqual({ ok: true });
    expect(await telegram.send('dos')).toEqual({ ok: true });
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['getUpdates', 'sendMessage', 'sendMessage']);
    expect(calls[1]?.body.chat_id).toBe('777');
    expect(getRawSetting(db, 'TELEGRAM_CHAT_ID')).toBe('777');
  });

  it('si nadie ha escrito al bot, pide enviar /start', async () => {
    const { fetchImpl } = fakeTelegram({ getUpdates: { ok: true, result: [] } });
    const telegram = createTelegramNotifier({ token: TOKEN, chatId: '', db, fetchImpl });
    const result = await telegram.send('hola');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/\/start/);
  });

  it('los errores nunca incluyen el token', async () => {
    const rejected = fakeTelegram({ sendMessage: { ok: false, description: 'Forbidden: bot was blocked by the user' } });
    const blocked = await createTelegramNotifier({ token: TOKEN, chatId: '42', db, fetchImpl: rejected.fetchImpl }).send('x');
    expect(blocked).toEqual({ ok: false, error: 'Forbidden: bot was blocked by the user' });

    const offline = (async () => {
      throw new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/sendMessage`);
    }) as typeof fetch;
    const failed = await createTelegramNotifier({ token: TOKEN, chatId: '42', db, fetchImpl: offline }).send('x');
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain(TOKEN);
  });

  it('POST /api/telegram/test usa el notificador', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/telegram/test' });
    expect(res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
  });
});
