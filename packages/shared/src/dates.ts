const pad = (n: number): string => String(n).padStart(2, '0');

/** Fecha de calendario → ISO, a mediodía local (así no cambia de día por la zona horaria). */
function calendarDateToIso(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return valid ? date.toISOString() : null;
}

/**
 * Convierte una fecha escrita por el usuario a ISO 8601 UTC.
 * Admite `AAAA-MM-DD`, `DD/MM/AAAA` y fecha-hora ISO. Devuelve `null` si no es válida.
 */
export function parseDateInput(input: string): string | null {
  const text = input.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return calendarDateToIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const es = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (es) return calendarDateToIso(Number(es[3]), Number(es[2]), Number(es[1]));

  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) {
    const ms = Date.parse(text.replace(' ', 'T'));
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }

  return null;
}

/** ISO → `AAAA-MM-DD` en hora local, para `<input type="date">`. */
export function toDateInputValue(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
