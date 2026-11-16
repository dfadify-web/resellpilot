import {
  dailySummaryTimeReached,
  dayKey,
  formatDecimal,
  isSold,
  profit,
  renderDailySummary,
  repricingSuggestion,
  stringifyCsv,
  totalCost,
  weekRange,
  weeklyReport,
  type DailySummaryData,
  type RepricingRow,
  type WeeklyReport,
} from '@resellpilot/shared';
import type { Db } from '../db';
import { hasAction, listDeals, logAction } from '../deals/repo';
import { toView, type ScoringContext } from '../deals/service';
import { listItems } from '../items/repo';
import { getSettings } from '../settings';
import type { Notifier, NotifyResult } from '../telegram';
import { listListings, listOrders } from '../vinted/sync';

const DAY_MS = 86_400_000;
const ACTION_DAILY = 'daily_summary';

// ───────────────────────── bajadas de precio sugeridas ─────────────────────────

/**
 * Anuncios stale con su bajada sugerida, primero los que más tiempo llevan en venta.
 * Tras una bajada (hecha desde ResellPilot o a mano en Vinted) no se vuelve a sugerir otra
 * hasta que pasen de nuevo `STALE_DAYS` días.
 */
export function listRepricing(db: Db, now: Date = new Date()): RepricingRow[] {
  const staleDays = getSettings(db).STALE_DAYS;
  const costs = new Map(listItems(db).map((item) => [item.id, totalCost(item)]));
  const cooldownFrom = new Date(now.getTime() - staleDays * DAY_MS).toISOString();
  const recentlyLowered = new Set(
    (
      db
        .prepare("SELECT DISTINCT target FROM action_log WHERE action IN ('price_drop', 'price_drop_manual') AND ts > ?")
        .all(cooldownFrom) as { target: string }[]
    ).map((row) => row.target),
  );
  const rows: RepricingRow[] = [];
  for (const listing of listListings(db, now)) {
    if (recentlyLowered.has(listing.vinted_id)) continue;
    const cost = listing.item_id === null ? null : (costs.get(listing.item_id) ?? null);
    const suggestion = repricingSuggestion(listing, staleDays, cost, now);
    if (!suggestion || listing.price === null) continue;
    rows.push({
      ...suggestion,
      listing_id: listing.id,
      vinted_id: listing.vinted_id,
      title: listing.title,
      price: listing.price,
      favs: listing.favs,
      views: listing.views,
      item_name: listing.item_name,
      photo: listing.photo,
      market: listing.market,
    });
  }
  return rows.sort((a, b) => b.days_listed - a.days_listed);
}

// ───────────────────────── informe semanal ─────────────────────────

/** Informe de la semana que contiene `date` (lunes a domingo, hora local). */
export const weeklyReportFor = (db: Db, date: Date, offsetWeeks = 0): WeeklyReport =>
  weeklyReport(listItems(db), weekRange(date, offsetWeeks));

/** CSV para Excel en español (`;`, coma decimal, BOM), con una fila de totales al final. */
export function weeklyReportCsv(report: WeeklyReport): string {
  const header = ['id', 'name', 'brand', 'sold_at', 'sold_price', 'total_cost', 'profit', 'roi'];
  const rows = report.rows.map((row) => [
    row.id,
    row.name,
    row.brand,
    row.sold_at,
    formatDecimal(row.sold_price),
    formatDecimal(row.total_cost),
    formatDecimal(row.profit),
    formatDecimal(row.roi, 4),
  ]);
  const total = [
    '',
    `TOTAL ${report.monday} a ${report.sunday} (${report.sales} ${report.sales === 1 ? 'venta' : 'ventas'})`,
    '',
    '',
    formatDecimal(report.revenue),
    formatDecimal(report.cost),
    formatDecimal(report.profit),
    formatDecimal(report.roi, 4),
  ];
  return '\uFEFF' + stringifyCsv([header, ...rows, total], ';');
}

// ───────────────────────── resumen diario ─────────────────────────

