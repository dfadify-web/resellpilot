import { existsSync, readFileSync } from 'node:fs';
import type { SourceType } from '@resellpilot/shared';
import { z } from 'zod';

const isRegex = (value: string): boolean => {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
};

const sourceSchema = z.object({
  /** Nombre visible. Si falta se deduce de la URL. */
  name: z.string().trim().min(1).max(80).optional(),
  type: z.enum(['telegram_public', 'telegram_private', 'web']),
  url: z.string().url(),
  link_regex: z.string().min(1).refine(isRegex, 'link_regex no es una expresión regular válida'),
});

export interface Source {
  name: string;
  type: SourceType;
  url: string;
  link_regex: string;
}

function defaultName(type: SourceType, rawUrl: string): string {
  const url = new URL(rawUrl);
  const path = url.pathname.replace(/\/+$/, '');
  if (type !== 'web') return `@${path.split('/').pop() ?? url.hostname}`;
  return `${url.hostname.replace(/^www\./, '')}${path}`;
}

/** Lee `sources.json`. Si no existe no hay fuentes; si está mal escrito, lanza un error claro. */
export function loadSources(path: string): Source[] {
  if (!existsSync(path)) return [];
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('sources.json no es un JSON válido.');
  }
  const result = z.array(sourceSchema).safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`sources.json: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'formato no válido'}`);
  }
  return result.data.map((source) => ({
    ...source,
    name: source.name ?? defaultName(source.type, source.url),
  }));
}

/** Lee `brand-blocklist.json`: un array de marcas, o `{ "brands": [...] }`. */
export function loadBlocklist(path: string): string[] {
  if (!existsSync(path)) return [];
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('brand-blocklist.json no es un JSON válido.');
  }
  const list = Array.isArray(json) ? json : (json as { brands?: unknown } | null)?.brands;
  if (!Array.isArray(list)) throw new Error('brand-blocklist.json debe ser una lista de marcas.');
  return list.filter((brand): brand is string => typeof brand === 'string' && brand.trim() !== '');
}
