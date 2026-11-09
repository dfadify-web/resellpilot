import { DEFAULT_SETTINGS, SETTING_KEYS, type Settings } from '@resellpilot/shared';
import type { Db } from './db';

/** Ajustes tipados leídos de la tabla `settings`. Un valor ilegible cae al valor por defecto. */
export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const settings: Record<string, number | boolean> = { ...DEFAULT_SETTINGS };

  for (const key of SETTING_KEYS) {
    const raw = stored.get(key);
    if (raw === undefined) continue;
    if (typeof DEFAULT_SETTINGS[key] === 'boolean') {
      settings[key] = raw === 'true';
    } else {
      const value = Number(raw);
      if (raw.trim() !== '' && Number.isFinite(value)) settings[key] = value;
    }
  }
  return settings as Settings;
}

/** Valor suelto de `settings` (claves que no son ajustes del PRD, p. ej. el chat de Telegram). */
export function getRawSetting(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setRawSetting(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
