import type { Item, ItemWithCalc, Summary } from './items';
import { STOCK_STATES, type StockState } from './states';

const DAY_MS = 86_400_000;

/** Estados en los que el dinero ya está gastado y aún no se ha recuperado. */
export const TIED_STATES: readonly StockState[] = [
  'pedido',
  'en_camino',
  'en_mano',
  'listado',
  'reservado',
];

type Costs = Pick<Item, 'cost' | 'shipping_cost' | 'extra_costs'>;
type Sale = Costs & Pick<Item, 'stock' | 'sold_price'>;

/** Euros → céntimos enteros, para sumar sin errores de coma flotante. */
export const toCents = (eur: number): number => Math.round(eur * 100);

const totalCostCents = (item: Costs): number =>
  toCents(item.cost) + toCents(item.shipping_cost) + toCents(item.extra_costs);

/** Coste total = coste + envío + otros costes. */
export function totalCost(item: Costs): number {
  return totalCostCents(item) / 100;
}

/** Un item cuenta como venta si está en `vendido` y tiene precio de venta. */
export function isSold<T extends Pick<Item, 'stock' | 'sold_price'>>(
  item: T,
): item is T & { sold_price: number } {
  return item.stock === 'vendido' && item.sold_price !== null;
}

/** Beneficio real = precio de venta − coste total. `null` si no está vendido. */
export function profit(item: Sale): number | null {
  if (!isSold(item)) return null;
  return (toCents(item.sold_price) - totalCostCents(item)) / 100;
}

/** ROI = beneficio / coste total, como ratio (0.8 = 80 %). `null` si no hay venta o el coste es 0. */
export function roi(item: Sale): number | null {
  if (!isSold(item)) return null;
  const cost = totalCostCents(item);
  if (cost <= 0) return null;
  return Math.round(((toCents(item.sold_price) - cost) / cost) * 10_000) / 10_000;
}

/** Días entre el alta y la venta (nunca negativo). `null` si no está vendido o falta la fecha. */
export function rotationDays(
  item: Pick<Item, 'stock' | 'sold_price' | 'sold_at' | 'created_at'>,
): number | null {
  if (!isSold(item) || !item.sold_at) return null;
  const ms = Date.parse(item.sold_at) - Date.parse(item.created_at);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, ms / DAY_MS);
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function withCalc(item: Item): ItemWithCalc {
  const days = rotationDays(item);
  return {
    ...item,
    total_cost: totalCost(item),
    profit: profit(item),
    roi: roi(item),
    rotation_days: days === null ? null : round1(days),
  };
}

/** Clave de mes `AAAA-MM` en hora local. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** KPIs de Resumen. `now` decide cuál es "este mes" (hora local). */
export function computeSummary(items: readonly Item[], now: Date = new Date()): Summary {
  const month = monthKey(now);
  const byStock = Object.fromEntries(STOCK_STATES.map((s) => [s, 0])) as Record<StockState, number>;

  let monthProfitCents = 0;
  let monthSales = 0;
  let totalProfitCents = 0;
  let totalSales = 0;
  let tiedCents = 0;
  let rotationSum = 0;
  let rotationCount = 0;

  for (const item of items) {
    byStock[item.stock] += 1;

    if (TIED_STATES.includes(item.stock)) tiedCents += totalCostCents(item);

    if (isSold(item)) {
      const profitCents = toCents(item.sold_price) - totalCostCents(item);
      totalProfitCents += profitCents;
      totalSales += 1;

      if (item.sold_at) {
        const soldAt = new Date(item.sold_at);
        if (!Number.isNaN(soldAt.getTime()) && monthKey(soldAt) === month) {
          monthProfitCents += profitCents;
          monthSales += 1;
        }
      }

      const days = rotationDays(item);
      if (days !== null) {
        rotationSum += days;
        rotationCount += 1;
      }
    }
  }

  return {
    month,
    month_profit: monthProfitCents / 100,
    month_sales: monthSales,
    total_profit: totalProfitCents / 100,
    total_sales: totalSales,
    tied_capital: tiedCents / 100,
    avg_rotation_days: rotationCount === 0 ? null : round1(rotationSum / rotationCount),
    by_stock: byStock,
    total_items: items.length,
  };
}
