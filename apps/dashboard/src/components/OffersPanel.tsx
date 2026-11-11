import type { CommandType, CommandView, OfferPlan, OfferPlanRow } from '@resellpilot/shared';
import { useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../api';
import { eur } from '../format';
import { ui } from '../ui';
import { ErrorNote, type Problem } from './ErrorNote';
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
  return (
    <div className={`border px-4 py-3 text-sm ${active || command.status === 'failed' ? 'border-accent' : 'border-line'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-2xl font-bold uppercase leading-none">
          {command.type === 'send_offers' ? 'Ofertas a favoritos' : 'Bajada de precios'}
          {command.dry_run && (
            <span className="ml-3 bg-accent px-2 py-0.5 align-middle font-sans text-[10px] font-bold tracking-[0.12em] text-ink">
              Simulación
            </span>
          )}
        </p>
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
          {STATUS_LABELS[command.status]} · {command.done} de {command.total}
        </p>
      </div>
      <div className="mt-3 h-1 bg-line" aria-hidden="true">
        <div className="h-1 bg-accent" style={{ width: `${Math.round(command.progress * 100)}%` }} />
      </div>
      {command.error && <p className="mt-2 text-accent">{command.error}</p>}
      {command.status === 'pending' && (
        <p className="mt-2 text-muted">
          Abre una pestaña de vinted.es: la extensión lo recoge en menos de un minuto y muestra el progreso allí, con
          un botón PARAR.
        </p>
      )}
      <details className="mt-2" open={active}>
        <summary className="cursor-pointer text-[11px] uppercase tracking-[0.14em] text-muted">
          Registro ({command.log.length})
        </summary>
        <ol className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
          {command.log.map((line, index) => (
            <li key={index} className={line.ok ? '' : 'text-muted'}>
              <span className="text-muted">{time(line.at)}</span> {line.text}
            </li>
          ))}
        </ol>
      </details>
      {active && (
        <button type="button" className={`${ui.secondary} mt-3`} onClick={onCancel}>
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
        type === 'price_drop'
          ? { type, listing_ids: [...selected] }
          : { type, favoriter_ids: [...selected] },
      );
      onCreated();
    } catch (error) {
      setProblem(describeError(error));
      setSaving(false);
    }
  }

  const overLimit = type === 'send_offers' && !plan.dry_run && selected.size > plan.remaining_today;
  const title = type === 'price_drop' ? `Bajar precio −${plan.discount_pct} %` : `Enviar oferta −${plan.discount_pct} %`;
  const noun = type === 'price_drop' ? 'anuncio(s)' : 'mensaje(s)';

  const blockedNote = (row: OfferPlanRow) =>
    row.blocker ?? (row.recipients.length === 0 ? 'sin favoritos' : 'todos ya ofertados o con conversación');

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className={`border px-3 py-2 ${plan.dry_run ? 'border-accent' : 'border-line'}`}>
          {plan.dry_run ? (
            <>
              <strong className="text-accent">Modo simulación.</strong> No se envía ni se cambia nada en Vinted: verás
              exactamente qué se haría, paso a paso, en el registro.
            </>
          ) : (
            <>Esto escribe en tu cuenta de Vinted. Revisa la lista antes de confirmar.</>
          )}
        </p>

        {type === 'send_offers' && (
          <p className="text-muted">
            Límite diario: {plan.max_per_day} mensajes · enviados hoy {plan.sent_today} · quedan {plan.remaining_today}.
            Entre mensajes se espera un tiempo aleatorio.
          </p>
        )}

        {eligible.length === 0 && <p>No hay nada que ofertar ahora mismo.</p>}

        <ul className="max-h-[45vh] space-y-3 overflow-y-auto">
          {eligible.map((row) => (
            <li key={row.listing_id} className="border border-line px-3 py-2">
              {type === 'price_drop' ? (
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
                    checked={selected.has(row.listing_id)}
                    onChange={() => toggle(row.listing_id)}
                  />
                  <span>
                    <span className="font-semibold">{row.title}</span>
                    <span className="block text-muted">
                      {eur(row.price)} → <span className="text-paper">{eur(row.new_price)}</span> · {row.pending}{' '}
                      {row.pending === 1 ? 'favorito sin ofertar' : 'favoritos sin ofertar'}
                    </span>
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
                  <ul className="mt-2 space-y-2">
                    {row.recipients
                      .filter((recipient) => recipient.message !== null)
                      .map((recipient) => (
                        <li key={recipient.favoriter_id}>
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
                              checked={selected.has(recipient.favoriter_id)}
                              onChange={() => toggle(recipient.favoriter_id)}
                            />
                            <span>
                              <span className="font-semibold">{recipient.username ?? 'usuario sin nombre'}</span>
                              <span className="block border-l-2 border-line pl-2 text-muted">{recipient.message}</span>
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
            <summary className="cursor-pointer text-[11px] uppercase tracking-[0.14em] text-muted">
              No incluidos ({blocked.length})
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {blocked.map((row) => (
                <li key={row.listing_id}>
                  <span className="text-paper">{row.title}</span>: {blockedNote(row)}
                </li>
              ))}
            </ul>
          </details>
        )}

        {overLimit && (
          <p className="text-accent">
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
