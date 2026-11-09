import {
  RISK_BRAND,
  matchBlockedBrands,
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
  const updated = updateDeal(db, id, patch) ?? deal;
  return toView(rescore(db, updated, context), context.settings);
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
