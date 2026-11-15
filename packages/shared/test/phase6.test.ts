import { describe, expect, it } from 'vitest';
import {
  MAX_HASHTAGS,
  MAX_LISTING_TITLE,
  dailySummaryTimeReached,
  generateListingText,
  renderDailySummary,
  repricingSuggestion,
  weekRange,
  weeklyReport,
  type DailySummaryData,
  type Item,
} from '../src';

const NOW = new Date(2026, 10, 15, 12, 0, 0);
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('sugerencias de bajada de precio', () => {
  const listing = (days: number, price: number | null = 20, status = 'activo') => ({ status, price, listed_at: daysAgo(days) });

  it('no sugiere nada si el anuncio no es stale, no está activo o no tiene precio', () => {
    expect(repricingSuggestion(listing(14), 14, null, NOW)).toBeNull();
    expect(repricingSuggestion(listing(40, 20, 'vendido'), 14, null, NOW)).toBeNull();
    expect(repricingSuggestion(listing(40, null), 14, null, NOW)).toBeNull();
    expect(repricingSuggestion({ status: 'activo', price: 20, listed_at: null }, 14, null, NOW)).toBeNull();
  });

  it('sugiere −5 % hasta el doble de STALE_DAYS y −10 % después', () => {
    expect(repricingSuggestion(listing(15), 14, null, NOW)).toMatchObject({ pct: 5, new_price: 19, days_listed: 15 });
    expect(repricingSuggestion(listing(28), 14, null, NOW)).toMatchObject({ pct: 5, new_price: 19 });
    expect(repricingSuggestion(listing(29), 14, null, NOW)).toMatchObject({
      pct: 10,
      new_price: 18,
      price_minus_5: 19,
      price_minus_10: 18,
      total_cost: null,
      margin: null,
      below_cost: false,
    });
  });

  it('calcula el margen con el coste del item enlazado', () => {
    expect(repricingSuggestion(listing(40), 14, 7.5, NOW)).toMatchObject({ pct: 10, new_price: 18, margin: 10.5, below_cost: false });
  });

  it('se queda en −5 % si el −10 % no cubre el coste y avisa si ninguno lo cubre', () => {
    expect(repricingSuggestion(listing(40), 14, 18.5, NOW)).toMatchObject({ pct: 5, new_price: 19, margin: 0.5, below_cost: false });
    expect(repricingSuggestion(listing(40), 14, 19.5, NOW)).toMatchObject({ pct: 10, new_price: 18, margin: -1.5, below_cost: true });
  });
});

describe('generador de anuncio', () => {
  const base = { name: 'termo acero 500 ml', condition: 'nuevo_sin_etiquetas' as const, shipHours: 48, inHand: true };

  it('monta título, descripción y hashtags con los datos del item', () => {
    const text = generateListingText({ ...base, brand: 'Kivo', color: 'Negro', notes: 'mantiene el frío 24 h\nSin BPA.' });
    expect(text.title).toBe('Termo acero 500 ml Kivo negro · Nuevo');
    expect(text.hashtags).toEqual(['#termoacero', '#termo', '#acero', '#kivo', '#negro', '#nuevo']);
    expect(text.description).toBe(
      [
        'Termo acero 500 ml Kivo.',
        'Nuevo, sin etiquetas. Sin estrenar.',
        'Color: negro',
        'Mantiene el frío 24 h.',
        'Sin BPA.',
        '',
        'Lo tengo en mano: envío en 48 h desde la compra, bien protegido.',
        'Cualquier duda, pregunta sin compromiso.',
        '',
        '#termoacero #termo #acero #kivo #negro #nuevo',
      ].join('\n'),
    );
    expect(text.warnings).toEqual([]);
  });

  it('solo promete plazo de envío si el artículo está en mano (Regla 8)', () => {
    const text = generateListingText({ ...base, inHand: false });
    expect(text.description).not.toMatch(/envío en \d+ h/);
    expect(text.description).toContain('Se envía bien protegido.');
  });

  it('no repite la marca ni el color que ya están en el nombre, y añade la talla', () => {
    const text = generateListingText({
      name: 'Sudadera gris Kivo',
      brand: 'kivo',
      color: 'gris',
      size: 'm',
      condition: 'muy_bueno',
      shipHours: 24,
      inHand: true,
    });
    expect(text.title).toBe('Sudadera gris Kivo · Talla M');
    expect(text.description).toContain('Talla: M · Color: gris');
    expect(text.description).toContain('Muy buen estado');
    expect(text.hashtags).not.toContain('#nuevo');
  });

  it('respeta los límites de título y de hashtags', () => {
    const text = generateListingText({
      ...base,
      name: 'organizador cables escritorio magnetico silicona soporte cargador movil tablet portatil oficina viaje regalo',
    });
    expect(text.title.length).toBeLessThanOrEqual(MAX_LISTING_TITLE);
    expect(text.title).not.toMatch(/\s$/);
    expect(text.hashtags.length).toBeLessThanOrEqual(MAX_HASHTAGS);
    expect(new Set(text.hashtags).size).toBe(text.hashtags.length);
  });

  it('avisa si los detalles llevan un enlace o datos de contacto', () => {
    expect(generateListingText({ ...base, notes: 'más fotos en www.ejemplo.com' }).warnings[0]).toMatch(/un enlace/);
    expect(generateListingText({ ...base, notes: 'escríbeme por whatsapp' }).warnings[0]).toMatch(/otra plataforma/);
  });
});

