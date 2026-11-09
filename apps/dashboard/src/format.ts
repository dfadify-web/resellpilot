const eurFormat = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const pctFormat = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 });
const numFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

export const eur = (value: number | null): string => (value === null ? '—' : eurFormat.format(value));

/** Euros con signo explícito, para beneficios. */
export const signedEur = (value: number | null): string => {
  if (value === null) return '—';
  return value > 0 ? `+${eurFormat.format(value)}` : eurFormat.format(value);
};

export const pct = (ratio: number | null): string => (ratio === null ? '—' : pctFormat.format(ratio));

export const num = (value: number | null): string => (value === null ? '—' : numFormat.format(value));

export const shortDate = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

/** `2026-11` → `noviembre 2026`. */
export const monthName = (key: string): string => {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
};
