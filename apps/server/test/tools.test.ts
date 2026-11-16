import type { SyncPayload } from '@resellpilot/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db';
import { applySync, inboxSince } from '../src/vinted/sync';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});
afterEach(() => db.close());

const payload = (status: SyncPayload['listings'][number]['status'], price = 20): SyncPayload => ({
  account: '1234',
  listings: [{ vinted_id: '7001', title: 'Termo acero', price, status, favs: 2, views: 10, listed_at: '2026-10-01T10:00:00.000Z' }],
  listings_complete: true,
  events: [],
  conversation_user_ids: [],
});
const item = () =>
  db.prepare('SELECT stock, sold_price, sold_at FROM items WHERE id = 1').get() as { stock: string; sold_price: number | null; sold_at: string | null };

describe('ventas automáticas en el inventario', () => {
  beforeEach(() => {
    db.prepare("INSERT INTO items (id, name, cost, shipping_cost, extra_costs, stock) VALUES (1, 'Termo', 5, 1, 0.5, 'en_mano')").run();
  });

  it('un anuncio enlazado que se vende marca el item como vendido con el precio del anuncio', () => {
    applySync(db, payload('activo'), new Date('2026-11-15T10:00:00Z'));
    db.prepare("UPDATE listings SET item_id = 1 WHERE vinted_id = '7001'").run();

    const result = applySync(db, payload('vendido', 19), new Date('2026-11-16T10:00:00Z'));
    expect(item()).toEqual({ stock: 'vendido', sold_price: 19, sold_at: '2026-11-16T10:00:00.000Z' });
    expect(result.alerts).toEqual([{ type: 'venta', text: 'Vendido: Termo acero (19,00 €) · inventario actualizado, beneficio +12,50 €' }]);
    expect(db.prepare("SELECT target FROM action_log WHERE action = 'item_vendido_auto'").all()).toEqual([{ target: '1' }]);
  });

  it('no toca items sin enlazar, ya vendidos, ni la primera sync', () => {
    // Primera sync con el anuncio ya vendido: es historial, no una venta nueva.
    db.prepare("INSERT INTO listings (vinted_id, title, price, status, item_id) VALUES ('7001', 'Termo acero', 20, 'vendido', 1)").run();
    applySync(db, payload('vendido'), new Date('2026-11-15T10:00:00Z'));
    expect(item().stock).toBe('en_mano');

    // Sin enlazar.
    db.prepare("UPDATE listings SET item_id = NULL, status = 'activo' WHERE vinted_id = '7001'").run();
    applySync(db, payload('vendido'), new Date('2026-11-16T10:00:00Z'));
    expect(item().stock).toBe('en_mano');

    // Ya vendido a mano: se respeta su precio.
    db.prepare("UPDATE items SET stock = 'vendido', sold_price = 25, sold_at = '2026-11-10T10:00:00.000Z' WHERE id = 1").run();
    db.prepare("UPDATE listings SET item_id = 1, status = 'activo' WHERE vinted_id = '7001'").run();
    applySync(db, payload('vendido'), new Date('2026-11-17T10:00:00Z'));
    expect(item()).toMatchObject({ stock: 'vendido', sold_price: 25 });
  });
});

