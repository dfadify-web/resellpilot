import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDS_PER_DAY,
  computeTrendStats,
  cardTitle,
  relevantCards,
  trimmedMean,
  undercutPrice,
  deriveQuery,
  estPriceFromTrend,
  estimateAgeDays,
  idsPerDayFrom,
  keywordsOf,
  matchTrend,
  normalizeSearchCards,
  parseTotalResults,
  percentile,
  queryKey,
  relativeChange,
  type IdClock,
  type RawSearchCard,
} from '../src';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 10, 12);
const RATE = 10_000_000; // ids por día, redondo para las cuentas
const clock: IdClock = { maxId: 10_000_000_000, atMs: NOW, idsPerDay: RATE };

/** Id de un artículo publicado hace `days` días. */
const idAged = (days: number) => String(clock.maxId - days * RATE);
const card = (id: string, price: string, favs = ''): RawSearchCard => ({ id, price_text: price, favs_text: favs });

describe('tarjetas de búsqueda', () => {
  it('normaliza precio y favoritos', () => {
    expect(normalizeSearchCards([card('101', '13,00 €', '12'), card('102', '1.250,50 €'), card('103', ' 7,5 € ', ' 3 ')])).toEqual([
      { id: 101, price: 13, favs: 12, title: null },
      { id: 103, price: 7.5, favs: 3, title: null },
    ]);
  });

  it('descarta tarjetas sin id o precio válidos y las repetidas', () => {
    const cards = normalizeSearchCards([
      card('101', '10,00 €', '1'),
      card('101', '99,00 €', '9'),
      card('abc', '10,00 €'),
      card('102', 'gratis'),
      card('103', '0,00 €'),
      card('104', '5,00 €', 'muchos'),
    ]);
    expect(cards).toEqual([
      { id: 101, price: 10, favs: 1, title: null },
      { id: 104, price: 5, favs: 0, title: null },
    ]);
  });

  it('lee el total de resultados', () => {
    expect(parseTotalResults('500+ resultados', 96)).toBe(500);
    expect(parseTotalResults('1.234 resultados', 96)).toBe(1234);
    expect(parseTotalResults('37 resultados', 37)).toBe(37);
    expect(parseTotalResults('1 resultado', 1)).toBe(1);
    expect(parseTotalResults('', 42)).toBe(42);
    expect(parseTotalResults('3 resultados', 20)).toBe(20);
  });
});

