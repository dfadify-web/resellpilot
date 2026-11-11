import {
  RISK_BRAND,
  estPriceFromTrend,
  matchBlockedBrands,
  matchTrend,
  normalizeForMatch,
  scoreDeal,
  type Deal,
  type DealPatch,
  type DealView,
  type Item,
  type Settings,
} from '@resellpilot/shared';
import type { Db } from '../db';
import { NotFoundError, ValidationError } from '../errors';
import { insertItem } from '../items/repo';
import { buildItemData } from '../items/schema';
import { getSettings } from '../settings';
import type { Notifier } from '../telegram';
import { latestTrends, type TrendRow } from '../trends/service';
import { getDeal, hasAction, listDeals, logAction, updateDeal } from './repo';
import { loadBlocklist } from './sources';

/** Lo que hace falta para puntuar: ajustes y lista de marcas, leídos en el momento. */
export interface ScoringContext {
  settings: Settings;
  brands: string[];
}

export function scoringContext(db: Db, blocklistPath: string): ScoringContext {
  return { settings: getSettings(db), brands: loadBlocklist(blocklistPath) };
}

/** Flags de riesgo de un deal: `riesgo_marca` si el título coincide con la lista de marcas. */
export function riskFlags(deal: Pick<Deal, 'title' | 'risk_flags'>, brands: readonly string[]): string[] {
  const others = deal.risk_flags.filter((flag) => flag !== RISK_BRAND);
  return matchBlockedBrands(deal.title, brands).length > 0 ? [RISK_BRAND, ...others] : others;
}

/**
 * Título de un deal nuevo. Si la página declara una marca que el título no nombra,
 * se añade al título: así la lista de marcas siempre decide mirando solo el título.
 */
export function dealTitle(title: string | null, brand: string | null): string | null {
  if (!brand) return title;
  if (!title) return brand;
  return ` ${normalizeForMatch(title)} `.includes(` ${normalizeForMatch(brand)} `) ? title : `${title} · ${brand}`;
}

export function toView(deal: Deal, settings: Settings): DealView {
  const result = scoreDeal(deal, settings);
  return { ...deal, landed_cost: result.landed_cost, recommended: result.recommended && deal.status === 'nuevo' };
}

/** Recalcula riesgo, beneficio, ROI y score de un deal y lo guarda. */
export function rescore(db: Db, deal: Deal, context: ScoringContext): Deal {
  const flags = riskFlags(deal, context.brands);
  const result = scoreDeal({ ...deal, risk_flags: flags }, context.settings);
  return (
    updateDeal(db, deal.id, {
      risk_flags: flags,
      est_profit: result.est_profit,
      roi: result.roi,
      score: result.score,
    }) ?? deal
  );
}

/** Reaplica la lista de marcas y los ajustes a todos los deals pendientes. */
export function rescoreAll(db: Db, context: ScoringContext): void {
  db.transaction(() => {
    for (const deal of listDeals(db, 'nuevo')) rescore(db, deal, context);
  })();
}

const NOTIFIED = 'telegram_deal';
const eur = (value: number | null): string =>
  value === null ? '—' : `${value.toFixed(2).replace('.', ',')} €`;

export function dealMessage(deal: DealView): string {
  const roi = deal.roi === null ? '—' : `${Math.round(deal.roi * 100)} %`;
  return [
    '🟢 Oportunidad recomendada',
    deal.title ?? 'Sin título',
    `Precio: ${eur(deal.price)} · Venta estimada: ${eur(deal.est_price)}`,
    `Beneficio estimado: ${eur(deal.est_profit)} · ROI ${roi} · Score ${String(deal.score).replace('.', ',')}`,
    deal.url,
  ].join('\n');
}

/** Avisa por Telegram la primera vez que un deal pasa a recomendado. Nunca lanza. */
export async function notifyIfRecommended(db: Db, notifier: Notifier, deal: DealView): Promise<void> {
  const target = String(deal.id);
  if (!deal.recommended || !notifier.configured() || hasAction(db, NOTIFIED, target)) return;
  const result = await notifier.send(dealMessage(deal));
  if (result.ok) logAction(db, NOTIFIED, target, 'ok');
  else logAction(db, 'telegram_error', target, result.error ?? 'error');
}

