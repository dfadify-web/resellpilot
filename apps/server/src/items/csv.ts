import {
  detectDelimiter,
  formatDecimal,
  parseCsv,
  parseDecimal,
  stringifyCsv,
  type ItemWithCalc,
  type ValidationIssue,
} from '@resellpilot/shared';
import { ValidationError, zodIssues } from '../errors';
import { buildItemData, createItemSchema, type ItemData } from './schema';

/** Columnas del CSV. Las tres últimas son calculadas: se exportan y se ignoran al importar. */
export const CSV_COLUMNS = [
  'id',
  'name',
  'brand',
  'source_url',
  'cost',
  'shipping_cost',
  'extra_costs',
  'stock',
  'sold_price',
  'sold_at',
  'created_at',
  'total_cost',
  'profit',
  'roi',
] as const;

const NUMERIC_COLUMNS = ['cost', 'shipping_cost', 'extra_costs', 'sold_price'] as const;
export const MAX_IMPORT_ROWS = 5000;

/** CSV para Excel en español: separador `;`, coma decimal y BOM UTF-8. */
export function itemsToCsv(items: readonly ItemWithCalc[]): string {
  const rows = items.map((item) => [
    item.id,
    item.name,
    item.brand,
    item.source_url,
    formatDecimal(item.cost),
    formatDecimal(item.shipping_cost),
    formatDecimal(item.extra_costs),
    item.stock,
    formatDecimal(item.sold_price),
    item.sold_at,
    item.created_at,
    formatDecimal(item.total_cost),
    formatDecimal(item.profit),
    formatDecimal(item.roi, 4),
  ]);
  return '\uFEFF' + stringifyCsv([CSV_COLUMNS, ...rows], ';');
}

export interface CsvImport {
  rows: ItemData[];
  issues: ValidationIssue[];
}

/**
 * Lee un CSV de items. Acepta `,` o `;` como separador y punto o coma decimal.
 * Solo es obligatoria la columna `name`; `id` y las columnas calculadas se ignoran.
 */
export function parseItemsCsv(text: string, nowIso: string): CsvImport {
  const fail = (message: string): CsvImport => ({ rows: [], issues: [{ path: 'csv', message }] });

  let table: string[][];
  try {
    table = parseCsv(text, detectDelimiter(text));
  } catch (error) {
    return fail((error as Error).message);
  }

  const [header, ...lines] = table;
  if (!header) return fail('El archivo está vacío.');
  const columns = header.map((name) => name.trim().toLowerCase());
  if (!columns.includes('name')) return fail('Falta la columna "name" en la cabecera.');
  if (lines.length === 0) return fail('El archivo no tiene filas de datos.');
  if (lines.length > MAX_IMPORT_ROWS) return fail(`Máximo ${MAX_IMPORT_ROWS} filas por importación.`);

  const rows: ItemData[] = [];
  const issues: ValidationIssue[] = [];

  lines.forEach((cells, index) => {
    const prefix = `fila ${index + 2} · `;
    const cell = (column: string): string => {
      const position = columns.indexOf(column);
      return position === -1 ? '' : (cells[position] ?? '').trim();
    };

    const raw: Record<string, unknown> = {
      name: cell('name'),
      brand: cell('brand'),
      source_url: cell('source_url'),
      stock: cell('stock').toLowerCase().replace(/\s+/g, '_') || undefined,
      sold_at: cell('sold_at'),
      created_at: cell('created_at'),
    };

    let numbersOk = true;
    for (const column of NUMERIC_COLUMNS) {
      const value = cell(column);
      if (value === '') continue;
      const parsed = parseDecimal(value);
      if (parsed === null) {
        issues.push({ path: prefix + column, message: `número no válido ("${value}")` });
        numbersOk = false;
      } else {
        raw[column] = parsed;
      }
    }

    const result = createItemSchema.safeParse(raw);
    if (!result.success) {
      issues.push(...zodIssues(result.error, prefix));
      return;
    }
    if (!numbersOk) return;

    try {
      rows.push(buildItemData(result.data, undefined, nowIso));
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      issues.push(...error.issues.map((issue) => ({ ...issue, path: prefix + issue.path })));
    }
  });

  return { rows, issues };
}
