/**
 * Tendencias (Fase 4): estadísticas de las búsquedas públicas de vinted.es y su cruce con los deals.
 * Todo son funciones puras; la extensión solo extrae las tarjetas y el server guarda los resultados.
 */
import { normalizeForMatch } from './brands';
import { parseDecimal } from './csv';

// ───────────────────────── tipos ─────────────────────────

/** Tarjeta de resultado tal como la extrae la extensión del HTML de la búsqueda. */
export interface RawSearchCard {
  /** Id del artículo (de `data-testid="product-item-id-{id}"`). */
  id: string;
  /** Texto del precio: "13,00 €". */
  price_text: string;
  /** Texto del contador de favoritos: "12". Vacío si no hay ninguno. */
  favs_text: string;
}

export interface RawSearchResult {
  query: string;
  cards: RawSearchCard[];
  /** Texto del total: "500+ resultados". Vacío si no aparece. */
  total_text: string;
}

export interface SearchCard {
  id: number;
  price: number;
  favs: number;
}

export interface TrendStats {
  /** Precio medio de los anuncios, sin el 10 % más barato ni el 10 % más caro (si hay 10 o más). */
  avg_price: number | null;
  median_price: number | null;
  p25_price: number | null;
  /** Total de anuncios de la búsqueda (500 si Vinted dice "500+"). */
  listings_count: number;
  avg_favs: number | null;
  /** Favoritos totales / días totales de antigüedad estimada. `null` si no se puede estimar. */
  favs_per_day: number | null;
}

/** Relación entre ids de Vinted y tiempo, para estimar la antigüedad de un artículo. */
export interface IdClock {
  /** Id más reciente visto en el catálogo. */
  maxId: number;
  /** Momento (ms) en que se vio `maxId`. */
  atMs: number;
  /** Ids nuevos que crea Vinted al día. */
  idsPerDay: number;
}

/** Punto de calibración: "en este momento el id más nuevo era este". */
export interface IdAnchor {
  id: number;
  atMs: number;
}

export type TrendOrigin = 'semilla' | 'item' | 'deal' | 'busqueda';

export interface TrendView extends TrendStats {
  query: string;
  origins: TrendOrigin[];
  /** (p25 + mediana) / 2: el precio de venta estimado que se aplica a los deals. */
  est_price: number | null;
  computed_at: string | null;
  /** Variación de favs_per_day frente a la medición de hace ~7 días (ratio). `null` si no hay. */
  week_change: number | null;
  /** `true` si aún no se ha medido o la medición ha caducado. */
  pending: boolean;
}

// ───────────────────────── tarjetas ─────────────────────────

/** Medido el 2026-11-10 con anuncios propios: ~13,3 millones de ids nuevos al día. */
export const DEFAULT_IDS_PER_DAY = 13_300_000;
const DAY_MS = 86_400_000;
/** Antigüedad mínima para no disparar favs/día en artículos recién subidos. */
const MIN_AGE_DAYS = 1;

/** Convierte las tarjetas crudas; descarta las que no tienen id o precio válidos y las repetidas. */
export function normalizeSearchCards(raw: readonly RawSearchCard[]): SearchCard[] {
  const cards = new Map<number, SearchCard>();
  for (const card of raw) {
    const id = /^\d{1,15}$/.test(card.id) ? Number(card.id) : NaN;
    const price = parseDecimal(card.price_text.replace(/[^\d.,-]/g, ''));
    if (!Number.isSafeInteger(id) || id <= 0 || price === null || price <= 0) continue;
    const favs = /^\d{1,7}$/.test(card.favs_text.trim()) ? Number(card.favs_text.trim()) : 0;
    if (!cards.has(id)) cards.set(id, { id, price, favs });
  }
  return [...cards.values()];
}

/** "500+ resultados" → 500 · "1.234 resultados" → 1234 · sin texto → `fallback`. */
export function parseTotalResults(text: string, fallback: number): number {
  const match = /(\d[\d.\s]*)\+?\s*resultado/i.exec(text);
  const total = match ? Number((match[1] ?? '').replace(/[.\s]/g, '')) : NaN;
  return Number.isFinite(total) && total >= fallback ? total : fallback;
}

/** Percentil con interpolación lineal (0 ≤ p ≤ 1). `null` si no hay valores. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const lowValue = sorted[low] as number;
  const highValue = sorted[high] as number;
  return lowValue + (highValue - lowValue) * (position - low);
}

/**
 * Media recortada: sin el 10 % más barato ni el 10 % más caro cuando hay 10 precios o más, para que un
 * anuncio a 1 € o a 500 € no mueva la media. Con menos, la media normal. `null` si no hay precios.
 */
export function trimmedMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const cut = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0;
  const kept = sorted.slice(cut, sorted.length - cut);
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}

/**
 * Precio para vender un poco más barato que la media: media − `undercutPct` %. Por encima de 5 € se
 * redondea hacia abajo al medio euro (14,76 → 14,50), que queda mejor en un anuncio.
 */
export function undercutPrice(average: number, undercutPct: number): number {
  const pct = Math.min(Math.max(undercutPct, 0), 90);
  const raw = (average * (100 - pct)) / 100;
  // El 1e-6 evita que 1,9999999 (coma flotante) se quede en 1,99.
  return raw >= 5 ? Math.floor(raw * 2 + 1e-6) / 2 : Math.floor(raw * 100 + 1e-6) / 100;
}

