import type { ItemWithCalc, Summary } from '@resellpilot/shared';
import { monthKey, parseCsv, toDateInputValue } from '@resellpilot/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb, type Db } from '../src/db';

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await buildApp({ db, dashboard: 'none' });
});
afterEach(async () => {
  await app.close();
  db.close();
});

const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/items', payload: payload as object });
const patch = (id: number, payload: unknown) =>
  app.inject({ method: 'PATCH', url: `/api/items/${id}`, payload: payload as object });
const list = async () => (await app.inject({ method: 'GET', url: '/api/items' })).json() as ItemWithCalc[];
const summary = async () =>
  (await app.inject({ method: 'GET', url: '/api/summary' })).json() as Summary & {
    recent_sales: ItemWithCalc[];
  };
const importCsv = (csv: string) =>
  app.inject({ method: 'POST', url: '/api/items/import', headers: { 'content-type': 'text/csv' }, payload: csv });

async function create(payload: Record<string, unknown> = {}): Promise<ItemWithCalc> {
  const res = await post({ name: 'Sudadera gris', cost: 10, shipping_cost: 2, extra_costs: 0.5, ...payload });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('CRUD de items', () => {
  it('crea con valores por defecto y campos calculados', async () => {
    const res = await post({ name: '  Camiseta  ' });
    expect(res.statusCode).toBe(201);
    const item = res.json() as ItemWithCalc;
    expect(item).toMatchObject({
      name: 'Camiseta',
      brand: null,
      source_url: null,
      cost: 0,
      shipping_cost: 0,
      extra_costs: 0,
      stock: 'idea',
      sold_price: null,
      sold_at: null,
      total_cost: 0,
      profit: null,
      roi: null,
      rotation_days: null,
    });
    expect(item.id).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(item.created_at))).toBe(false);
  });

  it('lista (más reciente primero), filtra por estado y lee por id', async () => {
    const a = await create({ name: 'A', created_at: '2026-01-01' });
    const b = await create({ name: 'B', created_at: '2026-02-01', stock: 'en_mano' });
    expect((await list()).map((i) => i.name)).toEqual(['B', 'A']);

    const filtered = await app.inject({ method: 'GET', url: '/api/items?stock=en_mano' });
    expect((filtered.json() as ItemWithCalc[]).map((i) => i.id)).toEqual([b.id]);

    const one = await app.inject({ method: 'GET', url: `/api/items/${a.id}` });
    expect(one.json()).toMatchObject({ id: a.id, name: 'A', total_cost: 12.5 });

    expect((await app.inject({ method: 'GET', url: '/api/items?stock=roto' })).statusCode).toBe(400);
  });

  it('edita solo los campos enviados', async () => {
    const item = await create({ brand: 'Genérica', source_url: 'https://example.com/p/1' });
    const res = await patch(item.id, { cost: 20, brand: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'Sudadera gris',
      brand: null,
      source_url: 'https://example.com/p/1',
      cost: 20,
      shipping_cost: 2,
      total_cost: 22.5,
      created_at: item.created_at,
    });
  });

  it('borra y después responde 404', async () => {
    const item = await create();
    expect((await app.inject({ method: 'DELETE', url: `/api/items/${item.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/items/${item.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/items/${item.id}` })).statusCode).toBe(404);
    expect((await patch(item.id, { cost: 1 })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/items/abc' })).statusCode).toBe(404);
    expect(await list()).toEqual([]);
  });

  it('valida la entrada', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{}, 'name'],
      [{ name: '   ' }, 'name'],
      [{ name: 'x', cost: -1 }, 'cost'],
      [{ name: 'x', cost: 'diez' }, 'cost'],
      [{ name: 'x', stock: 'roto' }, 'stock'],
      [{ name: 'x', source_url: 'javascript:alert(1)' }, 'source_url'],
      [{ name: 'x', created_at: '31/02/2026' }, 'created_at'],
      [{ name: 'x', stock: 'vendido' }, 'sold_price'],
    ];
    for (const [payload, path] of cases) {
      const res = await post(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      const body = res.json() as { error: string; issues: { path: string }[] };
      expect(body.error).toBe('validation');
      expect(body.issues.map((i) => i.path)).toContain(path);
    }
    expect(await list()).toEqual([]);
  });

  it('JSON mal formado devuelve 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      headers: { 'content-type': 'application/json' },
      payload: '{ no es json',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('ventas', () => {
  it('compra → vendido → beneficio real en Resumen', async () => {
    const bought = await create({ stock: 'pedido' });
    let s = await summary();
    expect(s).toMatchObject({ month_profit: 0, month_sales: 0, tied_capital: 12.5, total_items: 1 });
    expect(s.by_stock.pedido).toBe(1);

    const res = await patch(bought.id, { stock: 'vendido', sold_price: 25 });
    expect(res.statusCode).toBe(200);
    const sold = res.json() as ItemWithCalc;
    expect(sold).toMatchObject({ stock: 'vendido', sold_price: 25, total_cost: 12.5, profit: 12.5, roi: 1 });
    expect(sold.sold_at).not.toBeNull();

    s = await summary();
    expect(s).toMatchObject({
      month: monthKey(new Date()),
      month_profit: 12.5,
      month_sales: 1,
      total_profit: 12.5,
      tied_capital: 0,
    });
    expect(s.by_stock).toMatchObject({ pedido: 0, vendido: 1 });
    expect(s.recent_sales.map((i) => i.id)).toEqual([bought.id]);
  });

  it('una venta de otro mes no cuenta en el beneficio del mes', async () => {
    await create({ stock: 'vendido', sold_price: 30, sold_at: '2020-03-10', created_at: '2020-03-01' });
    const s = await summary();
    expect(s).toMatchObject({ month_profit: 0, month_sales: 0, total_profit: 17.5, total_sales: 1 });
    expect(s.avg_rotation_days).toBe(9);
  });

  it('marcar vendido exige precio de venta', async () => {
    const item = await create({ stock: 'listado' });
    const res = await patch(item.id, { stock: 'vendido' });
    expect(res.statusCode).toBe(400);
    expect((await list())[0]?.stock).toBe('listado');
  });

  it('respeta la fecha de venta indicada', async () => {
    const item = await create({ stock: 'vendido', sold_price: 20, sold_at: '05/11/2026' });
    expect(toDateInputValue(item.sold_at as string)).toBe('2026-11-05');
  });

  it('al salir de vendido se borran precio y fecha de venta', async () => {
    const item = await create({ stock: 'vendido', sold_price: 25 });
    const res = await patch(item.id, { stock: 'devuelto' });
    expect(res.json()).toMatchObject({ stock: 'devuelto', sold_price: null, sold_at: null, profit: null });
    expect((await summary()).total_profit).toBe(0);
  });

  it('un precio de venta en un item no vendido se descarta', async () => {
    const item = await create({ stock: 'listado', sold_price: 25 });
    expect(item).toMatchObject({ sold_price: null, sold_at: null, profit: null });
  });
});

describe('CSV', () => {
  it('exporta con ; , coma decimal, BOM y columnas calculadas', async () => {
    await create({ name: 'Polo; "azul"', stock: 'vendido', sold_price: 23.2, sold_at: '2026-11-05' });
    const res = await app.inject({ method: 'GET', url: '/api/items/export.csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="resellpilot-items-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.body.startsWith('\uFEFF')).toBe(true);

    const [header, row] = parseCsv(res.body, ';');
    expect(header).toEqual([
      'id', 'name', 'brand', 'source_url', 'cost', 'shipping_cost', 'extra_costs', 'stock',
      'sold_price', 'sold_at', 'created_at', 'total_cost', 'profit', 'roi',
    ]);
    expect(row?.slice(1, 9)).toEqual(['Polo; "azul"', '', '', '10,00', '2,00', '0,50', 'vendido', '23,20']);
    expect(row?.slice(11)).toEqual(['12,50', '10,70', '0,8560']);
  });

  it('lo exportado se puede volver a importar', async () => {
    await create({ name: 'A', brand: 'Marca, S.L.', source_url: 'https://example.com/a', stock: 'en_mano' });
    await create({ name: 'B', stock: 'vendido', sold_price: 25, sold_at: '2026-10-20', created_at: '2026-10-01' });
    const before = await list();
    const exported = (await app.inject({ method: 'GET', url: '/api/items/export.csv' })).body;

    for (const item of before) await app.inject({ method: 'DELETE', url: `/api/items/${item.id}` });
    const res = await importCsv(exported);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 2 });

    const strip = (items: ItemWithCalc[]) => items.map((item) => ({ ...item, id: 0 }));
    expect(strip(await list())).toEqual(strip(before));
  });

  it('importa CSV con comas, valores por defecto y estados con espacios', async () => {
    const res = await importCsv(
      [
        'Name,Cost,Stock,sold_price,sold_at',
        'Gorra,4.5,En mano,,',
        '"Bolso, piel",12,vendido,30,15/10/2026',
        'Solo nombre,,,,',
      ].join('\n'),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 3 });

    const items = await list();
    const byName = (name: string) => items.find((i) => i.name === name);
    expect(byName('Gorra')).toMatchObject({ cost: 4.5, stock: 'en_mano', sold_price: null });
    expect(byName('Bolso, piel')).toMatchObject({ cost: 12, stock: 'vendido', sold_price: 30, profit: 18 });
    expect(toDateInputValue(byName('Bolso, piel')?.sold_at as string)).toBe('2026-10-15');
    expect(byName('Solo nombre')).toMatchObject({ cost: 0, stock: 'idea' });
  });

  it('con errores no importa nada y dice en qué fila', async () => {
    const res = await importCsv(
      ['name;cost;stock;sold_price', 'Bien;10,5;en_mano;', ';3;en_mano;', 'Mal precio;abc;en_mano;', 'Sin precio;5;vendido;'].join('\r\n'),
    );
    expect(res.statusCode).toBe(400);
    const { issues } = res.json() as { issues: { path: string; message: string }[] };
    expect(issues.map((i) => i.path)).toEqual(['fila 3 · name', 'fila 4 · cost', 'fila 5 · sold_price']);
    expect(await list()).toEqual([]);
  });

  it('rechaza archivos vacíos, sin columna name o mal formados', async () => {
    for (const csv of ['', 'cost,stock\n1,idea', 'name\n', 'name\n"sin cerrar']) {
      const res = await importCsv(csv);
      expect(res.statusCode, JSON.stringify(csv)).toBe(400);
      expect((res.json() as { issues: { path: string }[] }).issues[0]?.path).toBe('csv');
    }
    const json = await app.inject({ method: 'POST', url: '/api/items/import', payload: { name: 'x' } });
    expect(json.statusCode).toBe(400);
  });
});

describe('seguridad local', () => {
  it('rechaza peticiones con un Host que no es este equipo', async () => {
    const evil = await app.inject({ method: 'GET', url: '/api/items', headers: { host: 'evil.example:4317' } });
    expect(evil.statusCode).toBe(403);
    for (const host of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317', 'LOCALHOST']) {
      const ok = await app.inject({ method: 'GET', url: '/api/health', headers: { host } });
      expect(ok.statusCode, host).toBe(200);
    }
  });
});