describe('informe semanal', () => {
  const item = (id: number, soldAt: Date | null, price: number | null, cost = 5): Item => ({
    id,
    name: `Item ${id}`,
    brand: null,
    source_url: null,
    cost,
    shipping_cost: 1,
    extra_costs: 0.5,
    stock: price === null ? 'listado' : 'vendido',
    sold_price: price,
    sold_at: soldAt ? soldAt.toISOString() : null,
    created_at: new Date(2026, 9, 1).toISOString(),
  });

  it('la semana va de lunes 00:00 a lunes 00:00, en hora local', () => {
    // 15/11/2026 es domingo.
    const week = weekRange(NOW);
    expect(week).toMatchObject({ monday: '2026-11-09', sunday: '2026-11-15' });
    expect(week.start).toEqual(new Date(2026, 10, 9));
    expect(week.end).toEqual(new Date(2026, 10, 16));
    expect(weekRange(new Date(2026, 10, 9, 0, 0, 0)).monday).toBe('2026-11-09');
    expect(weekRange(new Date(2026, 10, 16, 0, 0, 0)).monday).toBe('2026-11-16');
    expect(weekRange(NOW, -1)).toMatchObject({ monday: '2026-11-02', sunday: '2026-11-08' });
  });

  it('incluye solo las ventas de la semana y suma los totales sin errores de coma flotante', () => {
    const items = [
      item(1, new Date(2026, 10, 9, 0, 0, 0), 20.1),
      item(2, new Date(2026, 10, 15, 23, 59, 0), 10.2, 3),
      item(3, new Date(2026, 10, 8, 23, 59, 0), 50), // semana anterior
      item(4, new Date(2026, 10, 16, 0, 0, 0), 50), // semana siguiente
      item(5, null, null), // sin vender
    ];
    const report = weeklyReport(items, weekRange(NOW));
    expect(report.rows.map((row) => row.id)).toEqual([1, 2]);
    expect(report.rows[0]).toMatchObject({ sold_price: 20.1, total_cost: 6.5, profit: 13.6 });
    expect(report).toMatchObject({ sales: 2, revenue: 30.3, cost: 11, profit: 19.3, roi: 1.7545 });
  });

  it('una semana sin ventas da ceros y ROI nulo', () => {
    expect(weeklyReport([], weekRange(NOW))).toMatchObject({ sales: 0, revenue: 0, profit: 0, roi: null, rows: [] });
  });
});

describe('resumen diario', () => {
  const data: DailySummaryData = {
    now: NOW,
    sales: ['Vendido: Termo acero (14,00 €)'],
    sold_items: 1,
    sold_profit: 8.5,
    new_favs: 4,
    fav_listings: [{ title: 'Termo acero', count: 3 }],
    stale_count: 5,
    stale: [
      { title: 'Lámpara led', days: 40 },
      { title: 'Funda', days: 30 },
      { title: 'Soporte', days: 20 },
      { title: 'Otro', days: 16 },
    ],
    deals: [{ title: 'Organizador cables', est_profit: 7.2, roi: 1.5, url: 'https://tienda.example/p/1' }],
  };

  it('incluye ventas, favoritos, stale y las mejores oportunidades', () => {
    const text = renderDailySummary(data);
    expect(text).toContain('ResellPilot · domingo, 15 de noviembre');
    expect(text).toContain('💰 Ventas (24 h): 1');
    expect(text).toContain('· Termo acero (14,00 €)');
    expect(text).toContain('Inventario: 1 item vendido, beneficio +8,50 €');
    expect(text).toContain('⭐ Favoritos nuevos (24 h): 4');
    expect(text).toContain('· Termo acero (+3)');
    expect(text).toContain('🕒 Anuncios stale: 5');
    expect(text).toContain('· Soporte (20 días)');
    expect(text).not.toContain('Otro');
    expect(text).toContain('· Organizador cables · +7,20 € · ROI 150 %');
    expect(text).toContain('https://tienda.example/p/1');
  });

  it('un día sin novedades sigue siendo un resumen legible', () => {
    const text = renderDailySummary({ ...data, sales: [], sold_items: 0, new_favs: 0, fav_listings: [], stale_count: 0, stale: [], deals: [] });
    expect(text).toContain('💰 Ventas (24 h): 0');
    expect(text).toContain('🟢 Mejores oportunidades: ninguna recomendada ahora');
    expect(text).not.toContain('Inventario:');
    expect(text).not.toContain('bajadas sugeridas');
  });

  it('la hora del resumen son las 08:30', () => {
    expect(dailySummaryTimeReached(new Date(2026, 10, 15, 8, 29))).toBe(false);
    expect(dailySummaryTimeReached(new Date(2026, 10, 15, 8, 30))).toBe(true);
    expect(dailySummaryTimeReached(new Date(2026, 10, 15, 23, 0))).toBe(true);
  });
});
