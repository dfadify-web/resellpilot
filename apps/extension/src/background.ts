// Abre el panel lateral al pulsar el icono de la extensión.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
  console.error('[ResellPilot] No se pudo configurar el panel lateral', error);
});
