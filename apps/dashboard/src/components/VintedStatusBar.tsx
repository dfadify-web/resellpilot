import type { VintedStatus } from '@resellpilot/shared';

/** Estado de la conexión con la extensión: última sync, pausa o primeros pasos. */
export function VintedStatusBar({ status }: { status: VintedStatus | null }) {
  if (!status) return null;

  if (status.paused) {
    return (
      <div role="alert" className="border border-accent px-3 py-2 text-sm">
        <p className="font-semibold text-accent">Lectura de Vinted en pausa</p>
        <p className="mt-1">
          {status.notice ?? 'La extensión se ha detenido.'} Revisa vinted.es y pulsa «Reanudar» en el panel de la
          extensión. No se reintenta sola.
        </p>
      </div>
    );
  }

  if (!status.last_sync_at) {
    return (
      <div className="border border-line px-3 py-3 text-sm">
        <p className="font-semibold">Aún no se ha sincronizado tu cuenta de Vinted</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>
            Ejecuta <code>pnpm --filter @resellpilot/extension build</code> y carga la carpeta{' '}
            <code>apps/extension/dist</code> en <code>chrome://extensions</code> («Cargar descomprimida», con el modo
            de desarrollador activado).
          </li>
          <li>Abre vinted.es con tu sesión iniciada.</li>
          <li>Pulsa el icono de ResellPilot y, en el panel lateral, «Activar lectura».</li>
        </ol>
      </div>
    );
  }

  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(status.last_sync_at)) / 60_000));
  const ago = minutes < 1 ? 'hace un momento' : minutes < 60 ? `hace ${minutes} min` : `hace ${Math.round(minutes / 60)} h`;
  return (
    <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
      Última sync {ago} · {new Date(status.last_sync_at).toLocaleString('es-ES')}
      {minutes > 45 && <span className="ml-2 text-paper">· Abre vinted.es para que siga sincronizando</span>}
    </p>
  );
}
