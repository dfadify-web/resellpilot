import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  RISK_BRAND,
  matchBlockedBrands,
  norm,
  normalizeForMatch,
  scoreDeal,
  type ScoreInput,
} from '../src';

const settings = DEFAULT_SETTINGS; // MIN_PROFIT_EUR 5 · MIN_ROI_PCT 80 · PACKAGING_EUR 0,30

const deal = (overrides: Partial<ScoreInput> = {}): ScoreInput => ({
  price: 10,
  est_price: 25,
  demand: null,
  competition: null,
  risk_flags: [],
  ...overrides,
});

describe('norm', () => {
  it('escala y recorta a 0–1', () => {
    expect(norm(1.5, 0, 3)).toBe(0.5);
    expect(norm(-1, 0, 3)).toBe(0);
    expect(norm(9, 0, 3)).toBe(1);
    expect(norm(Number.NaN, 0, 3)).toBe(0);
    expect(norm(1, 2, 2)).toBe(0);
  });
});

describe('scoring', () => {
  it('coste de llegada, beneficio y ROI', () => {
    // landed = 10 + 0,30 = 10,30 · beneficio = 14,70 · roi = 1,4272
    expect(scoreDeal(deal(), settings)).toEqual({
      landed_cost: 10.3,
      est_profit: 14.7,
      roi: 1.4272,
      // 100·(0,35·1,42718/3 + 0,25·14,7/30) = 28,90
      score: 28.9,
      recommended: true,
    });
  });

  it('suma envío y otros costes al coste de llegada', () => {
    const result = scoreDeal(deal({ shipping_cost: 2, extra_costs: 0.7 }), settings);
    expect(result.landed_cost).toBe(13);
    expect(result.est_profit).toBe(12);
  });

  it('demanda y competencia suman al score', () => {
    // + 0,25·norm(1,0,2)=0,125 + 0,15·(1−norm(150,0,300))=0,075 → +20
    expect(scoreDeal(deal({ demand: 1, competition: 150 }), settings).score).toBe(48.9);
    // sin competencia conocida no se regala ese 15 %
    expect(scoreDeal(deal({ demand: 1 }), settings).score).toBe(41.4);
    // competencia 0 → +15
    expect(scoreDeal(deal({ competition: 0 }), settings).score).toBe(43.9);
  });

  it('el score máximo es 100', () => {
    const best = scoreDeal(deal({ price: 5, est_price: 60, demand: 5, competition: 0 }), settings);
    expect(best.score).toBe(100);
  });

  it('con pérdidas el score no baja de 0 y no se recomienda', () => {
    const loss = scoreDeal(deal({ est_price: 8 }), settings);
    expect(loss.est_profit).toBe(-2.3);
    expect(loss.roi).toBe(-0.2233);
    expect(loss.score).toBe(0);
    expect(loss.recommended).toBe(false);
  });

  it('con riesgo: score 0 y excluido, pero se ve el beneficio', () => {
    expect(scoreDeal(deal({ risk_flags: [RISK_BRAND] }), settings)).toEqual({
      landed_cost: 10.3,
      est_profit: 14.7,
      roi: 1.4272,
      score: 0,
      recommended: false,
    });
  });

  it('recomendado exige beneficio mínimo Y ROI mínimo', () => {
    // beneficio 4,70 < 5
    expect(scoreDeal(deal({ price: 2, est_price: 7 }), settings).recommended).toBe(false);
    // beneficio 5,00 justo y ROI 217 %
    expect(scoreDeal(deal({ price: 2, est_price: 7.3 }), settings).recommended).toBe(true);
    // beneficio 14,70 pero ROI 72,6 % < 80 %
    expect(scoreDeal(deal({ price: 20, est_price: 35 }), settings).recommended).toBe(false);
    // ROI exactamente 80 %: landed 10,00 → venta 18,00
    expect(scoreDeal(deal({ price: 9.7, est_price: 18 }), settings).recommended).toBe(true);
    expect(scoreDeal(deal({ price: 9.7, est_price: 17.99 }), settings).recommended).toBe(false);
  });

  it('respeta los umbrales de Ajustes', () => {
    const strict = { ...settings, MIN_PROFIT_EUR: 20, MIN_ROI_PCT: 200 };
    expect(scoreDeal(deal(), strict).recommended).toBe(false);
    const noPackaging = { ...settings, PACKAGING_EUR: 0 };
    expect(scoreDeal(deal(), noPackaging).landed_cost).toBe(10);
  });

  it('sin precio o sin precio estimado no hay score', () => {
    expect(scoreDeal(deal({ price: null }), settings)).toEqual({
      landed_cost: null,
      est_profit: null,
      roi: null,
      score: 0,
      recommended: false,
    });
    expect(scoreDeal(deal({ est_price: null }), settings)).toEqual({
      landed_cost: 10.3,
      est_profit: null,
      roi: null,
      score: 0,
      recommended: false,
    });
  });

  it('con coste de llegada 0 no hay ROI ni recomendación', () => {
    const free = scoreDeal(deal({ price: 0 }), { ...settings, PACKAGING_EUR: 0 });
    expect(free.roi).toBeNull();
    expect(free.recommended).toBe(false);
  });
});

describe('lista de marcas', () => {
  const brands = ['Nike', 'Ralph Lauren', 'The North Face', "Levi's", 'Levis', 'Chloé', 'C.P. Company'];

  it('normaliza acentos, mayúsculas y signos', () => {
    expect(normalizeForMatch('  Suéter  CHLOÉ — "XL"! ')).toBe('sueter chloe xl');
  });

  it('detecta marcas como palabras completas', () => {
    expect(matchBlockedBrands('Nike TN', brands)).toEqual(['Nike']);
    expect(matchBlockedBrands('sueter RALPH   LAUREN azul', brands)).toEqual(['Ralph Lauren']);
    expect(matchBlockedBrands('Chaqueta the-north-face 1996', brands)).toEqual(['The North Face']);
    expect(matchBlockedBrands('Bolso Chloe', brands)).toEqual(['Chloé']);
    expect(matchBlockedBrands('Levis 501', brands)).toEqual(['Levis']);
    expect(matchBlockedBrands("Levi's 501", brands)).toEqual(["Levi's"]);
    expect(matchBlockedBrands('Gorro C.P. Company', brands)).toEqual(['C.P. Company']);
    expect(matchBlockedBrands('Nike x Ralph Lauren', brands)).toEqual(['Nike', 'Ralph Lauren']);
  });

  it('no coincide dentro de otras palabras ni con texto vacío', () => {
    expect(matchBlockedBrands('Zapatillas Bonike running', brands)).toEqual([]);
    expect(matchBlockedBrands('Organizador de cables', brands)).toEqual([]);
    expect(matchBlockedBrands('', brands)).toEqual([]);
    expect(matchBlockedBrands(null, brands)).toEqual([]);
    expect(matchBlockedBrands('Nike', ['', '  '])).toEqual([]);
  });
});
