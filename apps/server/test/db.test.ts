import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMAND_STATUSES, DEAL_STATUSES, DEFAULT_SETTINGS, STOCK_STATES } from '@resellpilot/shared';
import { migrate, openDb, type Db } from '../src/db';

const TABLES = [
  'items',
  'listings',
  'notifications',
  'favoriters',
  'deals',
  'trends',
  'commands',
  'action_log',
  'settings',
];

let db: Db | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

const columns = (d: Db, table: string) =>
  (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('db', () => {
  it('crea todas las tablas del PRD', () => {
    db = openDb(':memory:');
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const table of TABLES) expect(names).toContain(table);
  });

  it('las columnas coinciden con el modelo de datos', () => {
    db = openDb(':memory:');
    expect(columns(db, 'items')).toEqual([
      'id', 'name', 'brand', 'source_url', 'cost', 'shipping_cost', 'extra_costs', 'stock',
      'sold_price', 'sold_at', 'created_at',
    ]);
    expect(columns(db, 'listings')).toEqual([
      'id', 'vinted_id', 'title', 'price', 'status', 'favs', 'views', 'listed_at', 'last_seen_at',
      'item_id',
    ]);
    expect(columns(db, 'notifications')).toEqual([
      'id', 'vinted_id', 'type', 'text', 'listing_id', 'read', 'created_at',
    ]);
    expect(columns(db, 'favoriters')).toEqual([
      'id', 'listing_id', 'vinted_user_id', 'username', 'seen_at', 'offered_at', 'has_conversation',
    ]);
    expect(columns(db, 'deals')).toEqual([
      'id', 'url', 'source', 'title', 'price', 'image', 'found_at', 'est_price', 'est_profit', 'roi',
      'demand', 'competition', 'score', 'risk_flags', 'status', 'est_manual',
    ]);
    expect(columns(db, 'trends')).toEqual([
      'id', 'query', 'median_price', 'p25_price', 'listings_count', 'avg_favs', 'favs_per_day',
      'computed_at', 'avg_price',
    ]);
    expect(columns(db, 'commands')).toEqual([
      'id', 'type', 'payload', 'status', 'progress', 'error', 'created_at',
    ]);
    expect(columns(db, 'action_log')).toEqual(['id', 'ts', 'action', 'target', 'result']);
    expect(columns(db, 'settings')).toEqual(['key', 'value']);
  });

  it('migrar dos veces no hace nada la segunda', () => {
    db = openDb(':memory:');
    expect(migrate(db)).toEqual([]);
  });

  it('persiste en disco y reabre sin perder datos ni pisar ajustes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resellpilot-test-'));
    const file = join(dir, 'nested', 'test.db');
    try {
      const first = openDb(file);
      first.prepare("UPDATE settings SET value = 'false' WHERE key = 'DRY_RUN'").run();
      first.prepare("INSERT INTO items (name, cost) VALUES ('Sudadera', 12.5)").run();
      first.close();

      db = openDb(file);
      const dry = db.prepare("SELECT value FROM settings WHERE key = 'DRY_RUN'").get() as { value: string };
      expect(dry.value).toBe('false');
      const item = db.prepare('SELECT name, cost, stock FROM items').get();
      expect(item).toEqual({ name: 'Sudadera', cost: 12.5, stock: 'idea' });
      db.close();
      db = undefined;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('siembra los ajustes por defecto', () => {
    db = openDb(':memory:');
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(Object.keys(map).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(map.DRY_RUN).toBe('true');
    expect(map.OFFER_DISCOUNT_PCT).toBe('10');
    expect(Number(map.PACKAGING_EUR)).toBe(0.3);
  });

  it('acepta todos los estados compartidos y rechaza los inválidos', () => {
    db = openDb(':memory:');
    const d = db;
    for (const stock of STOCK_STATES) {
      d.prepare('INSERT INTO items (name, stock) VALUES (?, ?)').run('x', stock);
    }
    for (const [i, status] of DEAL_STATUSES.entries()) {
      d.prepare('INSERT INTO deals (url, status) VALUES (?, ?)').run(`https://e.x/${i}`, status);
    }
    for (const status of COMMAND_STATUSES) {
      d.prepare('INSERT INTO commands (type, status) VALUES (?, ?)').run('send_offers', status);
    }
    expect(() => d.prepare("INSERT INTO items (name, stock) VALUES ('x', 'roto')").run()).toThrow();
    expect(() => d.prepare("INSERT INTO deals (url, status) VALUES ('https://e.x/z', 'otro')").run()).toThrow();
    expect(() => d.prepare("INSERT INTO commands (type, status) VALUES ('t', 'otro')").run()).toThrow();
  });

  it('impone unicidad y claves foráneas', () => {
    db = openDb(':memory:');
    const d = db;
    d.prepare("INSERT INTO deals (url) VALUES ('https://e.x/a')").run();
    expect(() => d.prepare("INSERT INTO deals (url) VALUES ('https://e.x/a')").run()).toThrow();

    const listing = d.prepare("INSERT INTO listings (vinted_id, title) VALUES ('1', 'Camiseta')").run();
    const id = listing.lastInsertRowid;
    d.prepare("INSERT INTO favoriters (listing_id, vinted_user_id) VALUES (?, 'u1')").run(id);
    expect(() =>
      d.prepare("INSERT INTO favoriters (listing_id, vinted_user_id) VALUES (?, 'u1')").run(id),
    ).toThrow();
    expect(() =>
      d.prepare("INSERT INTO favoriters (listing_id, vinted_user_id) VALUES (9999, 'u2')").run(),
    ).toThrow();

    d.prepare('DELETE FROM listings WHERE id = ?').run(id);
    expect(d.prepare('SELECT COUNT(*) AS n FROM favoriters').get()).toEqual({ n: 0 });
  });
});