/** Reúne lo ocurrido en las últimas 24 h y el estado actual de anuncios y oportunidades. */
export function dailySummaryData(db: Db, context: ScoringContext, now: Date = new Date()): DailySummaryData {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const until = now.toISOString();

  const sales = (
    db
      .prepare("SELECT text FROM notifications WHERE type = 'venta' AND created_at > ? AND created_at <= ? ORDER BY created_at DESC, id DESC")
      .all(since, until) as { text: string | null }[]
  ).map((row) => row.text ?? 'Venta');

  const soldItems = listItems(db).filter((item) => {
    if (!isSold(item) || item.sold_at === null) return false;
    const soldMs = Date.parse(item.sold_at);
    return soldMs > now.getTime() - DAY_MS && soldMs <= now.getTime();
  });

  const favs = db
    .prepare(
      `SELECT COALESCE(l.title, 'Anuncio') AS title, COUNT(*) AS count
       FROM notifications n LEFT JOIN listings l ON l.id = n.listing_id
       WHERE n.type = 'favorito' AND n.created_at > ? AND n.created_at <= ?
       GROUP BY n.listing_id ORDER BY count DESC, title`,
    )
    .all(since, until) as { title: string; count: number }[];

  const listings = listListings(db, now);
  const stale = listings.filter((listing) => listing.stale).sort((a, b) => (b.days_listed ?? 0) - (a.days_listed ?? 0));
  const expensive = listings
    .filter((listing) => (listing.status === 'activo' || listing.status === 'reservado') && listing.market?.verdict === 'caro')
    .map((listing) => ({
      title: listing.title,
      price: listing.price ?? 0,
      avg_price: listing.market?.avg_price ?? 0,
      diff: listing.market?.diff ?? 0,
    }))
    .sort((a, b) => b.diff - a.diff);
  const toShip = listOrders(db)
    .filter((order) => order.state === 'enviar')
    .map((order) => ({ title: order.title, price: order.price }));

  const deals = listDeals(db, 'nuevo')
    .map((deal) => toView(deal, context.settings))
    .filter((deal) => deal.recommended);

  return {
    now,
    sales,
    sold_items: soldItems.length,
    sold_profit: Math.round(soldItems.reduce((sum, item) => sum + (profit(item) ?? 0), 0) * 100) / 100,
    new_favs: favs.reduce((sum, row) => sum + row.count, 0),
    fav_listings: favs.slice(0, 3),
    stale_count: stale.length,
    stale: stale.slice(0, 3).map((listing) => ({ title: listing.title, days: listing.days_listed ?? 0 })),
    deals: deals.slice(0, 3).map((deal) => ({
      title: deal.title ?? 'Sin título',
      est_profit: deal.est_profit,
      roi: deal.roi,
      url: deal.url,
    })),
    to_ship: toShip,
    expensive,
  };
}

export const dailySummaryText = (db: Db, context: ScoringContext, now: Date = new Date()): string =>
  renderDailySummary(dailySummaryData(db, context, now));

/** `true` si el resumen de hoy (día local) ya se envió. */
export const dailySummarySent = (db: Db, now: Date = new Date()): boolean => hasAction(db, ACTION_DAILY, dayKey(now));

/** Envía el resumen ahora y lo apunta como enviado hoy. */
export async function sendDailySummary(db: Db, notifier: Notifier, context: ScoringContext, now: Date = new Date()): Promise<NotifyResult> {
  const result = await notifier.send(dailySummaryText(db, context, now));
  if (result.ok) logAction(db, ACTION_DAILY, dayKey(now), 'ok', now.toISOString());
  else logAction(db, 'telegram_error', ACTION_DAILY, result.error ?? 'error', now.toISOString());
  return result;
}

/**
 * Resumen automático: una vez al día, a partir de las 08:30 (hora local). Se llama a esa hora y al
 * arrancar, por si el equipo estaba apagado a las 08:30. Devuelve `true` si lo ha enviado.
 */
export async function sendDailySummaryIfDue(db: Db, notifier: Notifier, context: ScoringContext, now: Date = new Date()): Promise<boolean> {
  if (!notifier.configured() || !dailySummaryTimeReached(now) || dailySummarySent(db, now)) return false;
  // Si falla (p. ej. el bot aún no conoce el chat) no se apunta nada: se reintenta en el siguiente arranque.
  const result = await notifier.send(dailySummaryText(db, context, now));
  if (result.ok) logAction(db, ACTION_DAILY, dayKey(now), 'ok', now.toISOString());
  return result.ok;
}
