import type { SyncPayload } from '@resellpilot/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db';
import { applySync } from '../src/vinted/sync';

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
