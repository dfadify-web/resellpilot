import type { CommandType, CommandView, OfferPlan, OfferPlanRow } from '@resellpilot/shared';
import { FlaskConical } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../api';
import { eur, vintedEditUrl } from '../format';
import { ui } from '../ui';
import { ErrorNote, type Problem } from './ErrorNote';
import { Badge } from './kit';
import { Modal } from './Modal';

const STATUS_LABELS: Record<CommandView['status'], string> = {
  pending: 'Esperando a la extensión',
  running: 'En curso',
  done: 'Terminado',
  failed: 'Detenido por un error',
  cancelled: 'Cancelado',
};

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Estado y registro del último comando (o del que está en curso). */
export function CommandBox({ command, onCancel }: { command: CommandView; onCancel: () => void }) {
  const active = command.status === 'pending' || command.status === 'running';
  const failed = command.status === 'failed';
  return (
    <div
      className={`rounded-[var(--radius-card)] border p-5 shadow-[var(--shadow-card)] ${
        failed ? 'border-pink/40 bg-pink-soft' : active ? 'border-accent/40 bg-surface' : 'border-line bg-surface'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-display text-lg font-semibold">
          {command.type === 'send_offers' ? 'Ofertas a favoritos' : 'Bajada de precios'}
          {command.dry_run && (
            <Badge tone="pink">
              <FlaskConical size={12} aria-hidden="true" /> Simulación
            </Badge>
          )}
        </p>
        <p className="text-xs font-medium text-muted">
          {STATUS_LABELS[command.status]} · {command.done} de {command.total}
        </p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(command.progress * 100)}%` }} />
      </div>
      {command.error && <p className="mt-2 text-sm font-medium text-pink">{command.error}</p>}
      {command.status === 'pending' && (
        <p className="mt-2 text-sm text-muted">
          Abre una pestaña de vinted.es: la extensión lo recoge en menos de un minuto y muestra el progreso allí, con un
          botón PARAR.
        </p>
      )}
      <details className="mt-3" open={active}>
        <summary className="cursor-pointer text-xs font-semibold text-muted">Registro ({command.log.length})</summary>
        <ol className="scroll-soft mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl bg-sunken p-3 font-mono text-[12px]">
          {command.log.map((line, index) => (
            <li key={index} className={line.ok ? '' : 'text-muted'}>
              <span className="text-faint">{time(line.at)}</span> {line.text}
            </li>
          ))}
        </ol>
      </details>
      {active && (
        <button type="button" className={`${ui.secondary} mt-4`} onClick={onCancel}>
          Cancelar
        </button>
      )}
    </div>
  );
}

interface DialogProps {
  type: CommandType;
  plan: OfferPlan;
  /** Si se indica, la lista se limita a ese anuncio. */
  onlyListingId: number | null;
  onClose: () => void;
  onCreated: () => void;
}

