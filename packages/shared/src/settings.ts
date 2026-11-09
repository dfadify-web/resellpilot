/** Ajustes por defecto del PRD. Editables en la UI; se guardan en la tabla `settings`. */
export const DEFAULT_SETTINGS = {
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
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export type Settings = {
  [K in SettingKey]: (typeof DEFAULT_SETTINGS)[K] extends boolean ? boolean : number;
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

/** Serializa un valor de ajuste para la columna `settings.value` (TEXT). */
export function serializeSetting(value: number | boolean): string {
  return String(value);
}
