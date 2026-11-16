import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'ResellPilot',
  version: '0.9.0',
  description: 'Lee tus anuncios, notificaciones y tendencias de vinted.es y los envía a tu ResellPilot local.',
  // Clave pública fija: hace que el ID de la extensión sea siempre kjgfhjhbgcpdodeknaofoemgeccffgok,
  // que es el único origen al que el server permite enviar datos (ver DEFAULT_EXTENSION_ID).
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzRbvHmC0E1SsS85bxz8VptAmL4EgzpcXx5Nt8yAvSOh5ps0p+Jn9JE2FsgGK0n44tMyjOXbpomiBnwKQLqQ7I6p6pxvW5V07rPY64Lforj3EElSXQLTP0kybSU3j9g1fAucxMtN+ItfZI7FMqjXrYa5DZeIOy1m81QS6MfwZeLelB1Rz9vEgzdwfZAmnn+7AL5Y4ZEfrr3Urp1auPi12AZKQBqCBlxCuX42imWiyaB22Sn21TL03aXPytxooG2dABj39I+N23qL2veMdBsyozDUVEge+jcIcN1lY52mp8XsAGPxDNZEPmTFWwMpiY++vkrGzeEy0JNlLdndHgnmBfwIDAQAB',
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: {
    default_title: 'Abrir ResellPilot',
    default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png' },
  },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  // Sin `cookies`, `webRequest` ni `scripting`: la extensión no puede leer cookies ni tokens.
  permissions: ['sidePanel', 'alarms', 'storage'],
  host_permissions: ['https://www.vinted.es/*', 'http://127.0.0.1/*'],
  content_scripts: [{ matches: ['https://www.vinted.es/*'], js: ['src/content.ts'], run_at: 'document_idle' }],
  background: { service_worker: 'src/background.ts', type: 'module' },
});
