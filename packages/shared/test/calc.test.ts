import { describe, expect, it } from 'vitest';
import {
  computeSummary,
  isSold,
  monthKey,
  profit,
  roi,
  rotationDays,
  totalCost,
  withCalc,
  type Item,
} from '../src';

let nextId = 1;
/** Fecha local a mediodía → ISO (independiente de la zona horaria de la máquina). */
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: nextId++,
    name: 'Sudadera',
    brand: null,
    source_url: null,
    cost: 10,
    shipping_cost: 2,
    extra_costs: 0.5,
    stock: 'en_mano',
    sold_price: null,
    sold_at: null,
    created_at: local(2026, 11, 1),
    ...overrides,
  };
}

const sold = (overrides: Partial<Item> = {}) =>
  item({ stock: 'vendido', sold_price: 25, sold_at: local(2026, 11, 11), ...overrides });

describe('coste total', () => {
  it('suma coste, envío y otros costes', () => {
    expect(totalCost(item())).toBe(12.5);
  });

  it('no arrastra errores de coma flotante', () => {
    expect(totalCost(item({ cost: 0.1, shipping_cost: 0.2, extra_costs: 0 }))).toBe(0.3);
    expect(totalCost(item({ cost: 19.99, shipping_cost: 3.01, extra_costs: 0.3 }))).toBe(23.3);
  });

  it('con todo a cero es cero', () => {
    expect(totalCost(item({ cost: 0, shipping_cost: 0, extra_costs: 0 }))).toBe(0);
  });
});

describe('beneficio y ROI', () => {
  it('beneficio = venta − coste total', () => {
    expect(profit(sold())).toBe(12.5);
    expect(roi(sold())).toBe(1);
  });

  it('admite pérdidas', () => {
    const loss = sold({ sold_price: 10 });
    expect(profit(loss)).toBe(-2.5);
    expect(roi(loss)).toBe(-0.2);
  });

  it('redondea el ROI a 4 decimales', () => {
    // coste 12,50 → venta 23,20 → beneficio 10,70 → 0,856
    expect(roi(sold({ sold_price: 23.2 }))).toBe(0.856);
    // coste 3 → venta 4 → 1/3
    expect(roi(sold({ cost: 3, shipping_cost: 0, extra_costs: 0, sold_price: 4 }))).toBe(0.3333);
  });

  it('sin vender no hay beneficio ni ROI', () => {
    expect(profit(item())).toBeNull();
    expect(roi(item())).toBeNull();
  });

  it('un precio de venta en un item no vendido no cuenta', () => {
    const stale = item({ stock: 'listado', sold_price: 25 });
    expect(isSold(stale)).toBe(false);
    expect(profit(stale)).toBeNull();
  });

  it('vendido sin precio no cuenta como venta', () => {
    expect(profit(item({ stock: 'vendido', sold_price: null }))).toBeNull();
  });

  it('con coste 0 hay beneficio pero no ROI', () => {
    const free = sold({ cost: 0, shipping_cost: 0, extra_costs: 0 });
    expect(profit(free)).toBe(25);
    expect(roi(free)).toBeNull();
  });
});

describe('rotación', () => {
  it('cuenta los días entre alta y venta', () => {
    expect(rotationDays(sold())).toBe(10);
  });

  it('nunca es negativa', () => {
    expect(rotationDays(sold({ sold_at: local(2026, 10, 20) }))).toBe(0);
  });

  it('es null sin venta o sin fecha', () => {
    expect(rotationDays(item())).toBeNull();
    expect(rotationDays(sold({ sold_at: null }))).toBeNull();
  });

  it('withCalc añade todos los campos calculados', () => {
    expect(withCalc(sold())).toMatchObject({
      total_cost: 12.5,
      profit: 12.5,
      roi: 1,
      rotation_days: 10,
    });
    expect(withCalc(item())).toMatchObject({
      total_cost: 12.5,
      profit: null,
      roi: null,
      rotation_days: null,
    });
  });
});

describe('resumen', () => {
  const now = new Date(2026, 10, 15, 12); // 15 nov 2026, hora local

  it('vacío', () => {
    const summary = computeSummary([], now);
    expect(summary).toMatchObject({
      month: '2026-11',
      month_profit: 0,
      month_sales: 0,
      total_profit: 0,
      total_sales: 0,
      tied_capital: 0,
      avg_rotation_days: null,
      total_items: 0,
    });
    expect(Object.values(summary.by_stock)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('beneficio del mes: solo ventas del mes en curso', () => {
    const summary = computeSummary(
      [
        sold(), // nov: +12,50
        sold({ sold_price: 10 }), // nov: −2,50
        sold({ sold_at: local(2026, 10, 31), created_at: local(2026, 10, 1) }), // oct: +12,50
        sold({ sold_at: local(2025, 11, 11), created_at: local(2025, 11, 1) }), // nov de otro año
        item(),
      ],
      now,
    );
    expect(summary.month_profit).toBe(10);
    expect(summary.month_sales).toBe(2);
    expect(summary.total_profit).toBe(35);
    expect(summary.total_sales).toBe(4);
  });

  it('los límites del mes van en hora local', () => {
    const firstMinute = new Date(2026, 10, 1, 0, 1).toISOString();
    const lastMinute = new Date(2026, 10, 30, 23, 59).toISOString();
    const nextMonth = new Date(2026, 11, 1, 0, 1).toISOString();
    const summary = computeSummary(
      [sold({ sold_at: firstMinute }), sold({ sold_at: lastMinute }), sold({ sold_at: nextMonth })],
      now,
    );
    expect(summary.month_sales).toBe(2);
    expect(monthKey(new Date(2026, 0, 5))).toBe('2026-01');
  });

  it('capital inmovilizado: comprado y sin vender', () => {
    const summary = computeSummary(
      [
        item({ stock: 'idea' }), // no cuenta: aún no se ha comprado
        item({ stock: 'pedido' }),
        item({ stock: 'en_camino' }),
        item({ stock: 'en_mano' }),
        item({ stock: 'listado' }),
        item({ stock: 'reservado' }),
        sold(), // no cuenta: ya se recuperó
        item({ stock: 'devuelto' }), // no cuenta
      ],
      now,
    );
    expect(summary.tied_capital).toBe(62.5);
  });

  it('rotación media con un decimal', () => {
    const summary = computeSummary(
      [
        sold(), // 10 días
        sold({ sold_at: local(2026, 11, 6) }), // 5 días
        sold({ sold_at: local(2026, 11, 2) }), // 1 día
        item(),
      ],
      now,
    );
    expect(summary.avg_rotation_days).toBe(5.3);
  });

  it('cuenta los items por estado', () => {
    const summary = computeSummary([item(), item(), item({ stock: 'idea' }), sold()], now);
    expect(summary.by_stock).toEqual({
      idea: 1,
      pedido: 0,
      en_camino: 0,
      en_mano: 2,
      listado: 0,
      reservado: 0,
      vendido: 1,
      devuelto: 0,
    });
    expect(summary.total_items).toBe(4);
  });
});
