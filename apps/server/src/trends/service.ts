import {
  computeTrendStats,
  deriveQuery,
  estPriceFromTrend,
  idsPerDayFrom,
  queryKey,
  relativeChange,
  type IdAnchor,
  type IdClock,
  type RawSearchResult,
  type TrendOrigin,
  type TrendStats,
  type TrendView,
} from '@resellpilot/shared';
import type { Db } from '../db';
import { getRawSetting, getSettings, setRawSetting } from '../settings';

const KEY_SEEDS = 'TREND_SEEDS';
const KEY_ANCHORS = 'VINTED_ID_ANCHORS';
/** Momentos de las peticiones de calibración (`/catalog?order=newest_first`), para el límite por hora. */
const KEY_CALIBRATIONS = 'TRENDS_CALIBRATIONS';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Búsquedas por sync como máximo: mantiene cada sync corta aunque haya muchas pendientes. */
export const MAX_QUERIES_PER_SYNC = 8;
const MAX_DEAL_QUERIES = 40;
const MAX_ANCHORS = 60;
const HISTORY_DAYS = 90;

export interface TrendRow extends TrendStats {
  query: string;
  computed_at: string;
}

function readJson<T>(db: Db, key: string, fallback: T): T {
  const raw = getRawSetting(db, key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ───────────────────────── consultas ─────────────────────────

/** Queries semilla, editables en Ajustes. */
export function getSeeds(db: Db): string[] {
  const seeds = readJson<unknown>(db, KEY_SEEDS, []);
  return Array.isArray(seeds) ? seeds.filter((seed): seed is string => typeof seed === 'string') : [];
}

export function setSeeds(db: Db, seeds: readonly string[]): string[] {
  const clean = [...new Map(seeds.map((seed) => [queryKey(seed), seed.trim().replace(/\s+/g, ' ')])).entries()]
    .filter(([key]) => key !== '')
    .map(([, seed]) => seed);
  setRawSetting(db, KEY_SEEDS, JSON.stringify(clean));
  return clean;
}

/**
 * Consultas a medir: las semilla, más las derivadas de mis items sin vender y de los deals
 * pendientes sin riesgo de marca. La clave es la forma canónica de la consulta.
 */
export function collectQueries(db: Db): Map<string, Set<TrendOrigin>> {
  const queries = new Map<string, Set<TrendOrigin>>();
  const add = (query: string | null, origin: TrendOrigin) => {
    const key = query === null ? '' : queryKey(query);
    if (key === '') return;
    const origins = queries.get(key) ?? new Set<TrendOrigin>();
    origins.add(origin);
    queries.set(key, origins);
  };

  for (const seed of getSeeds(db)) add(seed, 'semilla');

  const items = db
    .prepare("SELECT name FROM items WHERE stock NOT IN ('vendido', 'devuelto') ORDER BY created_at DESC")
    .all() as { name: string }[];
  for (const item of items) add(deriveQuery(item.name), 'item');

  const deals = db
    .prepare(
      `SELECT title FROM deals WHERE status = 'nuevo' AND risk_flags = '[]' AND title IS NOT NULL
       ORDER BY found_at DESC LIMIT ?`,
    )
    .all(MAX_DEAL_QUERIES) as { title: string }[];
  for (const deal of deals) add(deriveQuery(deal.title), 'deal');

  return queries;
}

/** Última medición de cada consulta. */
export function latestTrends(db: Db): TrendRow[] {
  return db
    .prepare(
      `SELECT t.query, t.median_price, t.p25_price, t.listings_count, t.avg_favs, t.favs_per_day, t.computed_at
       FROM trends t
       JOIN (SELECT query, MAX(computed_at) AS latest FROM trends GROUP BY query) m
         ON m.query = t.query AND m.latest = t.computed_at
       GROUP BY t.query`,
    )
    .all() as TrendRow[];
}

function calibrations(db: Db): string[] {
  const list = readJson<unknown>(db, KEY_CALIBRATIONS, []);
  return Array.isArray(list) ? list.filter((at): at is string => typeof at === 'string') : [];
}

/** Apunta una petición de calibración. Solo se guardan las de las últimas 2 h. */
function recordCalibration(db: Db, now: Date): void {
  const since = new Date(now.getTime() - 2 * HOUR_MS).toISOString();
  setRawSetting(db, KEY_CALIBRATIONS, JSON.stringify([...calibrations(db).filter((at) => at > since), now.toISOString()]));
}

/** Peticiones a Vinted desde `sinceIso`: una por búsqueda medida más las de calibración. */
const requestsSince = (db: Db, sinceIso: string): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM trends WHERE computed_at > ?').get(sinceIso) as { n: number }).n +
  calibrations(db).filter((at) => at > sinceIso).length;

/**
 * Consultas que toca medir ahora: sin medición dentro de `TRENDS_CACHE_H`, respetando
 * `TRENDS_MAX_REQ_PER_HOUR` (se reserva una petición para la calibración) y el tope por sync.
 */
export function dueQueries(db: Db, now: Date = new Date()): string[] {
  const settings = getSettings(db);
  const fresh = new Date(now.getTime() - settings.TRENDS_CACHE_H * HOUR_MS).toISOString();
  const measured = new Map(latestTrends(db).map((trend) => [trend.query, trend.computed_at]));

  const usedLastHour = requestsSince(db, new Date(now.getTime() - HOUR_MS).toISOString());
  const budget = Math.min(MAX_QUERIES_PER_SYNC, settings.TRENDS_MAX_REQ_PER_HOUR - usedLastHour - 1);
  if (budget <= 0) return [];

  const rank: Record<TrendOrigin, number> = { semilla: 0, item: 1, deal: 2 };
  return [...collectQueries(db).entries()]
    .filter(([query]) => (measured.get(query) ?? '') <= fresh)
    .sort(([queryA, a], [queryB, b]) => {
      const best = (origins: Set<TrendOrigin>) => Math.min(...[...origins].map((origin) => rank[origin]));
      // Primero las nunca medidas; después por origen; a igualdad, la medición más antigua.
      return (
        Number(measured.has(queryA)) - Number(measured.has(queryB)) ||
        best(a) - best(b) ||
        (measured.get(queryA) ?? '').localeCompare(measured.get(queryB) ?? '')
      );
    })
    .slice(0, budget)
    .map(([query]) => query);
}

// ───────────────────────── calibración de ids ─────────────────────────

function getAnchors(db: Db): IdAnchor[] {
  const anchors = readJson<unknown>(db, KEY_ANCHORS, []);
  if (!Array.isArray(anchors)) return [];
  return anchors.filter(
    (anchor): anchor is IdAnchor =>
      typeof anchor === 'object' &&
      anchor !== null &&
      Number.isFinite((anchor as IdAnchor).id) &&
      Number.isFinite((anchor as IdAnchor).atMs),
  );
}

/** Guarda "el id más nuevo ahora es este" (un punto por día) y devuelve el reloj resultante. */
export function recordAnchor(db: Db, maxId: number, now: Date): IdClock {
  const day = (ms: number) => Math.floor(ms / DAY_MS);
  const anchors = getAnchors(db)
    // Un id no puede retroceder: si lo hace, la calibración anterior no sirve.
    .filter((anchor) => day(anchor.atMs) !== day(now.getTime()) && anchor.id < maxId)
    .slice(-(MAX_ANCHORS - 1));
  anchors.push({ id: maxId, atMs: now.getTime() });
  setRawSetting(db, KEY_ANCHORS, JSON.stringify(anchors));
  return { maxId, atMs: now.getTime(), idsPerDay: idsPerDayFrom(anchors) };
}

export function getIdClock(db: Db): IdClock | null {
  const anchors = getAnchors(db);
  const last = anchors.at(-1);
  return last ? { maxId: last.id, atMs: last.atMs, idsPerDay: idsPerDayFrom(anchors) } : null;
}

// ───────────────────────── resultados ─────────────────────────

export interface TrendsPayload {
  /** Id más reciente del catálogo en este momento, para calibrar. `null` si no se midió. */
  max_id_now: number | null;
  results: RawSearchResult[];
}

/** Guarda las mediciones de las consultas vigentes. Devuelve cuántas se guardaron. */
export function recordTrends(db: Db, payload: TrendsPayload, now: Date = new Date()): number {
  const wanted = collectQueries(db);
  const at = now.toISOString();
  let saved = 0;

  db.transaction(() => {
    // Una búsqueda puede traer un anuncio aún más nuevo que la página de calibración: manda el mayor.
    let maxId = payload.max_id_now;
    if (maxId !== null) {
      for (const result of payload.results) {
        for (const card of result.cards) {
          const id = Number(card.id);
          if (Number.isSafeInteger(id) && id > maxId) maxId = id;
        }
      }
    }
    if (payload.max_id_now !== null) recordCalibration(db, now);
    const clock = maxId !== null ? recordAnchor(db, maxId, now) : getIdClock(db);
    const insert = db.prepare(
      `INSERT INTO trends (query, median_price, p25_price, listings_count, avg_favs, favs_per_day, computed_at)
       VALUES (@query, @median_price, @p25_price, @listings_count, @avg_favs, @favs_per_day, @computed_at)`,
    );
    const done = new Set<string>();
    for (const result of payload.results) {
      const query = queryKey(result.query);
      if (!wanted.has(query) || done.has(query)) continue;
      done.add(query);
      insert.run({ query, ...computeTrendStats(result, clock, now.getTime()), computed_at: at });
      saved += 1;
    }
    db.prepare('DELETE FROM trends WHERE computed_at < ?').run(new Date(now.getTime() - HISTORY_DAYS * DAY_MS).toISOString());
  })();
  return saved;
}

/** Tendencias de las consultas vigentes, ordenadas por demanda (favs/día). Las pendientes, al final. */
export function listTrends(db: Db, now: Date = new Date()): TrendView[] {
  const fresh = new Date(now.getTime() - getSettings(db).TRENDS_CACHE_H * HOUR_MS).toISOString();
  const latest = new Map(latestTrends(db).map((trend) => [trend.query, trend]));
  const previous = db.prepare(
    `SELECT favs_per_day FROM trends WHERE query = ? AND computed_at <= ? AND computed_at >= ?
     ORDER BY computed_at DESC LIMIT 1`,
  );

  const views = [...collectQueries(db).entries()].map(([query, origins]): TrendView => {
    const trend = latest.get(query);
    if (!trend) {
      return {
        query,
        origins: [...origins],
        median_price: null,
        p25_price: null,
        listings_count: 0,
        avg_favs: null,
        favs_per_day: null,
        est_price: null,
        computed_at: null,
        week_change: null,
        pending: true,
      };
    }
    // "Semana anterior": la medición más cercana de entre 6 y 14 días antes de la última.
    const at = Date.parse(trend.computed_at);
    const before = previous.get(
      query,
      new Date(at - 6 * DAY_MS).toISOString(),
      new Date(at - 14 * DAY_MS).toISOString(),
    ) as { favs_per_day: number | null } | undefined;
    return {
      query,
      origins: [...origins],
      median_price: trend.median_price,
      p25_price: trend.p25_price,
      listings_count: trend.listings_count,
      avg_favs: trend.avg_favs,
      favs_per_day: trend.favs_per_day,
      est_price: estPriceFromTrend(trend),
      computed_at: trend.computed_at,
      week_change: relativeChange(trend.favs_per_day, before?.favs_per_day ?? null),
      pending: trend.computed_at <= fresh,
    };
  });

  return views.sort(
    (a, b) =>
      Number(a.computed_at === null) - Number(b.computed_at === null) ||
      (b.favs_per_day ?? -1) - (a.favs_per_day ?? -1) ||
      a.query.localeCompare(b.query),
  );
}
