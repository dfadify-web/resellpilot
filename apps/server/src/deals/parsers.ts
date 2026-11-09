import { parseDecimal } from '@resellpilot/shared';
import { isPublicHttpUrl } from '../http';

// ───────────────────────── utilidades HTML ─────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]*>/g, ''));

/** Quita emojis, viñetas y signos sueltos de los extremos de un título. */
function cleanTitle(text: string): string | null {
  const cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})\]"'%]+$/gu, '')
    .trim();
  return cleaned === '' ? null : cleaned.slice(0, 300);
}

// ───────────────────────── enlaces de las fuentes ─────────────────────────

/** Candidato encontrado en una fuente, con las pistas que dé el propio mensaje. */
export interface LinkCandidate {
  link: string;
  title: string | null;
  image: string | null;
}

function toAbsolute(match: string, baseUrl: string): string | null {
  try {
    const href = new URL(decodeEntities(match), baseUrl).href;
    return isPublicHttpUrl(href) ? href : null;
  } catch {
    return null;
  }
}

/** Todos los enlaces que casan con `link_regex`, absolutos y sin repetir. */
export function extractLinks(html: string, linkRegex: string, baseUrl: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(new RegExp(linkRegex, 'g'))) {
    const href = toAbsolute(match[0], baseUrl);
    if (href) links.add(href);
  }
  return [...links];
}

/**
 * Vista pública de un canal de Telegram (`https://t.me/s/<canal>`).
 * Cada mensaje aporta sus enlaces y, como pista, su primera línea de texto y su foto.
 */
export function parseTelegramChannel(html: string, linkRegex: string, baseUrl: string): LinkCandidate[] {
  const candidates = new Map<string, LinkCandidate>();

  for (const message of html.split('tgme_widget_message_wrap').slice(1)) {
    const texts = [...message.matchAll(/class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/g)];
    const textHtml = texts.at(-1)?.[1] ?? '';

    const firstLine = stripTags(textHtml.replace(/<br\s*\/?>/gi, '\n'))
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '' && !/^\P{L}*https?:\/\//u.test(line));
    const title = firstLine ? cleanTitle(firstLine.replace(/https?:\/\/\S+/g, '')) : null;

    const photo = /tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/.exec(message);
    const image = photo?.[1] ? toAbsolute(photo[1], baseUrl) : null;

    for (const link of extractLinks(textHtml, linkRegex, baseUrl)) {
      if (!candidates.has(link)) candidates.set(link, { link, title, image });
    }
  }
  return [...candidates.values()];
}

// ───────────────────────── página de producto ─────────────────────────

export interface ParsedProduct {
  /** Título de datos estructurados (JSON-LD, Open Graph o JSON embebido). */
  title: string | null;
  /** `<title>` de la página: último recurso, suele ser genérico. */
  fallbackTitle: string | null;
  price: number | null;
  image: string | null;
  brand: string | null;
}

const EMPTY: ParsedProduct = { title: null, fallbackTitle: null, price: null, image: null, brand: null };

function toPrice(value: unknown): number | null {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? parseDecimal(value.replace(/[^\d.,-]/g, '')) : null;
  return number !== null && Number.isFinite(number) && number > 0 && number < 100_000
    ? Math.round(number * 100) / 100
    : null;
}

function toImage(value: unknown): string | null {
  if (typeof value === 'string') {
    const url = value.startsWith('//') ? `https:${value}` : value;
    return isPublicHttpUrl(url) ? url : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const image = toImage(entry);
      if (image) return image;
    }
    return null;
  }
  if (value && typeof value === 'object') return toImage((value as { url?: unknown }).url);
  return null;
}

const toText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? cleanTitle(decodeEntities(value)) : null;

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Atributos de una etiqueta HTML. */
function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[(match[1] as string).toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return result;
}

function metaTags(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? '').toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
  }
  return meta;
}

