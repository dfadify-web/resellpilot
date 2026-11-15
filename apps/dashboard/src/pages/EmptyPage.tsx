import type { NavItem } from '@resellpilot/shared';
import { EmptyState, Page } from '../components/kit';
import { ui, usePageTitle } from '../ui';

interface Props {
  item: NavItem;
  index: number;
}

/** Página aún sin contenido. */
export function EmptyPage({ item }: Props) {
  usePageTitle(item.label);

  return (
    <Page>
      <h1 className={ui.h1}>{item.label}</h1>
      <div className={ui.card}>
        <EmptyState illustration="vacio-anuncios" title="Sin datos todavía">
          {item.phase === null ? 'Esta sección se irá activando poco a poco.' : `Esta sección se activa en la Fase ${item.phase}.`}
        </EmptyState>
      </div>
    </Page>
  );
}
