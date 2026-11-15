/**
 * Sugerencias de bajada de precio (Fase 6): anuncios que llevan demasiado tiempo en venta.
 * Solo sugiere: el precio lo cambia el usuario en Vinted.
 */
import { toCents } from './calc';
import { offerPrice } from './offers';
import { daysListed, isStale } from './vinted';

export type RepricingPct = 5 | 10;

export interface RepricingSuggestion {
  days_listed: number;
  /** Bajada sugerida. */
  pct: RepricingPct;
  /** Precio tras la bajada sugerida. */
  new_price: number;
  price_minus_5: number;
  price_minus_10: number;
  /** Coste total del item enlazado. `null` si el anuncio no está enlazado. */
  total_cost: number | null;
  /** Lo que quedaría de beneficio con el precio sugerido. `null` sin item enlazado. */
  margin: number | null;
  /** El precio sugerido no cubre el coste del item. */
  below_cost: boolean;
}

/**
 * Stale = en venta más de `staleDays` días. Hasta el doble de ese plazo se sugiere −5 %; a partir
 * de ahí, −10 %. Si el −10 % dejaría el precio por debajo del coste y el −5 % no, se queda en −5 %.
 */
export function repricingSuggestion(
  listing: { status: string | null; price: number | null; listed_at: string | null },
  staleDays: number,
  totalCost: number | null,
  now: Date = new Date(),
): RepricingSuggestion | null {
  if (listing.price === null || listing.price <= 0 || !isStale(listing, staleDays, now)) return null;
  const days = daysListed(listing.listed_at, now);
  if (days === null) return null;

  const minus5 = offerPrice(listing.price, 5);
  const minus10 = offerPrice(listing.price, 10);
  let pct: RepricingPct = days > staleDays * 2 ? 10 : 5;
  if (pct === 10 && totalCost !== null && minus10 < totalCost && minus5 >= totalCost) pct = 5;

  const newPrice = pct === 10 ? minus10 : minus5;
  return {
    days_listed: days,
    pct,
    new_price: newPrice,
    price_minus_5: minus5,
    price_minus_10: minus10,
    total_cost: totalCost,
    margin: totalCost === null ? null : (toCents(newPrice) - toCents(totalCost)) / 100,
    below_cost: totalCost !== null && newPrice < totalCost,
  };
}

/** Fila de `GET /api/repricing`. */
export interface RepricingRow extends RepricingSuggestion {
  listing_id: number;
  vinted_id: string;
  title: string;
  price: number;
  favs: number;
  views: number;
  item_name: string | null;
}