export function patchDeal(db: Db, id: number, patch: DealPatch, context: ScoringContext): DealView {
  const deal = getDeal(db, id);
  if (!deal) throw new NotFoundError('La oportunidad');
  if (patch.status !== undefined && deal.status === 'comprado') {
    throw new ValidationError([{ path: 'status', message: 'ya está comprada: gestiónala desde Inventario' }]);
  }
  // Un precio estimado escrito a mano manda sobre Tendencias; al borrarlo vuelve a ser automático.
  const manual = patch.est_price === undefined ? {} : { est_manual: patch.est_price !== null };
  let updated = updateDeal(db, id, { ...patch, ...manual }) ?? deal;
  if (!updated.est_manual && updated.est_price === null) updated = applyTrendToDeal(db, updated, usableTrends(db));
  return toView(rescore(db, updated, context), context.settings);
}

/** Mínimo de anuncios comparables para fiarse de una tendencia. */
const MIN_COMPARABLES = 5;

const usableTrends = (db: Db): TrendRow[] =>
  latestTrends(db).filter((trend) => trend.median_price !== null && trend.listings_count >= MIN_COMPARABLES);

/**
 * Rellena demanda y competencia (y el precio estimado, si no es manual) con la tendencia cuyas
 * palabras clave coinciden con el título. No recalcula el score: eso lo hace `rescore`.
 */
function applyTrendToDeal(db: Db, deal: Deal, trends: readonly TrendRow[]): Deal {
  const trend = matchTrend(deal.title, trends);
  if (!trend) return deal;
  return (
    updateDeal(db, deal.id, {
      demand: trend.favs_per_day,
      competition: trend.listings_count,
      ...(deal.est_manual ? {} : { est_price: estPriceFromTrend(trend) }),
    }) ?? deal
  );
}

/**
 * Cruza todos los deals pendientes sin riesgo con las tendencias (PRD F4.5), recalcula su score
 * y avisa por Telegram de los que pasan a recomendados. Devuelve cuántos deals tienen tendencia.
 */
export async function applyTrends(db: Db, context: ScoringContext, notifier: Notifier): Promise<number> {
  const trends = usableTrends(db);
  if (trends.length === 0) return 0;

  const changed: Deal[] = [];
  db.transaction(() => {
    for (const deal of listDeals(db, 'nuevo')) {
      if (deal.risk_flags.length > 0) continue;
      const updated = applyTrendToDeal(db, deal, trends);
      if (updated !== deal) changed.push(rescore(db, updated, context));
    }
  })();

  for (const deal of changed) await notifyIfRecommended(db, notifier, toView(deal, context.settings));
  return changed.length;
}

/** "Comprado": crea un item en estado `pedido` con el coste del deal y cierra el deal. */
export function buyDeal(db: Db, id: number, context: ScoringContext): { deal: DealView; item: Item } {
  const deal = getDeal(db, id);
  if (!deal) throw new NotFoundError('La oportunidad');
  if (deal.status === 'comprado') {
    throw new ValidationError([{ path: 'status', message: 'esta oportunidad ya está comprada' }]);
  }
  if (deal.price === null) {
    throw new ValidationError([{ path: 'price', message: 'pon el precio antes de marcarla como comprada' }]);
  }

  return db.transaction(() => {
    const item = insertItem(
      db,
      buildItemData(
        {
          name: (deal.title ?? `Oportunidad #${deal.id}`).slice(0, 200),
          source_url: deal.url,
          cost: deal.price as number,
          stock: 'pedido',
        },
        undefined,
        new Date().toISOString(),
      ),
    );
    const bought = updateDeal(db, id, { status: 'comprado' }) ?? deal;
    logAction(db, 'deal_comprado', String(id), `item ${item.id}`);
    return { deal: toView(bought, context.settings), item };
  })();
}
