/** Estados de `items.stock`. Deben coincidir con el CHECK de la migración. */
export const STOCK_STATES = [
  'idea',
  'pedido',
  'en_camino',
  'en_mano',
  'listado',
  'reservado',
  'vendido',
  'devuelto',
] as const;
export type StockState = (typeof STOCK_STATES)[number];

/** Etiquetas en español para la UI. */
export const STOCK_LABELS: Record<StockState, string> = {
  idea: 'Idea',
  pedido: 'Pedido',
  en_camino: 'En camino',
  en_mano: 'En mano',
  listado: 'Listado',
  reservado: 'Reservado',
  vendido: 'Vendido',
  devuelto: 'Devuelto',
};

export function isStockState(value: unknown): value is StockState {
  return typeof value === 'string' && (STOCK_STATES as readonly string[]).includes(value);
}

/** Estados de `deals.status`. */
export const DEAL_STATUSES = ['nuevo', 'descartado', 'comprado'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Estados de `commands.status`. */
export const COMMAND_STATUSES = ['pending', 'running', 'done', 'failed', 'cancelled'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];
