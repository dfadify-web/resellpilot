import type { Deal, DealStatus } from '@resellpilot/shared';
import type { Db } from '../db';

type DealRow = Omit<Deal, 'risk_flags'> & { risk_flags: string };

const COLUMNS =
  'id, url, source, title, price, image, found_at, est_price, est_profit, roi, demand, competition, score, risk_flags, status';

function toDeal(row: DealRow): Deal {
  let flags: unknown;
  try {
    flags = JSON.parse(row.risk_flags);
  } catch {
    flags = [];
  }
  return {
    ...row,
    risk_flags: Array.isArray(flags) ? flags.filter((f): f is string => typeof f === 'string') : [],
  };
}

/** Orden del PRD: por score. A igualdad, primero las que no tienen riesgo y después lo más reciente. */
export function listDeals(db: Db, status?: DealStatus): Deal[] {
  const order = "ORDER BY score DESC, (risk_flags <> '[]') ASC, found_at DESC, id DESC";
  const rows = status
    ? db.prepare(`SELECT ${COLUMNS} FROM deals WHERE status = ? ${order}`).all(status)
    : db.prepare(`SELECT ${COLUMNS} FROM deals ${order}`).all();
  return (rows as DealRow[]).map(toDeal);
}

export function getDeal(db: Db, id: number): Deal | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM deals WHERE id = ?`).get(id) as DealRow | undefined;
  return row && toDeal(row);
}

export function getDealByUrl(db: Db, url: string): Deal | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM deals WHERE url = ?`).get(url) as DealRow | undefined;
  return row && toDeal(row);
}

export type NewDeal = Pick<Deal, 'url' | 'source' | 'title' | 'price' | 'image' | 'found_at'>;

export function insertDeal(db: Db, deal: NewDeal): Deal {
  const info = db
    .prepare(
      `INSERT INTO deals (url, source, title, price, image, found_at)
       VALUES (@url, @source, @title, @price, @image, @found_at)`,
    )
    .run(deal);
  return getDeal(db, Number(info.lastInsertRowid)) as Deal;
}

export type DealUpdate = Partial<
  Pick<Deal, 'title' | 'price' | 'est_price' | 'est_profit' | 'roi' | 'score' | 'risk_flags' | 'status'>
>;

export function updateDeal(db: Db, id: number, update: DealUpdate): Deal | undefined {
  const entries = Object.entries(update).filter(([, value]) => value !== undefined);
  if (entries.length > 0) {
    const assignments = entries.map(([key]) => `${key} = @${key}`).join(', ');
    const params = Object.fromEntries(
      entries.map(([key, value]) => [key, key === 'risk_flags' ? JSON.stringify(value) : value]),
    );
    db.prepare(`UPDATE deals SET ${assignments} WHERE id = @id`).run({ ...params, id });
  }
  return getDeal(db, id);
}

export function hasSeenLink(db: Db, link: string): boolean {
  return db.prepare('SELECT 1 FROM seen_links WHERE link = ?').get(link) !== undefined;
}

export function markLinkSeen(db: Db, link: string, dealId: number | null): void {
  db.prepare('INSERT OR IGNORE INTO seen_links (link, deal_id) VALUES (?, ?)').run(link, dealId);
}

export function logAction(db: Db, action: string, target: string, result: string): void {
  db.prepare('INSERT INTO action_log (action, target, result) VALUES (?, ?, ?)').run(action, target, result);
}

export function hasAction(db: Db, action: string, target: string): boolean {
  return db.prepare('SELECT 1 FROM action_log WHERE action = ? AND target = ? LIMIT 1').get(action, target) !== undefined;
}