/** Lista de confirmación previa (Regla 6): qué se haría, a quién, con casillas y vista previa. */
export function OffersDialog({ type, plan, onlyListingId, onClose, onCreated }: DialogProps) {
  const rows = useMemo(
    () => plan.rows.filter((row) => onlyListingId === null || row.listing_id === onlyListingId),
    [plan.rows, onlyListingId],
  );
  const eligible = rows.filter((row) => row.blocker === null && row.pending > 0);
  const blocked = rows.filter((row) => !(row.blocker === null && row.pending > 0));

  // Todo lo elegible empieza marcado; el usuario desmarca lo que no quiera.
  const [selected, setSelected] = useState<Set<number>>(() => {
    const ids = new Set<number>();
    for (const row of eligible) {
      if (type === 'price_drop') ids.add(row.listing_id);
      else for (const recipient of row.recipients) if (recipient.message !== null) ids.add(recipient.favoriter_id);
    }
    return ids;
  });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function confirm() {
    setSaving(true);
    setProblem(null);
    try {
      await api.createCommand(
        type === 'price_drop' ? { type, listing_ids: [...selected] } : { type, favoriter_ids: [...selected] },
      );
      onCreated();
    } catch (error) {
      setProblem(describeError(error));
      setSaving(false);
    }
  }

  const overLimit = type === 'send_offers' && !plan.dry_run && selected.size > plan.remaining_today;
  const title = type === 'price_drop' ? `Bajar precio −${plan.discount_pct} %` : `Oferta −${plan.discount_pct} %`;
  const noun = type === 'price_drop' ? 'anuncio(s)' : 'mensaje(s)';

  const blockedNote = (row: OfferPlanRow) =>
    row.blocker ?? (row.recipients.length === 0 ? 'sin favoritos' : 'todos ya ofertados o con conversación');

  const checkbox = 'mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded';

  return (
    <Modal title={title} onClose={onClose} illustration={type === 'price_drop' ? 'bajada-precio' : 'notificaciones'} size="lg">
      <div className="space-y-4 text-sm">
        <div
          className={`flex gap-3 rounded-2xl border px-4 py-3 ${plan.dry_run ? 'border-pink/30 bg-pink-soft' : 'border-line bg-sunken'}`}
        >
          {plan.dry_run && <FlaskConical size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-pink" />}
          <p>
            {plan.dry_run ? (
              <>
                <strong className="text-pink">Modo simulación.</strong> No se envía ni se cambia nada en Vinted: verás
                exactamente qué se haría, paso a paso, en el registro.
                {type === 'price_drop' &&
                  ' Si bajas el precio tú en Vinted, la siguiente sync lo registra y da por avisados a esos favoritos.'}
              </>
            ) : (
              <>Esto escribe en tu cuenta de Vinted. Revisa la lista antes de confirmar.</>
            )}
          </p>
        </div>

        {type === 'send_offers' && (
          <p className="text-muted">
            Límite diario: {plan.max_per_day} mensajes · enviados hoy {plan.sent_today} · quedan {plan.remaining_today}.
            Entre mensajes se espera un tiempo aleatorio.
          </p>
        )}

        {eligible.length === 0 && <p>No hay nada que ofertar ahora mismo.</p>}

        <ul className="scroll-soft max-h-[45vh] space-y-2.5 overflow-y-auto">
          {eligible.map((row) => (
            <li key={row.listing_id} className="rounded-2xl border border-line bg-bg/60 p-4">
              {type === 'price_drop' ? (
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" className={checkbox} checked={selected.has(row.listing_id)} onChange={() => toggle(row.listing_id)} />
                  <span className="min-w-0">
                    <span className="font-semibold">{row.title}</span>
                    <span className="mt-0.5 block text-muted">
                      {eur(row.price)} → <strong className="text-ink">{eur(row.new_price)}</strong> · {row.pending}{' '}
                      {row.pending === 1 ? 'favorito sin ofertar' : 'favoritos sin ofertar'}
                    </span>
                    {plan.dry_run && (
                      <a href={vintedEditUrl(row.vinted_id)} target="_blank" rel="noreferrer noopener" className={`${ui.link} mt-1 inline-block text-xs`}>
                        Bajarlo a mano en Vinted ↗
                      </a>
                    )}
                  </span>
                </label>
              ) : (
                <>
                  <p className="font-semibold">
                    {row.title}{' '}
                    <span className="font-normal text-muted">
                      · {eur(row.price)} → {eur(row.new_price)}
                    </span>
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {row.recipients
                      .filter((recipient) => recipient.message !== null)
                      .map((recipient) => (
                        <li key={recipient.favoriter_id}>
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              className={checkbox}
                              checked={selected.has(recipient.favoriter_id)}
                              onChange={() => toggle(recipient.favoriter_id)}
                            />
                            <span className="min-w-0">
                              <span className="font-semibold">{recipient.username ?? 'usuario sin nombre'}</span>
                              <span className="mt-1 block rounded-xl rounded-tl-sm bg-accent-soft px-3 py-2 text-ink">
                                {recipient.message}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>

        {blocked.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-muted">No incluidos ({blocked.length})</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {blocked.map((row) => (
                <li key={row.listing_id}>
                  <span className="text-ink">{row.title}</span>: {blockedNote(row)}
                </li>
              ))}
            </ul>
          </details>
        )}

        {overLimit && (
          <p className="font-medium text-pink">
            Has marcado {selected.size} pero hoy solo quedan {plan.remaining_today}: el resto no se enviará.
          </p>
        )}
        <ErrorNote problem={problem} />

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" className={ui.secondary} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={ui.primary} disabled={saving || selected.size === 0} onClick={() => void confirm()}>
            {saving ? 'Creando…' : `${plan.dry_run ? 'Simular' : 'Confirmar'} ${selected.size} ${noun}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Carga el plan de ofertas y el último comando, y los refresca mientras haya uno activo. */
export function useOffers() {
  const [plan, setPlan] = useState<OfferPlan | null>(null);
  const [command, setCommand] = useState<CommandView | null>(null);

  const reload = async () => {
    try {
      const [nextPlan, commands] = await Promise.all([api.offersPlan(), api.listCommands()]);
      setPlan(nextPlan);
      setCommand(commands[0] ?? null);
    } catch {
      // El aviso de conexión ya lo muestra la página.
    }
  };

  const active = command?.status === 'pending' || command?.status === 'running';
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), active ? 2000 : 15000);
    return () => clearInterval(timer);
  }, [active]);

  return { plan, command, reload };
}
