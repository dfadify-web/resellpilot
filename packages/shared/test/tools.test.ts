import { describe, expect, it } from 'vitest';
import { calculate, suggestLinks, type CalculatorInput } from '../src';

const base: CalculatorInput = {
  buy: 5,
  buyShipping: 1,
  extra: 0,
  packaging: 0.3,
  sell: 18,
  offerPct: 10,
  minProfit: 5,
  minRoiPct: 80,
};

describe('calculadora «¿Me compensa?»', () => {
  it('coste, beneficio y ROI sin errores de coma flotante', () => {
    const result = calculate(base);
    expect(result).toMatchObject({ cost: 6.3, profit: 11.7, roi: 1.8571, verdict: 'compensa', breakEven: 6.3 });
  });

  it('precio mínimo, precio de anuncio con margen para la oferta y oferta mínima', () => {
    const result = calculate(base);
    // Mínimos: 6,30 + 5 = 11,30 € y 6,30 × 1,8 = 11,34 € → manda el mayor.
    expect(result.minPrice).toBe(11.34);
    expect(result.minOffer).toBe(11.34);
    // 11,34 / 0,9 = 12,60 → 13 € (al euro hacia arriba).
    expect(result.listPrice).toBe(13);
    expect(result.afterOffer).toEqual({ label: 'Con oferta −10 %', price: 16.2, profit: 9.9, roi: 1.5714 });
  });

  it('escenarios de bajada de precio', () => {
    expect(calculate(base).scenarios.map((s) => [s.label, s.price, s.profit])).toEqual([
      ['Precio previsto', 18, 11.7],
      ['−10 %', 16.2, 9.9],
      ['−20 %', 14.4, 8.1],
      ['−30 %', 12.6, 6.3],
    ]);
  });

  it('veredicto: compensa, justo o no compensa', () => {
    expect(calculate({ ...base, sell: 11.34 }).verdict).toBe('compensa');
    expect(calculate({ ...base, sell: 9 }).verdict).toBe('justo');
    expect(calculate({ ...base, sell: 6.3 }).verdict).toBe('no_compensa');
    expect(calculate({ ...base, sell: 0 }).verdict).toBe('no_compensa');
  });

  it('tolera campos vacíos o raros', () => {
    const result = calculate({ ...base, buy: Number.NaN, buyShipping: -3, packaging: 0, sell: 10 });
    expect(result).toMatchObject({ cost: 0, profit: 10, roi: null, verdict: 'compensa', minPrice: 5 });
    expect(calculate({ ...base, offerPct: 500 }).listPrice).toBeGreaterThan(0);
  });
});

describe('sugerencias de enlace anuncio ↔ item', () => {
  const listings = [
    { id: 1, title: 'Termo acero 500 ml negro', status: 'activo', item_id: null },
    { id: 2, title: 'Lámpara LED escritorio regulable', status: 'activo', item_id: null },
    { id: 3, title: 'Funda portátil 14 pulgadas', status: 'vendido', item_id: null },
    { id: 4, title: 'Mochila urbana', status: 'activo', item_id: 9 },
    { id: 5, title: 'Organizador cables', status: 'activo', item_id: null },
  ];
  const items = [
    { id: 10, name: 'Termo de acero 500ml', stock: 'en_mano' },
    { id: 11, name: 'Termo acero rosa', stock: 'en_mano' },
    { id: 12, name: 'Lampara led escritorio', stock: 'en_mano' },
    { id: 13, name: 'Funda portatil', stock: 'vendido' },
    { id: 9, name: 'Mochila urbana', stock: 'en_mano' },
    { id: 14, name: 'Cables HDMI', stock: 'en_mano' },
  ];

  it('empareja por palabras clave, cada uno una sola vez y lo más parecido primero', () => {
    const result = suggestLinks(listings, items);
    expect(result.map((s) => [s.listing_id, s.item_id])).toEqual([
      [2, 12],
      [3, 13],
      [1, 10],
    ]);
    expect(result.find((s) => s.listing_id === 2)?.shared).toEqual(['lampara', 'led', 'escritorio']);
  });

  it('no toca lo ya enlazado ni empareja un anuncio vendido con stock sin vender', () => {
    const result = suggestLinks(listings, items);
    expect(result.some((s) => s.listing_id === 4 || s.item_id === 9)).toBe(false);
    expect(suggestLinks([{ id: 3, title: 'Funda portátil 14', status: 'vendido', item_id: null }], [{ id: 1, name: 'Funda portatil', stock: 'en_mano' }])).toEqual([]);
  });

  it('con una sola palabra en común no basta si ambos títulos tienen más', () => {
    expect(suggestLinks([listings[4]!], [items[5]!])).toEqual([]);
    expect(suggestLinks([{ id: 1, title: 'Termo', status: 'activo', item_id: null }], [{ id: 2, name: 'Termo acero', stock: 'en_mano' }])).toHaveLength(1);
  });
});
