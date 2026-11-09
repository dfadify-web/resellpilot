import { toCents } from './calc';
import type { Settings } from './settings';

export type ScoringSettings = Pick<Settings, 'MIN_PROFIT_EUR' | 'MIN_ROI_PCT' | 'PACKAGING_EUR'>;

export interface ScoreInput {
  /** Precio de compra. */
  price: number | null;
  /** Precio de venta estimado: (p25 + mediana) / 2 de comparables, o manual. */
  est_price: number | null;
  /** favs_per_day de los comparables. Desconocido = no suma. */
  demand: number | null;
  /** listings_count de los comparables. Desconocido = no suma. */
  competition: number | null;
  risk_flags: readonly string[];
  shipping_cost?: number;
  extra_costs?: number;
}

export interface ScoreResult {
  landed_cost: number | null;
  est_profit: number | null;
  /** Ratio (0.8 = 80 %), 4 decimales. */
  roi: number | null;
  /** 0–100, un decimal. Siempre 0 si hay riesgo o faltan precios. */
  score: number;
  recommended: boolean;
}

/** Normaliza `value` al rango 0–1 entre `min` y `max`. */
export function norm(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/**
 * Scoring del PRD:
 *   landed_cost = price + shipping_cost + extra_costs + PACKAGING_EUR
 *   est_profit  = est_price − landed_cost
 *   roi         = est_profit / landed_cost
 *   score       = 100 · (0,35·norm(roi,0,3) + 0,25·norm(est_profit,0,30)
 *                        + 0,25·norm(favs_per_day,0,2) + 0,15·(1 − norm(listings_count,0,300)))
 *   con riesgo → score = 0 y excluido
 *   recomendado = est_profit ≥ MIN_PROFIT_EUR && roi ≥ MIN_ROI_PCT/100 && sin riesgo
 */
export function scoreDeal(input: ScoreInput, settings: ScoringSettings): ScoreResult {
  const hasRisk = input.risk_flags.length > 0;
  if (input.price === null) {
    return { landed_cost: null, est_profit: null, roi: null, score: 0, recommended: false };
  }

  const landedCents =
    toCents(input.price) +
    toCents(input.shipping_cost ?? 0) +
    toCents(input.extra_costs ?? 0) +
    toCents(settings.PACKAGING_EUR);
  const landed = landedCents / 100;

  if (input.est_price === null) {
    return { landed_cost: landed, est_profit: null, roi: null, score: 0, recommended: false };
  }

  const profitCents = toCents(input.est_price) - landedCents;
  const profit = profitCents / 100;
  const roi = landedCents > 0 ? profitCents / landedCents : null;

  const demandPart = input.demand === null ? 0 : norm(input.demand, 0, 2);
  const competitionPart = input.competition === null ? 0 : 1 - norm(input.competition, 0, 300);
  const raw =
    100 *
    (0.35 * norm(roi ?? 0, 0, 3) +
      0.25 * norm(profit, 0, 30) +
      0.25 * demandPart +
      0.15 * competitionPart);

  const recommended =
    !hasRisk &&
    roi !== null &&
    profit >= settings.MIN_PROFIT_EUR &&
    roi >= settings.MIN_ROI_PCT / 100;

  return {
    landed_cost: landed,
    est_profit: profit,
    roi: roi === null ? null : Math.round(roi * 10_000) / 10_000,
    score: hasRisk ? 0 : Math.round(raw * 10) / 10,
    recommended,
  };
}
