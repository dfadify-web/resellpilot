import type { Item, StockState } from '@resellpilot/shared';
import type { Db } from '../db';
import type { ItemData } from './schema';

const COLUMNS =
  'id, name, brand, source_url, cost, shipping_cost, extra_costs, stock, sold_price, sold_at, created_at';

const INSERT = `INSERT INTO items
  (name, brand, source_url, cost, shipping_cost, extra_costs, stock, sold_price, sold_at, created_at)
  VALUES (@name, @brand, @source_url, @cost, @shipping_cost, @extra_costs, @stock, @sold_price, @sold_at, @created_at)`;

export function listItems(db: Db, stock?: StockState): Item[] {
  const order = 'ORDER BY created_at DESC, id DESC';
  if (stock) {
    return db.prepare(`SELECT ${COLUMNS} FROM items WHERE stock = ? ${order}`).all(stock) as Item[];
  }
  return db.prepare(`SELECT ${COLUMNS} FROM items ${order}`).all() as Item[];
}

export function getItem(db: Db, id: number): Item | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM items WHERE id = ?`).get(id) as Item | undefined;
}

export function insertItem(db: Db, data: ItemData): Item {
  const info = db.prepare(INSERT).run(data);
  return getItem(db, Number(info.lastInsertRowid)) as Item;
}

/** Inserta todas las filas o ninguna. Devuelve cuántas. */
export function insertItems(db: Db, rows: readonly ItemData[]): number {
  const statement = db.prepare(INSERT);
  db.transaction(() => {
    for (const row of rows) statement.run(row);
  })();
  return rows.length;
}

export function updateItem(db: Db, id: number, data: ItemData): Item | undefined {
  db.prepare(
    `UPDATE items SET
       name = @name, brand = @brand, source_url = @source_url,
       cost = @cost, shipping_cost = @shipping_cost, extra_costs = @extra_costs,
       stock = @stock, sold_price = @sold_price, sold_at = @sold_at, created_at = @created_at
     WHERE id = @id`,
  ).run({ ...data, id });
  return getItem(db, id);
}

export function deleteItem(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
}
