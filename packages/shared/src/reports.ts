/**
 * Informes (Fase 6): informe semanal de beneficios y resumen diario para Telegram.
 * Funciones puras; el server solo reúne los datos.
 */
import { isSold, toCents, totalCost } from './calc';
import type { Item } from './items';

const pad = (n: number): string => String(n).padStart(2, '0');
const localDay = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const eur = (value: number): string => `${value.toFixed(2).replace('.', ',')} €`;
const signedEur = (value: number): string => (value > 0 ? `+${eur(value)}` : eur(value));

// ───────────────────────── informe semanal ─────────────────────────

export interface WeekRange {
  /** Lunes a las 00:00, hora local. */
  start: Date;
  /** Lunes siguiente a las 00:00 (excluido). */
  end: Date;
  /** `AAAA-MM-DD` del lunes: identifica la semana. */
  monday: string;
  /** `AAAA-MM-DD` del domingo. */
  sunday: string;
}

/** Semana (lunes a domingo, hora local) que contiene `date`. `offsetWeeks = -1` es la anterior. */
export function weekRange(date: Date, offsetWeeks = 0): WeekRange {
  const sinceMonday = (date.getDay() + 6) % 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday + offsetWeeks * 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  const sunday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start, end, monday: localDay(start), sunday: localDay(sunday) };
}

export interface WeeklyRow {
  id: number;
  name: string;
  brand: string | null;
  sold_at: string;
  sold_price: number;
  total_cost: number;
  profit: number;
  /** Ratio (0.8 = 80 %). `null` si el coste es 0. */
  roi: number | null;
}

export interface WeeklyReport {
  monday: string;
  sunday: string;
  rows: WeeklyRow[];
  sales: number;
  revenue: number;
  cost: number;
  profit: number;
  roi: number | null;
}

const ratio = (profitCents: number, costCents: number): number | null =>
  costCents <= 0 ? null : Math.round((profitCents / costCents) * 10_000) / 10_000;

/** Ventas de la semana, de la más antigua a la más reciente, con sus totales. */
export function weeklyReport(items: readonly Item[], range: WeekRange): WeeklyReport {
  const rows: WeeklyRow[] = [];
  let revenueCents = 0;
  let costCents = 0;

  for (const item of items) {
    if (!isSold(item) || !item.sold_at) continue;
    const soldMs = Date.parse(item.sold_at);
    if (Number.isNaN(soldMs) || soldMs < range.start.getTime() || soldMs >= range.end.getTime()) continue;
    const cost = toCents(totalCost(item));
    const price = toCents(item.sold_price);
    revenueCents += price;
    costCents += cost;
    rows.push({
      id: item.id,
      name: item.name,
      brand: item.brand,
      sold_at: item.sold_at,
      sold_price: item.sold_price,
      total_cost: cost / 100,
      profit: (price - cost) / 100,
      roi: ratio(price - cost, cost),
    });
  }
  rows.sort((a, b) => Date.parse(a.sold_at) - Date.parse(b.sold_at) || a.id - b.id);

  return {
    monday: range.monday,
    sunday: range.sunday,
    rows,
    sales: rows.length,
    revenue: revenueCents / 100,
    cost: costCents / 100,
    profit: (revenueCents - costCents) / 100,
    roi: ratio(revenueCents - costCents, costCents),
  };
}

// ───────────────────────── resumen diario ─────────────────────────

export interface DailySummaryData {
  /** Momento del resumen. Cubre las 24 h anteriores. */
  now: Date;
  /** Textos de las ventas detectadas en Vinted («Vendido: … (12,00 €)»). */
  sales: string[];
  /** Items marcados como vendidos en el inventario y su beneficio total. */
  sold_items: number;
  sold_profit: number;
  new_favs: number;
  /** Anuncios con más favoritos nuevos. */
  fav_listings: { title: string; count: number }[];
  stale_count: number;
  /** Los que más tiempo llevan en venta. */
  stale: { title: string; days: number }[];
  /** Mejores oportunidades recomendadas. */
  deals: { title: string; est_profit: number | null; roi: number | null; url: string }[];
  /** Pedidos vendidos pendientes de enviar. */
  to_ship?: { title: string; price: number | null }[];
  /** Anuncios en venta bastante más caros que la media de Vinted, del más caro al menos. */
  expensive?: { title: string; price: number; avg_price: number; diff: number }[];
}

const MAX_LINES = 3;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Texto del resumen diario para Telegram. */
export function renderDailySummary(data: DailySummaryData): string {
  const day = data.now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const lines: string[] = [`☀️ ResellPilot · ${day}`, ''];

  const toShip = data.to_ship ?? [];
  if (toShip.length > 0) {
    lines.push(`📦 Por enviar: ${toShip.length}`);
    for (const order of toShip.slice(0, MAX_LINES)) lines.push(`  · ${order.title}${order.price === null ? '' : ` (${eur(order.price)})`}`);
    if (toShip.length > MAX_LINES) lines.push(`  · …y ${toShip.length - MAX_LINES} más`);
    lines.push('');
  }

  lines.push(`💰 Ventas (24 h): ${data.sales.length}`);
  for (const sale of data.sales.slice(0, MAX_LINES)) lines.push(`  · ${sale.replace(/^Vendido:\s*/i, '')}`);
  if (data.sales.length > MAX_LINES) lines.push(`  · …y ${data.sales.length - MAX_LINES} más`);
  if (data.sold_items > 0) {
    lines.push(`  Inventario: ${plural(data.sold_items, 'item vendido', 'items vendidos')}, beneficio ${signedEur(data.sold_profit)}`);
  }

  lines.push('', `⭐ Favoritos nuevos (24 h): ${data.new_favs}`);
  for (const listing of data.fav_listings.slice(0, MAX_LINES)) lines.push(`  · ${listing.title} (+${listing.count})`);

  lines.push('', `🕒 Anuncios stale: ${data.stale_count}`);
  for (const listing of data.stale.slice(0, MAX_LINES)) lines.push(`  · ${listing.title} (${listing.days} días)`);
  if (data.stale_count > 0) lines.push('  Mira las bajadas sugeridas en Anuncios.');

  const expensive = data.expensive ?? [];
  if (expensive.length > 0) {
    lines.push('', `🏷️ Caros frente a Vinted: ${expensive.length}`);
    for (const listing of expensive.slice(0, MAX_LINES)) {
      lines.push(`  · ${listing.title}: ${eur(listing.price)}, media ${eur(listing.avg_price)} (+${Math.round(listing.diff * 100)} %)`);
    }
  }

  lines.push('', `🟢 Mejores oportunidades: ${data.deals.length === 0 ? 'ninguna recomendada ahora' : ''}`.trimEnd());
  for (const deal of data.deals.slice(0, MAX_LINES)) {
    const profit = deal.est_profit === null ? '—' : signedEur(deal.est_profit);
    const roi = deal.roi === null ? '—' : `${Math.round(deal.roi * 100)} %`;
    lines.push(`  · ${deal.title} · ${profit} · ROI ${roi}`, `    ${deal.url}`);
  }

  return lines.join('\n');
}

/** Hora local del resumen diario (PRD: 08:30). */
export const DAILY_SUMMARY_HOUR = 8;
export const DAILY_SUMMARY_MINUTE = 30;

/** `true` si ya ha pasado la hora del resumen de hoy. */
export function dailySummaryTimeReached(now: Date): boolean {
  return now.getHours() * 60 + now.getMinutes() >= DAILY_SUMMARY_HOUR * 60 + DAILY_SUMMARY_MINUTE;
}
