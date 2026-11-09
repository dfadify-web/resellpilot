import type { NavItem } from '@resellpilot/shared';
import { useEffect } from 'react';

interface Props {
  item: NavItem;
  index: number;
}

/** Página vacía de la Fase 0: título, regla y aviso de cuándo recibe contenido. */
export function EmptyPage({ item, index }: Props) {
  useEffect(() => {
    document.title = `${item.label} · ResellPilot`;
  }, [item.label]);

  return (
    <section className="px-6 py-8 md:px-12 md:py-12">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
        {String(index).padStart(2, '0')} / 07
      </p>
      <h1 className="mt-2 font-display text-6xl font-bold uppercase leading-[0.9] tracking-tight md:text-8xl">
        {item.label}
      </h1>
      <div className="mt-8 border-t border-line pt-6">
        <p className="font-display text-2xl font-semibold uppercase text-muted">Sin datos todavía</p>
        <p className="mt-2 max-w-prose text-sm text-muted">
          {item.phase === null
            ? 'Esta sección se irá activando fase a fase.'
            : `Esta sección se activa en la Fase ${item.phase}.`}
        </p>
      </div>
    </section>
  );
}
