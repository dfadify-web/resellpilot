import type { StockState } from './states';

/** Fila de la tabla `items`. Importes en euros, fechas en ISO 8601. */
export interface Item {
  id: number;
  name: string;
  brand: string | null;
  source_url: string | null;
  cost: number;
  shipping_cost: number;
  extra_costs: number;
  stock: StockState;
  sold_price: number | null;
  sold_at: string | null;
  created_at: string;
}

/** Campos calculados de un item. */
export interface ItemCalc {
  /** cost + shipping_cost + extra_costs */
  total_cost: number;
  /** sold_price − total_cost. Solo si está vendido. */
  profit: number | null;
  /** profit / total_cost (ratio). Solo si está vendido y el coste es > 0. */
  roi: number | null;
  /** Días entre el alta y la venta. Solo si está vendido. */
  rotation_days: number | null;
}

export type ItemWithCalc = Item & ItemCalc;

/** Cuerpo para crear o editar un item. Las fechas admiten ISO, AAAA-MM-DD o DD/MM/AAAA. */
export interface ItemInput {
  name?: string;
  brand?: string | null;
  source_url?: string | null;
  cost?: number;
  shipping_cost?: number;
  extra_costs?: number;
  stock?: StockState;
  sold_price?: number | null;
  sold_at?: string | null;
  created_at?: string;
}

/** KPIs de la página Resumen. */
export interface Summary {
  /** Mes en curso, `AAAA-MM` (hora local). */
  month: string;
  /** Beneficio de los items vendidos este mes. */
  month_profit: number;
  month_sales: number;
  /** Beneficio de todos los items vendidos. */
  total_profit: number;
  total_sales: number;
  /** Coste total de lo comprado y aún sin vender. */
  tied_capital: number;
  /** Media de días entre alta y venta. `null` si no hay ventas. */
  avg_rotation_days: number | null;
  by_stock: Record<StockState, number>;
  total_items: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
}
