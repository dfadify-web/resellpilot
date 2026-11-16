/**
 * Precio de mercado de mis anuncios: cada anuncio frente a la media de Vinted para ese artículo
 * (la tendencia medida cuyo texto mejor encaja con el título). Solo informa: no cambia precios.
 */
import { matchTrend, undercutPrice, type TrendStats } from './trends';

/** Por debajo de este número de anuncios en la búsqueda, la media no se considera fiable. */
export const MARKET_MIN_LISTINGS = 5;
/** Diferencia con la media a partir de la cual un anuncio se considera caro o barato. */
export const MARKET_TOLERANCE_PCT = 15;
/** Precio de mercado sugerido: la media menos este porcentaje, para vender un poco antes. */
export const MARKET_UNDERCUT_PCT = 10;

export type MarketVerdict = 'caro' | 'en_precio' | 'barato';

export const MARKET_VERDICT_LABELS: Record<MarketVerdict, string> = {
  caro: 'Caro',
  en_precio: 'En precio',
  barato: 'Barato',
};

export interface ListingMarket {
  /** Búsqueda de Vinted usada como referencia. */
  query: string;
  avg_price: number;
  median_price: number | null;
  listings_count: number;
  computed_at: string;
  /** Diferencia del precio del anuncio con la media (0,2 = 20 % más caro). `null` sin precio. */
  diff: number | null;
  /** `null` si el anuncio no tiene precio o la búsqueda tiene muy pocos anuncios para fiarse. */
  verdict: MarketVerdict | null;
  /** Media − `MARKET_UNDERCUT_PCT` %, redondeado como en la Calculadora. */
  suggested_price: number;
}

type MeasuredTrend = Pick<TrendStats, 'avg_price' | 'median_price' | 'listings_count'> & {
  query: string;
  computed_at: string;
};

/** Veredicto de un precio frente a la media, con `MARKET_TOLERANCE_PCT` de margen a cada lado. */
export function marketVerdict(diff: number): MarketVerdict {
  const tolerance = MARKET_TOLERANCE_PCT / 100;
  if (diff > tolerance) return 'caro';
  if (diff < -tolerance) return 'barato';
  return 'en_precio';
}

/**
 * Referencia de mercado de un anuncio. `null` si ninguna tendencia medida encaja con el título o la que
 * encaja no tiene precio medio.
 */
export function marketFor<T extends MeasuredTrend>(
  listing: { title: string; price: number | null },
  trends: readonly T[],
): ListingMarket | null {
  const trend = matchTrend(
    listing.title,
    trends.filter((candidate) => candidate.avg_price !== null && candidate.avg_price > 0),
  );
  if (!trend || trend.avg_price === null) return null;
  const average = trend.avg_price;
  const diff = listing.price === null || listing.price <= 0 ? null : Math.round(((listing.price - average) / average) * 1000) / 1000;
  return {
    query: trend.query,
    avg_price: average,
    median_price: trend.median_price,
    listings_count: trend.listings_count,
    computed_at: trend.computed_at,
    diff,
    verdict: diff === null || trend.listings_count < MARKET_MIN_LISTINGS ? null : marketVerdict(diff),
    suggested_price: undercutPrice(average, MARKET_UNDERCUT_PCT),
  };
}