describe('percentiles', () => {
  it('mediana y p25 con interpolación', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0.25)).toBe(17.5);
    expect(percentile([40, 10, 30, 20, 50], 0.5)).toBe(30);
    expect(percentile([40, 10, 30, 20, 50], 0.25)).toBe(20);
    expect(percentile([7], 0.25)).toBe(7);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('antigüedad por id', () => {
  it('estima los días desde el id más reciente', () => {
    expect(estimateAgeDays(Number(idAged(10)), clock)).toBe(10);
    expect(estimateAgeDays(Number(idAged(10)), clock, NOW + 2 * DAY)).toBe(12);
  });

  it('nunca baja de 1 día', () => {
    expect(estimateAgeDays(clock.maxId, clock)).toBe(1);
    expect(estimateAgeDays(clock.maxId + 5_000_000, clock)).toBe(1);
  });

  it('calibra el ritmo con puntos separados al menos un día', () => {
    expect(idsPerDayFrom([])).toBe(DEFAULT_IDS_PER_DAY);
    expect(idsPerDayFrom([{ id: 1_000_000_000, atMs: NOW }])).toBe(DEFAULT_IDS_PER_DAY);
    expect(idsPerDayFrom([{ id: 1_000_000_000, atMs: NOW }, { id: 1_005_000_000, atMs: NOW + DAY / 2 }])).toBe(DEFAULT_IDS_PER_DAY);
    expect(
      idsPerDayFrom([
        { id: 1_028_000_000, atMs: NOW + 2 * DAY },
        { id: 1_000_000_000, atMs: NOW },
        { id: 1_013_000_000, atMs: NOW + DAY },
      ]),
    ).toBe(14_000_000);
  });

  it('desconfía de una calibración absurda', () => {
    expect(idsPerDayFrom([{ id: 1_000_000_000, atMs: NOW }, { id: 1_000_000_100, atMs: NOW + 3 * DAY }])).toBe(DEFAULT_IDS_PER_DAY);
    expect(idsPerDayFrom([{ id: 1, atMs: NOW }, { id: 9_000_000_000, atMs: NOW + 2 * DAY }])).toBe(DEFAULT_IDS_PER_DAY);
  });
});

describe('estadísticas de una búsqueda', () => {
  const result = {
    query: 'termo acero',
    total_text: '500+ resultados',
    cards: [
      card(idAged(10), '10,00 €', '20'), // 2 favs/día
      card(idAged(5), '20,00 €', '5'), // 1 fav/día
      card(idAged(2), '30,00 €', ''), // 0
      card(idAged(0), '40,00 €', '3'), // antigüedad mínima 1 día → 3 favs/día
    ],
  };

  it('mediana, p25, total, favoritos medios y favoritos por día', () => {
    expect(computeTrendStats(result, clock)).toEqual({
      avg_price: 25,
      median_price: 25,
      p25_price: 17.5,
      listings_count: 500,
      avg_favs: 7,
      // 28 favoritos / (10 + 5 + 2 + 1) días
      favs_per_day: 1.556,
    });
  });

  it('sin calibración no hay favoritos por día, pero sí precios', () => {
    expect(computeTrendStats(result, null)).toMatchObject({ median_price: 25, avg_favs: 7, favs_per_day: null });
  });

  it('una búsqueda sin resultados', () => {
    expect(computeTrendStats({ query: 'x', total_text: '', cards: [] }, clock)).toEqual({
      avg_price: null,
      median_price: null,
      p25_price: null,
      listings_count: 0,
      avg_favs: null,
      favs_per_day: null,
    });
  });

  it('precio medio sin extremos y precio para vender por debajo de la media', () => {
    expect(trimmedMean([])).toBeNull();
    expect(trimmedMean([10, 20, 30])).toBe(20);
    // Con 10 o más precios se quitan el más barato y el más caro (10 % por cada lado).
    expect(trimmedMean([1, 10, 10, 10, 10, 10, 10, 10, 10, 500])).toBe(10);
    expect(undercutPrice(16.4, 10)).toBe(14.5);
    expect(undercutPrice(20, 10)).toBe(18);
    expect(undercutPrice(4.99, 10)).toBe(4.49);
    expect(undercutPrice(20, 0)).toBe(20);
    expect(undercutPrice(20, 200)).toBe(2);
  });

  it('precio estimado = (p25 + mediana) / 2', () => {
    expect(estPriceFromTrend({ median_price: 25, p25_price: 17.5 })).toBe(21.25);
    expect(estPriceFromTrend({ median_price: null, p25_price: null })).toBeNull();
  });

  it('variación frente a la semana anterior', () => {
    expect(relativeChange(1.5, 1.2)).toBe(0.25);
    expect(relativeChange(0.6, 1.2)).toBe(-0.5);
    expect(relativeChange(1, 0)).toBeNull();
    expect(relativeChange(null, 1)).toBeNull();
    expect(relativeChange(1, null)).toBeNull();
  });
});

describe('consultas', () => {
  it('palabras clave: sin acentos, palabras vacías, números ni tallas', () => {
    expect(keywordsOf('Organizador de cables para el escritorio (pack 3)')).toEqual(['organizador', 'cables', 'escritorio']);
    expect(keywordsOf('Chaussettes Sport Couleurs pour homme')).toEqual(['chaussettes', 'sport']);
    expect(keywordsOf('Termo TERMO térmo 500 ml')).toEqual(['termo']);
  });

  it('deriva una consulta de hasta 3 palabras', () => {
    expect(deriveQuery('Vaso térmico de acero inoxidable con tapa')).toBe('vaso termico acero');
    expect(deriveQuery('Bonnets Kaila')).toBe('bonnets kaila');
    expect(deriveQuery('de la 41')).toBeNull();
    expect(deriveQuery('Sac femme')).toBeNull();
    expect(deriveQuery(null)).toBeNull();
  });

  it('dos formas de escribir la misma consulta tienen la misma clave', () => {
    expect(queryKey('  Termo   Acero ')).toBe(queryKey('termo acero'));
    expect(queryKey('Botella térmica')).toBe('botella termica');
  });
});

describe('cruce de deals con tendencias', () => {
  const trends = [
    { query: 'termo', listings_count: 500 },
    { query: 'termo acero', listings_count: 300 },
    { query: 'botella termica', listings_count: 400 },
    { query: 'vaso', listings_count: 100 },
    { query: 'Vaso', listings_count: 250 },
  ];

  it('exige todas las palabras y prefiere la consulta más específica', () => {
    expect(matchTrend('Termo de acero inoxidable 500ml', trends)?.query).toBe('termo acero');
    expect(matchTrend('Termo de plástico', trends)?.query).toBe('termo');
    expect(matchTrend('Botella Térmica 750 ml', trends)?.query).toBe('botella termica');
  });

  it('a igualdad de palabras gana la de más anuncios', () => {
    expect(matchTrend('Vaso térmico', trends)?.listings_count).toBe(250);
  });

  it('no cruza por palabras parciales ni con títulos vacíos', () => {
    expect(matchTrend('Termostato digital', trends)).toBeNull();
    expect(matchTrend('Organizador de cables', trends)).toBeNull();
    expect(matchTrend(null, trends)).toBeNull();
    expect(matchTrend('Termo', [])).toBeNull();
  });
});

describe('relevancia de los resultados', () => {
  const titled = (id: string, price: string, title: string): RawSearchCard => ({
    id,
    price_text: price,
    favs_text: '',
    title_text: `${title}, Marca: X, Estado: Muy bueno, ${price}, 9.10 €`,
  });

  it('saca el título de la tarjeta sin marca, estado ni precios', () => {
    expect(cardTitle('Termo de acero, Marca: BMW, Estado: Muy bueno, 19.90 €, 21.60 €')).toBe('Termo de acero');
    expect(cardTitle('Vaso termo, Estado: Nuevo sin etiquetas, 5.00 €, 5.95 €')).toBe('Vaso termo');
    expect(cardTitle('')).toBeNull();
    expect(cardTitle(undefined)).toBeNull();
  });

  it('se queda con lo buscado: todas las palabras (también en plural), sin lotes ni mis anuncios', () => {
    const cards = normalizeSearchCards([
      titled('1', '5,00 €', 'Termo de acero'),
      titled('2', '6,00 €', 'Botella termo acero inoxidable'),
      titled('3', '4,00 €', 'Termos acero x2 nuevos'),
      titled('4', '7,00 €', 'Vaso termo acero'),
      titled('5', '50,00 €', '40 uds Termo Acero Inoxidable 500 ml'),
      titled('6', '1,00 €', 'Botella aluminio'),
      titled('7', '8,00 €', 'Termo acero café'),
      titled('8', '9,00 €', 'Termos de acero rosa'),
      titled('9', '6,50 €', 'Termo acero inoxidable camping'),
    ]);
    const ids = (rows: { id: number }[]) => rows.map((row) => row.id);
    expect(ids(relevantCards(cards, 'termo acero'))).toEqual([1, 2, 4, 7, 8, 9]);
    expect(ids(relevantCards(cards, 'termo acero', new Set([9])))).toEqual([1, 2, 4, 7, 8]);
  });

  it('con menos de 5 relevantes o sin títulos (extensión antigua) usa todas', () => {
    const few = normalizeSearchCards([titled('1', '5,00 €', 'Termo acero'), titled('2', '1,00 €', 'Botella aluminio')]);
    expect(relevantCards(few, 'termo acero')).toHaveLength(2);
    const old = normalizeSearchCards([card('1', '5,00 €'), card('2', '6,00 €')]);
    expect(relevantCards(old, 'termo acero')).toHaveLength(2);
  });

  it('la media sale solo de los relevantes', () => {
    const stats = computeTrendStats(
      {
        query: 'termo acero',
        total_text: '500+ resultados',
        cards: [
          titled('1', '5,00 €', 'Termo acero'),
          titled('2', '6,00 €', 'Termo acero rosa'),
          titled('3', '7,00 €', 'Termo acero azul'),
          titled('4', '6,00 €', 'Vaso termo acero'),
          titled('5', '6,00 €', 'Termo de acero'),
          titled('6', '60,00 €', 'Calentador thermo acuario'),
          titled('7', '50,00 €', 'Lote 40 termos acero'),
        ],
      },
      null,
    );
    expect(stats.avg_price).toBe(6);
    expect(stats.listings_count).toBe(500);
  });
});
