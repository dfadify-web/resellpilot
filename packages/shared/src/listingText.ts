/**
 * Generador de título, descripción y hashtags para un anuncio (Fase 6).
 * Plantilla fija a partir de los datos del item: sin LLM y sin red.
 */
import { normalizeForMatch } from './brands';
import { findForbiddenContent } from './offers';
import { keywordsOf } from './trends';

/** Estados de uso, con los nombres que usa Vinted. */
export const ITEM_CONDITIONS = ['nuevo_con_etiquetas', 'nuevo_sin_etiquetas', 'muy_bueno', 'bueno', 'satisfactorio'] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export const ITEM_CONDITION_LABELS: Record<ItemCondition, string> = {
  nuevo_con_etiquetas: 'Nuevo con etiquetas',
  nuevo_sin_etiquetas: 'Nuevo sin etiquetas',
  muy_bueno: 'Muy bueno',
  bueno: 'Bueno',
  satisfactorio: 'Satisfactorio',
};

const CONDITION_LINES: Record<ItemCondition, string> = {
  nuevo_con_etiquetas: 'Nuevo, con etiquetas. Sin estrenar.',
  nuevo_sin_etiquetas: 'Nuevo, sin etiquetas. Sin estrenar.',
  muy_bueno: 'Muy buen estado: usado muy poco y sin defectos.',
  bueno: 'Buen estado: usado, con signos normales de uso.',
  satisfactorio: 'Estado satisfactorio: tiene signos de uso visibles (mira las fotos).',
};

/** Límite propio para que el título se lea entero en la tarjeta del anuncio. */
export const MAX_LISTING_TITLE = 80;
export const MAX_HASHTAGS = 8;

export interface ListingTextInput {
  name: string;
  brand?: string | null;
  condition: ItemCondition;
  size?: string;
  color?: string;
  /** Detalles libres (medidas, material, defectos…). */
  notes?: string;
  /** Plazo de envío en horas. Solo se promete si el artículo está en mano (Regla 8). */
  shipHours: number;
  inHand: boolean;
}

export interface ListingText {
  title: string;
  description: string;
  hashtags: string[];
  /** Avisos para el usuario (p. ej. un enlace o un teléfono en los detalles). */
  warnings: string[];
}

const clean = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
const capitalize = (text: string): string => (text === '' ? text : text[0]!.toUpperCase() + text.slice(1));
const sentence = (text: string): string => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** Recorta por palabras enteras sin pasar de `max` caracteres. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.5 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s·,.-]+$/, '');
}

const contains = (text: string, part: string): boolean =>
  ` ${normalizeForMatch(text)} `.includes(` ${normalizeForMatch(part)} `);

const toTag = (text: string): string => normalizeForMatch(text).replace(/\s+/g, '');

export function generateListingText(input: ListingTextInput): ListingText {
  const name = clean(input.name);
  const brand = clean(input.brand);
  const size = clean(input.size);
  const color = clean(input.color);
  const notes = (input.notes ?? '')
    .split('\n')
    .map(clean)
    .filter((line) => line !== '');
  const isNew = input.condition === 'nuevo_con_etiquetas' || input.condition === 'nuevo_sin_etiquetas';

  // Título: nombre + marca (si no la lleva ya) + color + talla + «Nuevo».
  const titleParts = [capitalize(name)];
  if (brand !== '' && !contains(name, brand)) titleParts.push(brand);
  if (color !== '' && !contains(name, color)) titleParts.push(color.toLowerCase());
  let title = titleParts.join(' ');
  if (size !== '') title += ` · Talla ${size.toUpperCase()}`;
  if (isNew && !contains(title, 'nuevo') && !contains(title, 'nueva')) title += ' · Nuevo';
  title = clip(title, MAX_LISTING_TITLE);

  // Hashtags: palabras clave del nombre, marca, color y estado.
  const tags: string[] = [];
  const addTag = (text: string) => {
    const tag = toTag(text);
    if (tag.length >= 3 && !tags.includes(tag) && tags.length < MAX_HASHTAGS) tags.push(tag);
  };
  const words = keywordsOf(name);
  if (words.length >= 2) addTag(words.slice(0, 2).join(' '));
  for (const word of words) addTag(word);
  if (brand !== '') addTag(brand);
  if (color !== '') addTag(color);
  if (isNew) addTag('nuevo');
  const hashtags = tags.map((tag) => `#${tag}`);

  const details = [size === '' ? '' : `Talla: ${size.toUpperCase()}`, color === '' ? '' : `Color: ${color.toLowerCase()}`]
    .filter((line) => line !== '')
    .join(' · ');

  const lines = [
    sentence(capitalize([name, brand !== '' && !contains(name, brand) ? brand : ''].filter((part) => part !== '').join(' '))),
    CONDITION_LINES[input.condition],
    details,
    ...notes.map((line) => sentence(capitalize(line))),
    '',
    input.inHand
      ? `Lo tengo en mano: envío en ${input.shipHours} h desde la compra, bien protegido.`
      : 'Se envía bien protegido.',
    'Cualquier duda, pregunta sin compromiso.',
    '',
    hashtags.join(' '),
  ];
  const description = lines
    .filter((line, index) => line !== '' || (index > 0 && lines[index - 1] !== ''))
    .join('\n')
    .trim();

  const warnings: string[] = [];
  const forbidden = findForbiddenContent([name, brand, ...notes].join(' '));
  if (forbidden) warnings.push(`El texto contiene ${forbidden}: Vinted no lo permite en los anuncios.`);
  if (name.length < 3) warnings.push('El nombre del item es muy corto: el título quedará pobre.');

  return { title, description, hashtags, warnings };
}
