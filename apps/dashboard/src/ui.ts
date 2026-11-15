import { useEffect } from 'react';

const button =
  'inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45';

/** Clases compartidas del sistema «Mercadillo riso». */
export const ui = {
  input:
    'h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint transition focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-50',
  textarea:
    'w-full rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-faint transition focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15',
  select:
    'h-10 w-full cursor-pointer rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink transition focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-50',
  /** Selector compacto dentro de una tabla. */
  selectSm:
    'h-8 cursor-pointer rounded-lg border border-line bg-surface px-2 text-xs text-ink transition hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-50',
  label: 'mb-1.5 block text-xs font-medium text-muted',
  help: 'mt-1.5 text-xs leading-relaxed text-muted',
  primary: `${button} bg-accent text-on-accent shadow-[0_1px_0_rgb(0_0_0/0.08)] hover:bg-accent-hover`,
  secondary: `${button} border border-line-strong bg-surface text-ink hover:border-ink/40 hover:bg-sunken`,
  ghost: `${button} h-9 px-3 text-muted hover:bg-sunken hover:text-ink`,
  /** Acción de texto en tablas y avisos. */
  link: 'cursor-pointer text-sm font-semibold text-accent underline-offset-4 transition hover:underline disabled:pointer-events-none disabled:opacity-45',
  linkMuted:
    'cursor-pointer text-sm font-medium text-muted underline-offset-4 transition hover:text-ink hover:underline disabled:pointer-events-none disabled:opacity-45',
  linkDanger:
    'cursor-pointer text-sm font-semibold text-pink underline-offset-4 transition hover:underline disabled:pointer-events-none disabled:opacity-45',
  card: 'rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]',
  th: 'whitespace-nowrap bg-sunken px-3 py-3 text-left text-xs font-medium text-muted first:pl-5 last:pr-5',
  td: 'px-3 py-3 align-middle first:pl-5 last:pr-5',
  tr: 'border-t border-line transition-colors hover:bg-sunken/60',
  eyebrow: 'text-xs font-semibold uppercase tracking-[0.14em] text-muted',
  h1: 'font-display text-4xl font-semibold leading-[1.02] tracking-[-0.03em] text-ink md:text-[56px]',
  h2: 'font-display text-xl font-semibold tracking-[-0.01em] text-ink',
  num: 'font-display font-semibold tracking-[-0.02em]',
};

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ResellPilot`;
  }, [title]);
}
