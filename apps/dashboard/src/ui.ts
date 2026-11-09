import { useEffect } from 'react';

/** Clases compartidas. Un solo acento, sin degradados. */
export const ui = {
  input:
    'w-full border border-line bg-ink px-3 py-2 text-sm text-paper placeholder:text-muted focus:border-accent focus:outline-none',
  label: 'mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted',
  primary:
    'inline-flex items-center justify-center bg-accent px-4 py-2 font-display text-lg font-bold uppercase leading-none tracking-wide text-ink disabled:opacity-50',
  secondary:
    'inline-flex cursor-pointer items-center justify-center border border-line px-4 py-2 font-display text-lg font-semibold uppercase leading-none tracking-wide text-paper hover:border-paper disabled:opacity-50',
  link: 'text-[11px] uppercase tracking-[0.14em] text-muted hover:text-paper disabled:opacity-50',
  th: 'px-3 py-2 text-left text-[11px] font-normal uppercase tracking-[0.14em] text-muted',
  td: 'px-3 py-2 align-middle',
  eyebrow: 'text-[11px] uppercase tracking-[0.18em] text-muted',
  h1: 'mt-2 font-display text-6xl font-bold uppercase leading-[0.9] tracking-tight md:text-8xl',
};

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ResellPilot`;
  }, [title]);
}
