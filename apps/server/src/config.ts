import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));

/** Raíz del monorepo. */
export const ROOT_DIR = resolve(here, '../../..');
export const DASHBOARD_DIR = resolve(ROOT_DIR, 'apps/dashboard');
/** Fuentes de oportunidades y lista de marcas: archivos editables en la raíz. */
export const SOURCES_PATH = resolve(ROOT_DIR, 'sources.json');
export const BLOCKLIST_PATH = resolve(ROOT_DIR, 'brand-blocklist.json');

/** El server solo escucha en loopback. No es configurable (Regla 2: todo local). */
export const HOST = '127.0.0.1';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  DB_PATH: z.string().min(1).default('./data/resellpilot.db'),
  OPEN_BROWSER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  TELEGRAM_BOT_TOKEN: z.string().trim().default(''),
  TELEGRAM_CHAT_ID: z.string().trim().default(''),
});

export interface Config {
  port: number;
  dbPath: string;
  openBrowser: boolean;
  telegramToken: string;
  telegramChatId: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const envFile = resolve(ROOT_DIR, '.env');
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);

  // Las variables vacías (`PORT=`) cuentan como no definidas.
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = envSchema.parse(clean);
  return {
    port: parsed.PORT,
    dbPath: isAbsolute(parsed.DB_PATH) ? parsed.DB_PATH : resolve(ROOT_DIR, parsed.DB_PATH),
    openBrowser: parsed.OPEN_BROWSER,
    telegramToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChatId: parsed.TELEGRAM_CHAT_ID,
  };
}
