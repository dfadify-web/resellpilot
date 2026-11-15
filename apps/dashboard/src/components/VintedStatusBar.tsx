import type { VintedStatus } from '@resellpilot/shared';
import { PauseCircle, RefreshCw } from 'lucide-react';
import { Card, Illustration } from './kit';

/** Estado de la conexión con la extensión: última sync, pausa o primeros pasos. */
export function VintedStatusBar({ status }: { status: VintedStatus | null }) {
  if (!status) return null;

  if (status.paused) {
    return (
      <div role="alert" className="flex gap-3 rounded-2xl border border-pink/30 bg-pink-soft px-4 py-3 text-sm">
        <PauseCircle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-pink" />
        <div>
          <p className="font-semibold text-pink">Lectura de Vinted en pausa</p>
          <p className="mt-0.5 text-ink">
            {status.notice ?? 'La extensión se ha detenido.'} Revisa vinted.es y pulsa «Reanudar» en el panel de la
            extensión. No se reintenta sola.
          </p>
        </div>
      </div>
    );
  }

  if (!status.last_sync_at) {
    return (
      <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <Illustration name="extension" size={84} className="-rotate-2" />
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold">Conecta tu cuenta de Vinted</p>
          <ol className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted">
            {[
              <>
                En <code>chrome://extensions</code>, activa el modo de desarrollador y pulsa «Cargar descomprimida» con
                la carpeta <code>apps/extension/dist</code>.
              </>,
              <>Abre vinted.es con tu sesión iniciada.</>,
              <>Pulsa el icono de ResellPilot y, en el panel lateral, «Activar lectura».</>,
            ].map((step, index) => (
              <li key={index} className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </Card>
    );
  }

  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(status.last_sync_at)) / 60_000));
  const ago = minutes < 1 ? 'hace un momento' : minutes < 60 ? `hace ${minutes} min` : `hace ${Math.round(minutes / 60)} h`;
  const late = minutes > 45;
  return (
    <p
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
        late ? 'border-pink/30 bg-pink-soft text-pink' : 'border-line bg-surface text-muted'
      }`}
      title={new Date(status.last_sync_at).toLocaleString('es-ES')}
    >
      <RefreshCw size={13} aria-hidden="true" />
      Sincronizado {ago}
      {late && <span className="font-semibold">· abre vinted.es para que siga</span>}
    </p>
  );
}
