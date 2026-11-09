export interface NavItem {
  path: string;
  label: string;
  /** Fase del PRD en la que la sección recibe contenido. */
  phase: number | null;
}

/** Navegación del dashboard, en el orden del PRD. */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', label: 'Resumen', phase: 1 },
  { path: '/anuncios', label: 'Anuncios', phase: 3 },
  { path: '/notificaciones', label: 'Notificaciones', phase: 3 },
  { path: '/oportunidades', label: 'Oportunidades', phase: 2 },
  { path: '/tendencias', label: 'Tendencias', phase: 4 },
  { path: '/inventario', label: 'Inventario', phase: 1 },
  { path: '/ajustes', label: 'Ajustes', phase: null },
];
