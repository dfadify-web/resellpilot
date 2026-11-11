/**
 * Ofertas a favoritos (Fase 5): reglas puras de precio, plantilla, contenido y ritmo.
 * El server es quien decide cada paso; la extensión solo ejecuta lo que el server le entrega.
 */
import { toCents } from './calc';
import type { CommandStatus, StockState } from './states';

// ───────────────────────── precio ─────────────────────────

/** Precio con descuento, redondeado hacia abajo al céntimo. */
export function offerPrice(price: number, discountPct: number): number {
  return Math.floor((toCents(price) * (100 - discountPct)) / 100) / 100;
}

/** "18,00" → "18" · "17,5" → "17,50". Sin símbolo de euro. */
export function formatOfferPrice(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2).replace('.', ',');
}

// ───────────────────────── plantilla ─────────────────────────

export const OFFER_VARIABLES = ['nombre', 'titulo', 'precio_final', 'horas_envio', 'descuento'] as const;
export type OfferVariable = (typeof OFFER_VARIABLES)[number];

/** Plantilla del PRD. `{descuento}` evita que el texto mienta si se cambia OFFER_DISCOUNT_PCT. */
export const DEFAULT_OFFER_TEMPLATE =
  'Hola {nombre}, vi que te gustó {titulo}. Te lo dejo a {precio_final} € (−{descuento} %) y lo envío en {horas_envio} h. ¿Te lo reservo?';

export const MAX_MESSAGE_LENGTH = 500;

export function renderOfferMessage(template: string, values: Record<OfferVariable, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (whole, name: string) =>
      (OFFER_VARIABLES as readonly string[]).includes(name) ? values[name as OfferVariable] : whole,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Regla 9: los mensajes no llevan enlaces externos ni datos de contacto.
 * Devuelve qué se ha encontrado, o `null` si el texto es válido.
 */
export function findForbiddenContent(text: string): string | null {
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text)) return 'un correo electrónico';
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|es|net|org|io|me|app|shop|store|fit|link|ly|pl)\b/i.test(text)) return 'un enlace';
  if (/(^|\s)@\w{2,}/.test(text)) return 'un usuario de otra red (@…)';
  if (/(?:\+?\d[\s.-]?){9,}/.test(text)) return 'un número de teléfono';
  if (/\b(whats?app|wasap|telegram|instagram|insta|tiktok|bizum|paypal|wallapop|facebook|snapchat)\b/i.test(text)) {
    return 'una referencia a otra plataforma o medio de pago';
  }
  return null;
}

/** Problemas de una plantilla, para validarla al guardarla. Vacío = válida. */
export function templateIssues(template: string): string[] {
  const issues: string[] = [];
  const text = template.trim();
  if (text.length < 10) issues.push('es demasiado corta');
  if (text.length > MAX_MESSAGE_LENGTH) issues.push(`no puede pasar de ${MAX_MESSAGE_LENGTH} caracteres`);
  for (const match of text.matchAll(/\{(\w*)\}/g)) {
    if (!(OFFER_VARIABLES as readonly string[]).includes(match[1] ?? '')) {
      issues.push(`variable desconocida ${match[0]} (usa ${OFFER_VARIABLES.map((name) => `{${name}}`).join(' ')})`);
    }
  }
  const forbidden = findForbiddenContent(text.replace(/\{\w+\}/g, ''));
  if (forbidden) issues.push(`no puede incluir ${forbidden}`);
  return issues;
}

// ───────────────────────── elegibilidad ─────────────────────────

/**
 * Por qué un anuncio no admite ofertas, o `null` si las admite.
 * Regla 8: solo artículos con `stock = en_mano` (el mensaje promete un plazo de envío).
 */
export function offerBlocker(
  listing: { status: string | null; price: number | null },
  item: { stock: StockState } | null,
): string | null {
  if (listing.status !== 'activo') return 'el anuncio no está activo';
  if (listing.price === null || listing.price <= 0) return 'el anuncio no tiene precio';
  if (item === null) return 'enlaza el anuncio con su item de inventario';
  if (item.stock !== 'en_mano') return 'el item no está «en mano»';
  return null;
}

// ───────────────────────── ritmo y límites ─────────────────────────

/** Espera aleatoria entre mensajes, en segundos enteros. `random` en [0, 1). */
export function randomDelaySeconds(minS: number, maxS: number, random: number = Math.random()): number {
  const low = Math.min(minS, maxS);
  const high = Math.max(minS, maxS);
  return Math.round(low + Math.min(Math.max(random, 0), 1) * (high - low));
}

/** Mensajes que aún se pueden enviar hoy. */
export const remainingToday = (maxPerDay: number, sentToday: number): number => Math.max(0, maxPerDay - sentToday);

/** Clave del día local (`AAAA-MM-DD`) para el contador diario. */
export function dayKey(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ───────────────────────── tipos de la API ─────────────────────────

export type FavoriterState = 'pendiente' | 'ofertado' | 'con_conversacion';

export interface OfferRecipient {
  favoriter_id: number;
  username: string | null;
  state: FavoriterState;
  /** Mensaje exacto que recibiría. Solo para los pendientes de anuncios elegibles. */
  message: string | null;
}

/** Un anuncio en el plan de ofertas. */
export interface OfferPlanRow {
  listing_id: number;
  vinted_id: string;
  title: string;
  price: number | null;
  new_price: number | null;
  /** `null` si se le pueden hacer ofertas; si no, el motivo. */
  blocker: string | null;
  recipients: OfferRecipient[];
  pending: number;
}

export interface OfferPlan {
  rows: OfferPlanRow[];
  dry_run: boolean;
  discount_pct: number;
  max_per_day: number;
  sent_today: number;
  remaining_today: number;
  /** Comando en curso (solo puede haber uno), o `null`. */
  active_command_id: number | null;
}

export type CommandType = 'price_drop' | 'send_offers';

export interface CommandLogLine {
  at: string;
  text: string;
  ok: boolean;
}

export interface CommandView {
  id: number;
  type: CommandType;
  status: CommandStatus;
  dry_run: boolean;
  total: number;
  done: number;
  /** 0–1. */
  progress: number;
  error: string | null;
  created_at: string;
  log: CommandLogLine[];
}

/** Paso que el server entrega a la extensión. */
export type CommandStep =
  | { action: 'wait'; seconds: number; done: number; total: number }
  | {
      action: 'do';
      index: number;
      done: number;
      total: number;
      dry_run: boolean;
      kind: 'message' | 'price';
      /** Texto para el overlay: a quién o qué anuncio. */
      label: string;
      listing_vinted_id: string;
      user_id: string | null;
      message: string | null;
      new_price: number | null;
    }
  | { action: 'finished'; status: CommandStatus; error: string | null };

/** Resultado del paso anterior, enviado por la extensión. */
export interface StepResult {
  index: number;
  ok: boolean;
  /** `true` = Vinted obliga a parar (captcha, 403, 429, sesión cerrada, DOM inesperado). */
  stop?: boolean;
  error?: string;
}
