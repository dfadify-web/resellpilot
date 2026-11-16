import { describe, expect, it } from 'vitest';
import { marketFor, marketVerdict } from '../src/market';

const trend = (query: string, avg: number | null, count = 40) => ({
  query,
  avg_price: avg,
  median_price: avg,
  listings_count: count,
  computed_at: '2026-11-16T10:00:00.000Z',
});

describe('precio de mercado de un anuncio', () => {
  it('compara el precio con la media de la búsqueda más específica que encaja con el título', () => {
    const market = marketFor({ title: 'Termo acero negro 500 ml', price: 24 }, [trend('termo acero', 15), trend('termo acero negro', 20)]);
    expect(market).toMatchObject({ query: 'termo acero negro', avg_price: 20, diff: 0.2, verdict: 'caro', suggested_price: 18 });
  });

  it('barato, en precio y sin veredicto con pocos anuncios o sin precio', () => {
    expect(marketFor({ title: 'Termo acero', price: 12 }, [trend('termo acero', 20)])?.verdict).toBe('barato');
    expect(marketFor({ title: 'Termo acero', price: 21 }, [trend('termo acero', 20)])?.verdict).toBe('en_precio');
    expect(marketFor({ title: 'Termo acero', price: 40 }, [trend('termo acero', 20, 3)])?.verdict).toBeNull();
    expect(marketFor({ title: 'Termo acero', price: null }, [trend('termo acero', 20)])).toMatchObject({ diff: null, verdict: null });
  });

  it('sin tendencia que encaje o sin media, no hay referencia', () => {
    expect(marketFor({ title: 'Bolso piel', price: 10 }, [trend('termo acero', 20)])).toBeNull();
    expect(marketFor({ title: 'Termo acero', price: 10 }, [trend('termo acero', null)])).toBeNull();
  });

  it('el margen de «en precio» es del 15 % a cada lado', () => {
    expect(marketVerdict(0.15)).toBe('en_precio');
    expect(marketVerdict(0.151)).toBe('caro');
    expect(marketVerdict(-0.15)).toBe('en_precio');
    expect(marketVerdict(-0.151)).toBe('barato');
  });
});
