export type CsvDelimiter = ',' | ';';
export type CsvCell = string | number | null | undefined;

/** Deduce el separador mirando la cabecera (fuera de comillas). Excel en español usa `;`. */
export function detectDelimiter(text: string): CsvDelimiter {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const char of text.replace(/^\uFEFF/, '')) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char === ',') commas += 1;
    else if (!quoted && char === ';') semicolons += 1;
  }
  return semicolons > commas ? ';' : ',';
}

/**
 * Parser CSV (RFC 4180): comillas, comillas dobladas, saltos de línea dentro de comillas,
 * CRLF o LF y BOM inicial. Las líneas vacías se ignoran.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter = ','): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStart = true;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (char === delimiter) {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      if (input[i + 1] === '\n') i++;
      endRow();
    } else {
      field += char;
      fieldStart = false;
    }
  }

  if (quoted) throw new Error('CSV mal formado: hay unas comillas sin cerrar.');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function escapeCell(cell: CsvCell, delimiter: CsvDelimiter): string {
  if (cell === null || cell === undefined) return '';
  const text = String(cell);
  const needsQuotes =
    text.includes(delimiter) || /["\r\n]/.test(text) || text !== text.trim();
  return needsQuotes ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Serializa filas a CSV con CRLF. */
export function stringifyCsv(rows: readonly (readonly CsvCell[])[], delimiter: CsvDelimiter = ','): string {
  return rows.map((row) => row.map((cell) => escapeCell(cell, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}

/** Lee un decimal con punto o coma ("12.5", "12,50", "12,50 €"). `null` si no es un número. */
export function parseDecimal(raw: string): number | null {
  const text = raw.replace(/[\s€]/g, '');
  if (!/^-?\d+([.,]\d+)?$/.test(text)) return null;
  return Number(text.replace(',', '.'));
}

/** Escribe un decimal con coma, como espera Excel en español. */
export function formatDecimal(value: number | null, decimals = 2): string {
  return value === null ? '' : value.toFixed(decimals).replace('.', ',');
}
