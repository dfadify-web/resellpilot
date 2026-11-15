import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
  type NotificationType,
  type NotificationView,
  type VintedStatus,
} from '@resellpilot/shared';
import { BadgeEuro, Bell, CheckCheck, Heart, MessageCircle, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, describeError } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { Chips, EmptyState, Page, PageHeader } from '../components/kit';
import { VintedStatusBar } from '../components/VintedStatusBar';
import { ui, usePageTitle } from '../ui';

type Filter = NotificationType | 'todas' | 'sin_leer';

const REFRESH_MS = 30_000;

const TYPE_STYLE: Record<NotificationType, { icon: LucideIcon; className: string }> = {
  favorito: { icon: Heart, className: 'bg-pink-soft text-pink' },
  mensaje: { icon: MessageCircle, className: 'bg-accent-soft text-accent' },
  venta: { icon: BadgeEuro, className: 'bg-accent text-on-accent' },
  otro: { icon: Bell, className: 'bg-sunken text-muted' },
};

const when = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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

  const filters: { value: Filter; label: string }[] = [
    { value: 'todas', label: 'Todas' },
    { value: 'sin_leer', label: 'Sin leer' },
    ...NOTIFICATION_TYPES.map((type) => ({ value: type as Filter, label: NOTIFICATION_TYPE_LABELS[type] })),
  ];

  return (
    <Page>
      <PageHeader
        eyebrow={unread > 0 ? `${unread} sin leer` : 'Al día'}
        title="Notificaciones"
        description="Favoritos, mensajes y ventas de tu cuenta de Vinted. «Leída» es solo de ResellPilot: no cambia nada en Vinted."
        illustration="notificaciones"
        actions={
          <>
            <button type="button" className={ui.secondary} disabled={busy || unread === 0} onClick={() => void markRead()}>
              <CheckCheck size={16} aria-hidden="true" />
              Marcar todas leídas
            </button>
            <VintedStatusBar status={status?.last_sync_at && !status.paused ? status : null} />
          </>
        }
      />

      {status && (status.paused || !status.last_sync_at) && <VintedStatusBar status={status} />}
      <ErrorNote problem={problem} />

      <div className="space-y-3">
        <Chips
          label="Filtrar notificaciones"
          value={filter}
          onChange={setFilter}
          options={filters.map((option) => ({ ...option, count: all.filter((row) => matches(row, option.value)).length }))}
        />

        <div className={`${ui.card} overflow-hidden`}>
          {visible.length === 0 ? (
            <EmptyState
              illustration="vacio-notificaciones"
              title={rows === null ? 'Cargando…' : all.length === 0 ? 'Todo en calma' : 'Nada en este filtro'}
            >
              {rows !== null && all.length === 0 && 'Las notificaciones aparecerán tras la primera sincronización de la extensión.'}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((row) => {
                const style = TYPE_STYLE[row.type] ?? TYPE_STYLE.otro;
                const Icon = style.icon;
                return (
                  <li key={row.id} className={`flex items-start gap-4 px-5 py-4 transition-colors hover:bg-sunken/60 ${row.read ? '' : 'bg-accent-soft/30'}`}>
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${style.className}`}>
                      <Icon size={16} aria-hidden="true" />
                      <span className="sr-only">{NOTIFICATION_TYPE_LABELS[row.type]}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={row.read ? 'text-muted' : 'font-semibold'}>{row.text ?? '—'}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {when(row.created_at)}
                        {row.listing_title && <> · {row.listing_title}</>}
                      </p>
                    </div>
                    {!row.read && (
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="h-2 w-2 rounded-full bg-pink-ink" role="img" aria-label="Sin leer" />
                        <button type="button" className={ui.linkMuted} disabled={busy} onClick={() => void markRead([row.id])}>
                          Marcar leída
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted">
          Los mensajes se detectan por las conversaciones con algo sin leer; las ventas, cuando un anuncio pasa a vendido.
        </p>
      </div>
    </Page>
  );
}
