import type { DealStatus } from './states';

/** Flag de riesgo que pone la lista de marcas (`brand-blocklist.json`). */
export const RISK_BRAND = 'riesgo_marca';

/** Fila de la tabla `deals`. */
export interface Deal {
  id: number;
  /** URL normalizada del producto (sin parámetros de seguimiento). Única. */
  url: string;
  /** Nombre de la fuente que lo encontró. */
  source: string | null;
  title: string | null;
  /** Precio de compra. `null` si el parser no pudo leerlo: se introduce a mano. */
  price: number | null;
  image: string | null;
  found_at: string;
  /** Precio de venta estimado. Manual hasta la Fase 4. */
  est_price: number | null;
  est_profit: number | null;
  roi: number | null;
  /** Favoritos por día de los comparables (Fase 4). */
  demand: number | null;
  /** Nº de anuncios comparables (Fase 4). */
  competition: number | null;
  score: number;
  risk_flags: string[];
  status: DealStatus;
}

/** Deal tal como lo devuelve la API. */
export type DealView = Deal & {
  /** price + PACKAGING_EUR. */
  landed_cost: number | null;
  recommended: boolean;
};

export interface DealPatch {
  title?: string;
  price?: number | null;
  est_price?: number | null;
  status?: 'nuevo' | 'descartado';
}

export type SourceType = 'telegram_public' | 'telegram_private' | 'web';

/** Estado de una fuente de `sources.json` tras su última ejecución. */
export interface SourceStatus {
  name: string;
  type: SourceType;
  url: string;
  last_run_at: string | null;
  /** `null` si aún no se ha ejecutado. */
  ok: boolean | null;
  /** Enlaces encontrados en la fuente en la última ejecución. */
  found: number;
  /** Deals nuevos creados en la última ejecución. */
  added: number;
  error: string | null;
}
