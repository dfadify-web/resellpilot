import type { NavItem } from '@resellpilot/shared';
import { ui, usePageTitle } from '../ui';

interface Props {
  item: NavItem;
  index: number;
}

/** Página aún sin contenido: título, regla y aviso de en qué fase se activa. */
export function EmptyPage({ item, index }: Props) {
  usePageTitle(item.label);

  return (
    <section className="px-6 py-8 md:px-12 md:py-12">
      <p className={ui.eyebrow}>{String(index).padStart(2, '0')} / 07</p>
      <h1 className={ui.h1}>{item.label}</h1>
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
