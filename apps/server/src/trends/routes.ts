import {
  DEFAULT_OFFER_TEMPLATE,
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  serializeSetting,
  templateIssues,
  type SettingKey,
} from '@resellpilot/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { applyTrends, rescoreAll, scoringContext } from '../deals/service';
import { ValidationError } from '../errors';
import { extensionGuard } from '../extension-guard';
import { getOfferTemplate } from '../offers/service';
import { getRawSetting, getSettings, setRawSetting } from '../settings';
import type { Notifier } from '../telegram';
import { dueQueries, getIdClock, getSeeds, listTrends, recordTrends, setSeeds } from './service';

export interface TrendsDeps {
  notifier: Notifier;
  blocklistPath: string;
  extensionOrigin: string;
}

const KEY_SEARCH_URL = 'HACOO_SEARCH_URL';
/**
 * Ni hacoo.pl ni la web de enlaces tienen una búsqueda por URL (la de Hacoo solo existe en su app).
 * Por defecto el botón "Buscar en Hacoo" copia la consulta y abre la web de enlaces.
 */
export const DEFAULT_SEARCH_URL = 'https://dripsource.fit/';

const card = z
  .object({
    id: z.string().regex(/^\d{1,15}$/),
    price_text: z.string().max(40),
    favs_text: z.string().max(20),
  })
  .strict();

const trendsSchema = z
  .object({
    max_id_now: z.number().int().positive().max(1e15).nullable(),
    results: z
      .array(z.object({ query: z.string().min(1).max(120), total_text: z.string().max(60), cards: z.array(card).max(300) }).strict())
      .max(30),
  })
  .strict();

/** Límites de cada ajuste numérico: [mínimo, máximo, ¿entero?]. */
const LIMITS: Record<Exclude<SettingKey, 'DRY_RUN'>, [number, number, boolean]> = {
  OFFER_DISCOUNT_PCT: [1, 50, false],
  MAX_MESSAGES_PER_DAY: [0, 50, true],
  MSG_DELAY_MIN_S: [20, 600, true],
  MSG_DELAY_MAX_S: [20, 1800, true],
  READ_MIN_INTERVAL_S: [2, 60, false],
  TRENDS_MAX_REQ_PER_HOUR: [0, 120, true],
  TRENDS_CACHE_H: [1, 168, false],
  MIN_PROFIT_EUR: [0, 1000, false],
  MIN_ROI_PCT: [0, 1000, false],
  STALE_DAYS: [1, 365, true],
  PACKAGING_EUR: [0, 20, false],
  SHIP_HOURS: [1, 240, true],
};

const settingsSchema = z
  .object({
    settings: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
    trend_seeds: z.array(z.string().trim().min(2, 'mínimo 2 caracteres').max(80)).max(100).optional(),
    hacoo_search_url: z.string().trim().max(300).optional(),
    offer_template: z.string().trim().max(600).optional(),
  })
  .strict();

function validSearchUrl(template: string): boolean {
  try {
    const url = new URL(template.replace('{query}', 'x'));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function registerTrendRoutes(app: FastifyInstance, db: Db, deps: TrendsDeps): void {
  const { notifier, blocklistPath, extensionOrigin } = deps;

  const onlyExtension = extensionGuard(extensionOrigin);

  /** La extensión envía las tarjetas de cada búsqueda pública; las estadísticas se calculan aquí. */
  app.post('/api/vinted/trends', { onRequest: onlyExtension, bodyLimit: 2 * 1024 * 1024 }, async (request) => {
    const payload = trendsSchema.parse(request.body);
    const saved = recordTrends(db, payload);
    const deals = await applyTrends(db, scoringContext(db, blocklistPath), notifier);
    return { saved, deals };
  });

  const readSettings = () => ({
    settings: getSettings(db),
    defaults: DEFAULT_SETTINGS,
    trend_seeds: getSeeds(db),
    hacoo_search_url: getRawSetting(db, KEY_SEARCH_URL) ?? DEFAULT_SEARCH_URL,
    offer_template: getOfferTemplate(db),
    default_offer_template: DEFAULT_OFFER_TEMPLATE,
  });

  app.get('/api/trends', async () => {
    const clock = getIdClock(db);
    return {
      trends: listTrends(db),
      due: dueQueries(db).length,
      calibrated_at: clock ? new Date(clock.atMs).toISOString() : null,
      hacoo_search_url: readSettings().hacoo_search_url,
    };
  });

  app.get('/api/settings', async () => readSettings());

  app.put('/api/settings', async (request) => {
    const input = settingsSchema.parse(request.body ?? {});
    const issues: { path: string; message: string }[] = [];
    const next: Record<string, number | boolean> = { ...getSettings(db) };

    for (const [key, value] of Object.entries(input.settings ?? {})) {
      if (!(SETTING_KEYS as string[]).includes(key)) {
        issues.push({ path: key, message: 'ajuste desconocido' });
      } else if (key === 'DRY_RUN') {
        // La escritura real en Vinted (bajar precios, enviar mensajes) no está verificada todavía:
        // hasta entonces todo se ejecuta en simulación y DRY_RUN no se puede apagar.
        if (value !== true) {
          issues.push({ path: key, message: 'la escritura real en Vinted aún no está habilitada: sigue en simulación' });
        }
      } else {
        const [min, max, integer] = LIMITS[key as Exclude<SettingKey, 'DRY_RUN'>];
        if (typeof value !== 'number' || !Number.isFinite(value)) issues.push({ path: key, message: 'debe ser un número' });
        else if (value < min || value > max) issues.push({ path: key, message: `debe estar entre ${min} y ${max}` });
        else if (integer && !Number.isInteger(value)) issues.push({ path: key, message: 'debe ser un número entero' });
        else next[key] = value;
      }
    }
    if ((next.MSG_DELAY_MAX_S as number) < (next.MSG_DELAY_MIN_S as number)) {
      issues.push({ path: 'MSG_DELAY_MAX_S', message: 'no puede ser menor que MSG_DELAY_MIN_S' });
    }
    if (input.hacoo_search_url !== undefined && input.hacoo_search_url !== '' && !validSearchUrl(input.hacoo_search_url)) {
      issues.push({ path: 'hacoo_search_url', message: 'debe ser una URL http(s); puede incluir {query}' });
    }
    if (input.offer_template !== undefined && input.offer_template !== '') {
      for (const message of templateIssues(input.offer_template)) issues.push({ path: 'offer_template', message });
    }
    if (issues.length > 0) throw new ValidationError(issues);

    db.transaction(() => {
      for (const key of SETTING_KEYS) setRawSetting(db, key, serializeSetting(next[key] as number | boolean));
      if (input.trend_seeds !== undefined) setSeeds(db, input.trend_seeds);
      if (input.offer_template !== undefined) {
        setRawSetting(db, 'OFFER_TEMPLATE', input.offer_template === '' ? DEFAULT_OFFER_TEMPLATE : input.offer_template);
      }
      if (input.hacoo_search_url !== undefined) {
        setRawSetting(db, KEY_SEARCH_URL, input.hacoo_search_url === '' ? DEFAULT_SEARCH_URL : input.hacoo_search_url);
      }
    })();
    // Embalaje y umbrales afectan a beneficio, score y recomendación de los deals.
    rescoreAll(db, scoringContext(db, blocklistPath));
    return readSettings();
  });
}