/** Antigüedad estimada de un artículo por su id (mínimo 1 día). */
export function estimateAgeDays(id: number, clock: IdClock, nowMs: number = clock.atMs): number {
  const sinceMax = (clock.maxId - id) / clock.idsPerDay;
  return Math.max(MIN_AGE_DAYS, sinceMax + (nowMs - clock.atMs) / DAY_MS);
}

/**
 * Ritmo de creación de ids a partir de los puntos de calibración guardados.
 * Hace falta al menos un día entre el más antiguo y el más nuevo; si no, se usa el valor por defecto.
 */
export function idsPerDayFrom(anchors: readonly IdAnchor[]): number {
  if (anchors.length < 2) return DEFAULT_IDS_PER_DAY;
  const sorted = [...anchors].sort((a, b) => a.atMs - b.atMs);
  const first = sorted[0] as IdAnchor;
  const last = sorted[sorted.length - 1] as IdAnchor;
  const days = (last.atMs - first.atMs) / DAY_MS;
  if (days < 1) return DEFAULT_IDS_PER_DAY;
  const rate = (last.id - first.id) / days;
  // Fuera de un rango razonable (la mitad o el triple de lo medido) se desconfía de la calibración.
  return rate > DEFAULT_IDS_PER_DAY / 2 && rate < DEFAULT_IDS_PER_DAY * 3 ? rate : DEFAULT_IDS_PER_DAY;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Estadísticas de una búsqueda (PRD F4.3). */
export function computeTrendStats(result: RawSearchResult, clock: IdClock | null, nowMs?: number): TrendStats {
  const cards = normalizeSearchCards(result.cards);
  const prices = cards.map((card) => card.price);
  const median = percentile(prices, 0.5);
  const p25 = percentile(prices, 0.25);

  // Tasa conjunta: favoritos totales entre días totales de exposición. Es más estable que la media
  // de tasas, que se dispara con un solo anuncio recién subido y con muchos favoritos.
  const exposureDays = clock === null ? 0 : cards.reduce((sum, card) => sum + estimateAgeDays(card.id, clock, nowMs), 0);
  const favsPerDay = exposureDays > 0 ? cards.reduce((sum, card) => sum + card.favs, 0) / exposureDays : null;

  const average = trimmedMean(prices);
  return {
    avg_price: average === null ? null : round2(average),
    median_price: median === null ? null : round2(median),
    p25_price: p25 === null ? null : round2(p25),
    listings_count: parseTotalResults(result.total_text, cards.length),
    avg_favs: cards.length === 0 ? null : round2(cards.reduce((sum, card) => sum + card.favs, 0) / cards.length),
    favs_per_day: favsPerDay === null ? null : Math.round(favsPerDay * 1000) / 1000,
  };
}

/** Precio de venta estimado del PRD: (p25 + mediana) / 2. */
export function estPriceFromTrend(trend: Pick<TrendStats, 'median_price' | 'p25_price'>): number | null {
  if (trend.median_price === null || trend.p25_price === null) return null;
  return round2((trend.p25_price + trend.median_price) / 2);
}

/** Variación relativa (0,25 = +25 %). `null` si no hay base con la que comparar. */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 1000;
}

// ───────────────────────── consultas y cruce con deals ─────────────────────────

/** Palabras que no describen el producto (español, francés e inglés: las fuentes mezclan idiomas). */
const STOPWORDS = new Set(
  (
    'a al con de del el en la las lo los para por sin su un una unas unos y o e ' +
    'au aux avec dans des du en et la le les pour sans sur un une ' +
    'and for of the with ' +
    'nuevo nueva nuevos nuevas new neuf neuve original pack lote lot set talla taille size ' +
    'hombre mujer homme femme men women unisex nino nina ninos enfant kids ' +
    'color colores colori couleur couleurs coloris'
  ).split(' '),
);

/** Palabras clave de un título: sin acentos, sin palabras vacías, sin números sueltos ni tallas. */
export function keywordsOf(title: string): string[] {
  const words = normalizeForMatch(title)
    .split(' ')
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
  return [...new Set(words)];
}

const MAX_QUERY_WORDS = 3;

/**
 * Consulta de búsqueda derivada de un título (primeras 3 palabras clave).
 * `null` si quedan menos de 2: una sola palabra ("bolso") es demasiado genérica para estimar precios.
 */
export function deriveQuery(title: string | null | undefined): string | null {
  if (!title) return null;
  const words = keywordsOf(title).slice(0, MAX_QUERY_WORDS);
  return words.length < 2 ? null : words.join(' ');
}

/** Forma canónica de una consulta, para no medir dos veces la misma. */
export const queryKey = (query: string): string => keywordsOfQuery(query).join(' ');

function keywordsOfQuery(query: string): string[] {
  return [...new Set(normalizeForMatch(query).split(' ').filter((word) => word !== ''))];
}

/**
 * Tendencia que mejor describe un título: todas las palabras de la consulta deben estar en el
 * título. Entre varias, gana la más específica (más palabras); a igualdad, la de más anuncios.
 */
export function matchTrend<T extends { query: string; listings_count: number | null }>(
  title: string | null | undefined,
  trends: readonly T[],
): T | null {
  if (!title) return null;
  const words = new Set(normalizeForMatch(title).split(' '));
  let best: T | null = null;
  let bestSize = 0;
  for (const trend of trends) {
    const query = keywordsOfQuery(trend.query);
    if (query.length === 0 || !query.every((word) => words.has(word))) continue;
    const better =
      query.length > bestSize ||
      (query.length === bestSize && (trend.listings_count ?? 0) > (best?.listings_count ?? 0));
    if (better) {
      best = trend;
      bestSize = query.length;
    }
  }
  return best;
}