describe('pedidos vendidos', () => {
  const order = (userStatus: string, price = 18, overrides: Partial<NonNullable<SyncPayload['orders']>[number]> = {}) => ({
    vinted_id: '19000000001',
    conversation_id: '24000000001',
    title: 'Termo acero',
    price,
    status_text: 'Etiqueta de envío enviada al vendedor.',
    user_status: userStatus,
    at: '2026-11-16T07:44:00.000Z',
    photo: 'https://images1.vinted.net/o.jpg',
    ...overrides,
  });
  const withOrders = (status: SyncPayload['listings'][number]['status'], orders: NonNullable<SyncPayload['orders']>): SyncPayload => ({
    ...payload(status),
    orders,
  });
  const notifications = () =>
    db.prepare('SELECT vinted_id, type, text, link FROM notifications ORDER BY id').all() as { vinted_id: string; type: string; text: string; link: string | null }[];

  beforeEach(() => {
    db.prepare("INSERT INTO items (id, name, cost, shipping_cost, extra_costs, stock) VALUES (1, 'Termo', 5, 1, 0.5, 'en_mano')").run();
    applySync(db, payload('activo'), new Date('2026-11-15T10:00:00Z'));
    db.prepare("UPDATE listings SET item_id = 1 WHERE vinted_id = '7001'").run();
  });

  it('venta nueva: inventario al precio REAL del pedido, aviso de venta y de envío pendiente', () => {
    const result = applySync(db, withOrders('vendido', [order('needs_action', 18)]), new Date('2026-11-16T10:00:00Z'));
    // El anuncio estaba a 20 €, pero se vendió por 18 € (oferta): manda el pedido.
    expect(item()).toEqual({ stock: 'vendido', sold_price: 18, sold_at: '2026-11-16T07:44:00.000Z' });
    expect(result.alerts.map((alert) => alert.type)).toEqual(['venta', 'pedido']);
    expect(result.alerts[0]?.text).toBe('Vendido: Termo acero por 18,00 € · beneficio +11,50 €');
    expect(result.alerts[1]?.text).toMatch(/^Tienes que enviar: Termo acero \(18,00 €\)/);
    // Sin duplicar la venta que también se ve en el anuncio.
    expect(notifications().map((row) => row.vinted_id)).toEqual(['o:19000000001:venta', 'o:19000000001:enviar']);
    expect(notifications()[1]?.link).toBe('https://www.vinted.es/inbox/24000000001');
  });

  it('cambios de estado: completado sin aviso; cancelado deshace la venta automática y avisa', () => {
    applySync(db, withOrders('vendido', [order('needs_action')]), new Date('2026-11-16T10:00:00Z'));
    const again = applySync(db, withOrders('vendido', [order('needs_action')]), new Date('2026-11-16T10:15:00Z'));
    expect(again.alerts).toEqual([]);

    const cancelled = applySync(db, withOrders('activo', [order('failed')]), new Date('2026-11-17T10:00:00Z'));
    expect(cancelled.alerts).toEqual([{ type: 'pedido', text: 'Pedido cancelado: Termo acero. Revisa el item en Inventario.' }]);
    expect(item()).toEqual({ stock: 'en_mano', sold_price: null, sold_at: null });
  });

  it('corrige el precio puesto con el anuncio y respeta las ventas hechas a mano', () => {
    // Extensión antigua (sin pedidos): vendido al precio del anuncio.
    applySync(db, payload('vendido', 20), new Date('2026-11-16T10:00:00Z'));
    expect(item().sold_price).toBe(20);
    applySync(db, withOrders('vendido', [order('completed', 17)]), new Date('2026-11-16T11:00:00Z'));
    expect(item().sold_price).toBe(17);

    // Un item vendido a mano no se toca.
    db.prepare("UPDATE items SET stock = 'vendido', sold_price = 30 WHERE id = 1").run();
    db.prepare("DELETE FROM action_log WHERE action = 'item_vendido_auto'").run();
    applySync(db, withOrders('vendido', [order('completed', 17)]), new Date('2026-11-16T12:00:00Z'));
    expect(item().sold_price).toBe(30);
  });

  it('en la primera sync no avisa de ventas antiguas pero sí de lo que falta por enviar', () => {
    const fresh = openDb(':memory:');
    const result = applySync(
      fresh,
      withOrders('vendido', [order('completed', 18, { vinted_id: '1' }), order('needs_action', 42, { vinted_id: '2', title: 'Zapatillas' })]),
      new Date('2026-11-16T10:00:00Z'),
    );
    expect(result.alerts.map((alert) => alert.type)).toEqual(['pedido']);
    // Con la fecha real de cada venta; el historial entra leído y lo pendiente, sin leer.
    expect(fresh.prepare('SELECT vinted_id, read, created_at FROM notifications ORDER BY vinted_id').all()).toEqual([
      { vinted_id: 'o:1:venta', read: 1, created_at: '2026-11-16T07:44:00.000Z' },
      { vinted_id: 'o:2:enviar', read: 0, created_at: '2026-11-16T07:44:00.000Z' },
      { vinted_id: 'o:2:venta', read: 1, created_at: '2026-11-16T07:44:00.000Z' },
    ]);
    fresh.close();
  });

  it('guarda foto, marca, talla y enlace del anuncio', () => {
    const rich = payload('activo');
    rich.listings[0] = { ...rich.listings[0]!, photo: 'https://images1.vinted.net/a.jpg', brand: 'Kivo', size: 'M', condition: 'Muy bueno', url: 'https://www.vinted.es/items/7001' };
    applySync(db, rich, new Date('2026-11-16T10:00:00Z'));
    // Una sync sin esos campos (extensión antigua) no los borra.
    applySync(db, payload('activo'), new Date('2026-11-16T11:00:00Z'));
    expect(db.prepare("SELECT photo, brand, size, condition, url FROM listings WHERE vinted_id = '7001'").get()).toEqual({
      photo: 'https://images1.vinted.net/a.jpg',
      brand: 'Kivo',
      size: 'M',
      condition: 'Muy bueno',
      url: 'https://www.vinted.es/items/7001',
    });
  });
});

describe('sin avalancha de avisos y bandeja incremental', () => {
  const message = (id: string, at: string) => ({
    vinted_id: `m:${id}:${at}`,
    type: 'mensaje' as const,
    text: `ana: hola ${id}`,
    listing_vinted_id: null,
    user_id: '555',
    username: 'ana',
    at,
    read: false,
  });

  it('solo avisa de lo posterior a la última sync; lo antiguo que aparece ahora se guarda sin aviso', () => {
    applySync(db, payload('activo'), new Date('2026-11-16T10:00:00Z'));
    const result = applySync(
      db,
      { ...payload('activo'), events: [message('1', '2026-10-01T10:00:00.000Z'), message('2', '2026-11-16T10:05:00.000Z')] },
      new Date('2026-11-16T10:15:00Z'),
    );
    expect(result.new_events).toBe(2);
    expect(result.alerts).toEqual([{ type: 'mensaje', text: 'ana: hola 2' }]);
  });

  it('la bandeja se lee entera la primera vez y cada 6 h; entre medias, desde la última sync', () => {
    expect(inboxSince(db)).toBeNull();
    applySync(db, { ...payload('activo'), inbox_complete: true }, new Date('2026-11-16T10:00:00Z'));
    expect(inboxSince(db, new Date('2026-11-16T10:15:00Z'))).toBe('2026-11-16T09:00:00.000Z');
    applySync(db, { ...payload('activo'), inbox_complete: false }, new Date('2026-11-16T12:00:00Z'));
    expect(inboxSince(db, new Date('2026-11-16T12:15:00Z'))).toBe('2026-11-16T11:00:00.000Z');
    // 6 horas después de la última lectura completa, otra vez entera.
    expect(inboxSince(db, new Date('2026-11-16T16:00:00Z'))).toBeNull();
  });
});
