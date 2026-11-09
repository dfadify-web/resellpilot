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

/** Estados de `deals.status`. */
export const DEAL_STATUSES = ['nuevo', 'descartado', 'comprado'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Estados de `commands.status`. */
export const COMMAND_STATUSES = ['pending', 'running', 'done', 'failed', 'cancelled'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];
