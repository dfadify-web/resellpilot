import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, NAV_ITEMS, SETTING_KEYS, STOCK_STATES, serializeSetting } from '../src';

describe('shared', () => {
  it('ajustes por defecto del PRD', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      OFFER_DISCOUNT_PCT: 10,
      MAX_MESSAGES_PER_DAY: 15,
      MSG_DELAY_MIN_S: 45,
      MSG_DELAY_MAX_S: 120,
      READ_MIN_INTERVAL_S: 3,
      TRENDS_MAX_REQ_PER_HOUR: 60,
      TRENDS_CACHE_H: 6,
      MIN_PROFIT_EUR: 5,
      MIN_ROI_PCT: 80,
      STALE_DAYS: 14,
      PACKAGING_EUR: 0.3,
      SHIP_HOURS: 48,
      DRY_RUN: true,
    });
    expect(SETTING_KEYS).toHaveLength(13);
  });

  it('DRY_RUN arranca activado', () => {
    expect(DEFAULT_SETTINGS.DRY_RUN).toBe(true);
    expect(serializeSetting(DEFAULT_SETTINGS.DRY_RUN)).toBe('true');
  });

  it('navegación completa y en orden', () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual([
      'Resumen',
      'Anuncios',
      'Notificaciones',
      'Oportunidades',
      'Tendencias',
      'Calculadora',
      'Inventario',
      'Ajustes',
    ]);
    expect(new Set(NAV_ITEMS.map((n) => n.path)).size).toBe(NAV_ITEMS.length);
  });

  it('estados de stock del PRD', () => {
    expect(STOCK_STATES).toEqual([
      'idea',
      'pedido',
      'en_camino',
      'en_mano',
      'listado',
      'reservado',
      'vendido',
      'devuelto',
    ]);
  });
});
