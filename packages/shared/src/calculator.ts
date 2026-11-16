/**
 * Calculadora «¿Me compensa?»: con lo que cuesta un producto y a cuánto se vende, si merece la pena,
 * a cuánto anunciarlo y qué oferta mínima aceptar. En Vinted (España) el vendedor no paga comisión:
 * la protección al comprador y el envío los paga el comprador, así que el precio de venta es lo que cobras.
 */
import { toCents } from './calc';

export interface CalculatorInput {
  /** Precio de compra. */
  buy: number;
  /** Envío de la compra. */
  buyShipping: number;
  /** Otros costes (aduanas, comisión de la tienda…). */
  extra: number;
  /** Embalaje por envío. */
  packaging: number;
  /** Precio al que crees que se venderá. */
  sell: number;
  /** Descuento habitual de las ofertas (%). */
  offerPct: number;
  /** Beneficio mínimo que quieres ganar (€). */
  minProfit: number;
  /** ROI mínimo que quieres (%). */
  minRoiPct: number;
}

export type Verdict = 'compensa' | 'justo' | 'no_compensa';

export interface Scenario {
  label: string;
  price: number;
  profit: number;
  roi: number | null;
}

export interface CalculatorResult {
  /** Coste total: compra + envío + otros + embalaje. */
  cost: number;
  profit: number;
  /** Ratio (0,8 = 80 %). `null` si el coste es 0. */
  roi: number | null;
  verdict: Verdict;
  /** Precio por debajo del cual pierdes dinero. */
  breakEven: number;
  /** Precio mínimo para ganar `minProfit` y llegar a `minRoiPct`. */
  minPrice: number;
  /** Precio de anuncio que, tras una oferta de `offerPct`, sigue en `minPrice`. Redondeado al euro hacia arriba. */
  listPrice: number;
  /** La oferta más baja que puedes aceptar sin bajar de tus mínimos. */
  minOffer: number;
  /** Lo que ganarías si vendes con la oferta habitual. */
  afterOffer: Scenario;
  scenarios: Scenario[];
}

const cents = (eur: number): number => toCents(Math.max(0, Number.isFinite(eur) ? eur : 0));
const eur = (value: number): number => Math.round(value) / 100;

function ratio(profitCents: number, costCents: number): number | null {
  return costCents <= 0 ? null : Math.round((profitCents / costCents) * 10_000) / 10_000;
}

function scenario(label: string, priceCents: number, costCents: number): Scenario {
  return { label, price: eur(priceCents), profit: eur(priceCents - costCents), roi: ratio(priceCents - costCents, costCents) };
}

export function calculate(input: CalculatorInput): CalculatorResult {
  const costCents = cents(input.buy) + cents(input.buyShipping) + cents(input.extra) + cents(input.packaging);
  const sellCents = cents(input.sell);
  const offer = Math.min(Math.max(input.offerPct, 0), 90) / 100;
  const minProfitCents = cents(input.minProfit);
  const minRoi = Math.max(0, input.minRoiPct) / 100;

  const profitCents = sellCents - costCents;
  const roi = ratio(profitCents, costCents);
  const meetsMinimums = profitCents >= minProfitCents && (roi === null || roi >= minRoi);
  const verdict: Verdict = sellCents > 0 && meetsMinimums ? 'compensa' : profitCents > 0 ? 'justo' : 'no_compensa';

  const minPriceCents = Math.max(costCents + minProfitCents, Math.ceil(costCents * (1 + minRoi)));
  const listPriceCents = Math.ceil(minPriceCents / (1 - offer) / 100) * 100;
  const offerCents = Math.floor(sellCents * (1 - offer));

  return {
    cost: eur(costCents),
    profit: eur(profitCents),
    roi,
    verdict,
    breakEven: eur(costCents),
    minPrice: eur(minPriceCents),
    listPrice: eur(listPriceCents),
    minOffer: eur(minPriceCents),
    afterOffer: scenario(`Con oferta −${Math.round(offer * 100)} %`, offerCents, costCents),
    scenarios: [0, 10, 20, 30].map((pct) =>
      scenario(pct === 0 ? 'Precio previsto' : `−${pct} %`, Math.floor((sellCents * (100 - pct)) / 100), costCents),
    ),
  };
}