/** JSON-LD: busca un nodo `Product` (también dentro de arrays y `@graph`). */
function fromJsonLd(html: string): Partial<ParsedProduct> {
  const isProduct = (node: Record<string, unknown>): boolean => {
    const type = node['@type'];
    return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  };
  const find = (node: unknown, depth = 0): Record<string, unknown> | null => {
    if (!node || typeof node !== 'object' || depth > 6) return null;
    if (Array.isArray(node)) {
      for (const entry of node) {
        const found = find(entry, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const object = node as Record<string, unknown>;
    return isProduct(object) ? object : find(object['@graph'], depth + 1);
  };

  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const product = find(tryJson(match[1] ?? ''));
    if (!product) continue;

    const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    const offer = (offers && typeof offers === 'object' ? offers : {}) as Record<string, unknown>;
    const brand = product.brand;
    return {
      title: toText(product.name),
      price: toPrice(offer.price) ?? toPrice(offer.lowPrice),
      image: toImage(product.image),
      brand: toText(typeof brand === 'object' && brand ? (brand as { name?: unknown }).name : brand),
    };
  }
  return {};
}

const TITLE_KEYS = ['title', 'name', 'goodsName', 'goods_name', 'productName', 'product_name', 'subject'];
const PRICE_KEYS = [
  'price', 'salePrice', 'sale_price', 'currentPrice', 'current_price', 'minPrice', 'min_price',
  'discountPrice', 'discount_price', 'finalPrice', 'final_price',
];
const IMAGE_KEYS = ['image', 'images', 'mainImage', 'main_image', 'cover', 'pic', 'picUrl', 'imgUrl', 'thumbnail'];

/** Extrae el objeto `{…}` que empieza en `start`, respetando cadenas y anidamiento. */
function balancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** JSON embebido (`__NEXT_DATA__`, `application/json`, `window.X = {…}`): primer objeto con título y precio. */
function fromEmbeddedJson(html: string): Partial<ParsedProduct> {
  const blobs: unknown[] = [];
  for (const match of html.matchAll(/<script[^>]*(?:id=["']__NEXT_DATA__["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    blobs.push(tryJson(match[1] ?? ''));
  }
  for (const match of html.matchAll(/window\.[A-Za-z_$][\w$]*\s*=\s*\{/g)) {
    const object = balancedObject(html, match.index + match[0].length - 1);
    if (object) blobs.push(tryJson(object));
  }

  const pick = (object: Record<string, unknown>, keys: string[], convert: (v: unknown) => unknown) => {
    for (const key of keys) {
      const value = convert(object[key]);
      if (value !== null) return value;
    }
    return null;
  };

  for (const blob of blobs) {
    const queue: unknown[] = [blob];
    let visited = 0;
    while (queue.length > 0 && visited++ < 5000) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) {
        queue.push(...node.slice(0, 50));
        continue;
      }
      const object = node as Record<string, unknown>;
      const title = pick(object, TITLE_KEYS, toText) as string | null;
      const price = pick(object, PRICE_KEYS, toPrice) as number | null;
      if (title && price !== null) {
        return { title, price, image: pick(object, IMAGE_KEYS, toImage) as string | null };
      }
      queue.push(...Object.values(object));
    }
  }
  return {};
}

/**
 * Lee título, precio e imagen de una página de producto, por este orden:
 * JSON-LD → meta tags (Open Graph) → JSON embebido. Lo que no encuentra queda en `null`.
 */
export function parseProductPage(html: string): ParsedProduct {
  if (html.trim() === '') return EMPTY;

  const jsonLd = fromJsonLd(html);
  const meta = metaTags(html);
  const embedded = fromEmbeddedJson(html);

  const metaTitle = toText(meta.get('og:title') ?? meta.get('twitter:title'));
  const metaPrice =
    toPrice(meta.get('product:price:amount')) ?? toPrice(meta.get('og:price:amount')) ?? toPrice(meta.get('price'));
  const metaImage = toImage(meta.get('og:image') ?? meta.get('og:image:secure_url') ?? meta.get('twitter:image'));
  const pageTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];

  return {
    title: jsonLd.title ?? metaTitle ?? embedded.title ?? null,
    fallbackTitle: pageTitle ? toText(stripTags(pageTitle)) : null,
    price: jsonLd.price ?? metaPrice ?? embedded.price ?? null,
    image: jsonLd.image ?? metaImage ?? embedded.image ?? null,
    brand: jsonLd.brand ?? toText(meta.get('product:brand')) ?? null,
  };
}
