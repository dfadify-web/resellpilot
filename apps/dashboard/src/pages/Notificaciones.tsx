import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
  type NotificationType,
  type NotificationView,
  type VintedStatus,
} from '@resellpilot/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, describeError } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { VintedStatusBar } from '../components/VintedStatusBar';
import { ui, usePageTitle } from '../ui';

type Filter = NotificationType | 'todas' | 'sin_leer';

const REFRESH_MS = 30_000;

const when = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function Notificaciones() {
  usePageTitle('Notificaciones');

  const [rows, setRows] = useState<NotificationView[] | null>(null);
  const [status, setStatus] = useState<VintedStatus | null>(null);
  const [filter, setFilter] = useState<Filter>('todas');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const reload = useCallback(async () => {
    try {
      const [notifications, vinted] = await Promise.all([api.listNotifications(), api.vintedStatus()]);
      setRows(notifications);
      setStatus(vinted);
    } catch (error) {
      setProblem(describeError(error));
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  async function markRead(ids?: number[]) {
    setBusy(true);
    setProblem(null);
    try {
      await api.markNotificationsRead(ids);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      await reload();
      setBusy(false);
    }
  }

  const all = rows ?? [];
  const matches = (row: NotificationView, value: Filter) =>
    value === 'todas' ? true : value === 'sin_leer' ? !row.read : row.type === value;
  const visible = all.filter((row) => matches(row, filter));
  const unread = all.filter((row) => !row.read).length;

  const filters: [Filter, string][] = [
    ['todas', 'Todas'],
    ['sin_leer', 'Sin leer'],
    ...NOTIFICATION_TYPES.map((type): [Filter, string] => [type, NOTIFICATION_TYPE_LABELS[type]]),
  ];

  return (
    <section className="px-6 py-8 md:px-12 md:py-12">
      <p className={ui.eyebrow}>03 / 07</p>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className={ui.h1}>Notificaciones</h1>
        <button type="button" className={ui.secondary} disabled={busy || unread === 0} onClick={() => void markRead()}>
          Marcar todas leídas
        </button>
      </div>

      <div className="mt-8 space-y-3">
        <VintedStatusBar status={status} />
        <ErrorNote problem={problem} />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {filters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`border px-3 py-1 text-[11px] uppercase tracking-[0.14em] ${
              filter === value ? 'border-accent text-paper' : 'border-line text-muted hover:text-paper'
            }`}
          >
            {label} <span className="ml-1 text-paper">{all.filter((row) => matches(row, value)).length}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="border-b border-line bg-panel">
            <tr>
              <th className={`${ui.th} w-6`}>
                <span className="sr-only">Sin leer</span>
              </th>
              <th className={ui.th}>Fecha</th>
              <th className={ui.th}>Tipo</th>
              <th className={ui.th}>Detalle</th>
              <th className={ui.th}>Anuncio</th>
              <th className={`${ui.th} text-right`}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-b-0 hover:bg-panel">
                <td className={ui.td}>
                  {!row.read && <span className="inline-block h-2 w-2 bg-accent" role="img" aria-label="Sin leer" />}
                </td>
                <td className={`${ui.td} whitespace-nowrap text-muted`}>{when(row.created_at)}</td>
                <td className={ui.td}>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                      row.type === 'venta' ? 'bg-accent text-ink' : 'border border-line text-muted'
                    }`}
                  >
                    {NOTIFICATION_TYPE_LABELS[row.type] ?? row.type}
                  </span>
                </td>
                <td className={`${ui.td} ${row.read ? 'text-muted' : 'font-semibold'}`}>{row.text ?? '—'}</td>
                <td className={`${ui.td} text-muted`}>{row.listing_title ?? '—'}</td>
                <td className={`${ui.td} whitespace-nowrap text-right`}>
                  {!row.read && (
                    <button type="button" className={ui.link} disabled={busy} onClick={() => void markRead([row.id])}>
                      Marcar leída
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td className="px-3 py-10 text-center text-muted" colSpan={6}>
                  {rows === null
                    ? 'Cargando…'
                    : all.length === 0
                      ? 'Aún no hay notificaciones. Aparecerán tras la primera sync de la extensión.'
                      : 'Ninguna notificación en este filtro.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 max-w-prose text-xs text-muted">
        «Leída» se refiere a ResellPilot: marcarla aquí no cambia nada en Vinted. Los mensajes se detectan por la
        lista de conversaciones con algo sin leer; las ventas, cuando un anuncio pasa a vendido.
      </p>
    </section>
  );
}
