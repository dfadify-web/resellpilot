import { defineManifest } from '@crxjs/vite-plugin';

// Esqueleto de la Fase 0. El content script de vinted.es y los permisos de host
// llegan en la Fase 3; hasta entonces la extensión no toca Vinted.
export default defineManifest({
  manifest_version: 3,
  name: 'ResellPilot',
  version: '0.0.1',
  description: 'Panel lateral de ResellPilot para vinted.es. Todo local.',
  action: { default_title: 'Abrir ResellPilot' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  permissions: ['sidePanel'],
  background: { service_worker: 'src/background.ts', type: 'module' },
});
