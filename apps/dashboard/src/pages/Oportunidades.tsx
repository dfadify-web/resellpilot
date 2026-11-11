import { RISK_BRAND, type DealStatus, type DealView } from '@resellpilot/shared';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError, type SourcesResponse } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { pct, shortDate, signedEur } from '../format';
import { ui, usePageTitle } from '../ui';

const STATUS_LABELS: Record<DealStatus, string> = {
  nuevo: 'Nuevas',
  descartado: 'Descartadas',
  comprado: 'Compradas',
};

const RISK_LABELS: Record<string, string> = { [RISK_BRAND]: 'Riesgo marca' };

const toText = (value: number | null): string => (value === null ? '' : String(value).replace('.', ','));

interface MoneyInputProps {
  label: string;
  value: number | null;
  disabled: boolean;
  onCommit: (value: number | null) => void;
}

/** Campo de precio editable en la tabla. Guarda al salir del campo o con Intro. */
function MoneyInput({ label, value, disabled, onCommit }: MoneyInputProps) {
  const [text, setText] = useState(toText(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(toText(value));
    setInvalid(false);
  }, [value]);

  function commit() {
    const trimmed = text.trim();
    const parsed = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed !== value) onCommit(parsed);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      setText(toText(value));
      setInvalid(false);
    }
  }

  return (
    <input
      aria-label={label}
      aria-invalid={invalid}
      inputMode="decimal"
      placeholder="—"
      disabled={disabled}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={`w-20 border bg-ink px-2 py-1 text-right text-sm text-paper placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50 ${
        invalid ? 'border-accent' : 'border-line'
      }`}
    />
  );
}

export function Oportunidades() {
  usePageTitle('Oportunidades');

  const [deals, setDeals] = useState<DealView[] | null>(null);
  const [sources, setSources] = useState<SourcesResponse | null>(null);
  const [status, setStatus] = useState<DealStatus>('nuevo');
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [hideRisk, setHideRisk] = useState(false);
  const [maxPrice, setMaxPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [dealList, sourceList] = await Promise.all([api.listDeals(), api.sources()]);
      setDeals(dealList);
      setSources(sourceList);
    } catch (error) {
      setProblem(describeError(error));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const done = await action();
      if (done) setNotice(done);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      await reload();
      setBusy(false);
    }
  }

  async function searchNow() {
    setSearching(true);
    await run(async () => {
      const result = await api.runIngest();
      const added = result.sources.reduce((total, source) => total + source.added, 0);
      const failed = result.sources.filter((source) => source.ok === false).length;
      const summary = added === 1 ? '1 oportunidad nueva.' : `${added} oportunidades nuevas.`;
      return failed > 0 ? `${summary} ${failed} fuente(s) con error: mira «Fuentes».` : summary;
    });
    setSearching(false);
  }

  const testTelegram = () =>
    run(async () => {
      const result = await api.testTelegram();
      if (!result.ok) throw new Error(result.error ?? 'Telegram no respondió.');
      return 'Aviso de prueba enviado a Telegram.';
    });

  const all = deals ?? [];
  const maxPriceNumber = maxPrice.trim() === '' ? null : Number(maxPrice.replace(',', '.'));
  const visible = all.filter(
    (deal) =>
      deal.status === status &&
      (!onlyRecommended || deal.recommended) &&
      (!hideRisk || deal.risk_flags.length === 0) &&
      (maxPriceNumber === null ||
        !Number.isFinite(maxPriceNumber) ||
        (deal.price !== null && deal.price <= maxPriceNumber)),
  );
  const count = (value: DealStatus) => all.filter((deal) => deal.status === value).length;
  const recommendedCount = all.filter((deal) => deal.recommended).length;
  const failedSources = sources?.sources.filter((source) => source.ok === false).length ?? 0;

  return (
    <section className="px-6 py-8 md:px-12 md:py-12">
      <p className={ui.eyebrow}>04 / 07</p>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className={ui.h1}>Oportunidades</h1>
        <button type="button" className={ui.primary} disabled={busy} onClick={() => void searchNow()}>
          {searching ? 'Buscando…' : 'Buscar ahora'}
        </button>
      </div>

      <div className="mt-8 flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-line pt-6">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(STATUS_LABELS) as DealStatus[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
              className={`border px-3 py-1 text-[11px] uppercase tracking-[0.14em] ${
                status === value ? 'border-accent text-paper' : 'border-line text-muted hover:text-paper'
              }`}
            >
              {STATUS_LABELS[value]} <span className="ml-1 text-paper">{count(value)}</span>
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-accent)]"
            checked={onlyRecommended}
            onChange={(event) => setOnlyRecommended(event.target.checked)}
          />
          Solo recomendadas <span className="text-paper">{recommendedCount}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-accent)]"
            checked={hideRisk}
            onChange={(event) => setHideRisk(event.target.checked)}
          />
          Ocultar riesgo de marca
        </label>
        <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted">
          Precio máx. €
          <input
            inputMode="decimal"
            placeholder="—"
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
            className="w-20 border border-line bg-ink px-2 py-1 text-right text-sm text-paper placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-4 space-y-3">
        <ErrorNote problem={problem} />
        {notice && (
          <p role="status" className="border border-line px-3 py-2 text-sm">
            {notice}
          </p>
        )}
      </div>

      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead className="border-b border-line bg-panel">
            <tr>
              <th className={`${ui.th} min-w-[300px]`}>Oportunidad</th>
              <th className={`${ui.th} text-right`}>Precio €</th>
              <th className={`${ui.th} text-right`}>Venta est. €</th>
              <th className={`${ui.th} text-right`}>Beneficio est.</th>
              <th className={`${ui.th} text-right`}>ROI</th>
              <th className={`${ui.th} text-right`}>Score</th>
              <th className={ui.th}>Aviso</th>
              <th className={`${ui.th} text-right`}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((deal) => {
              const name = deal.title ?? `Oportunidad #${deal.id}`;
              const editable = deal.status === 'nuevo' && !busy;
              return (
                <tr key={deal.id} className="border-b border-line last:border-b-0 hover:bg-panel">
                  <td className={ui.td}>
                    <div className="flex items-center gap-3">
                      {deal.image ? (
                        <img
                          src={deal.image}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-12 w-12 shrink-0 border border-line object-cover"
                          onError={(event) => {
                            event.currentTarget.style.visibility = 'hidden';
                          }}
                        />
                      ) : (
                        <div className="h-12 w-12 shrink-0 border border-line" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <a
                          href={deal.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="font-semibold hover:text-accent"
                        >
                          {name} <span aria-hidden="true">↗</span>
                        </a>
                        <span className="block text-xs text-muted">
                          {deal.source ?? 'Sin fuente'} · {shortDate(deal.found_at)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className={`${ui.td} text-right`}>
                    <MoneyInput
                      label={`Precio de ${name}`}
                      value={deal.price}
                      disabled={!editable}
                      onCommit={(price) => void run(() => api.updateDeal(deal.id, { price }).then(() => undefined))}
                    />
                  </td>
                  <td className={`${ui.td} text-right`}>
                    <MoneyInput
                      label={`Precio de venta estimado de ${name}`}
                      value={deal.est_price}
                      disabled={!editable}
                      onCommit={(est_price) =>
                        void run(() => api.updateDeal(deal.id, { est_price }).then(() => undefined))
                      }
                    />
                    {deal.est_price !== null && !deal.est_manual && (
                      <span className="block text-[10px] uppercase tracking-[0.12em] text-muted" title="Calculado por Tendencias: (p25 + mediana) / 2">
                        auto
                      </span>
                    )}
                  </td>
                  <td
                    className={`${ui.td} text-right font-semibold ${
                      deal.est_profit !== null && deal.est_profit > 0 ? 'text-accent' : ''
                    }`}
                  >
                    {signedEur(deal.est_profit)}
                  </td>
                  <td className={`${ui.td} text-right`}>{pct(deal.roi)}</td>
                  <td className={`${ui.td} text-right font-display text-xl font-bold`}>
                    {deal.est_profit === null ? '—' : String(deal.score).replace('.', ',')}
                  </td>
                  <td className={ui.td}>
                    <div className="flex flex-wrap gap-1">
                      {deal.recommended && (
                        <span className="bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ink">
                          Recomendada
                        </span>
                      )}
                      {deal.risk_flags.map((flag) => (
                        <span
                          key={flag}
                          className="border border-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted"
                        >
                          {RISK_LABELS[flag] ?? flag}
                        </span>
                      ))}
                      {deal.price === null && deal.status === 'nuevo' && (
                        <span className="border border-line px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted">
                          Falta precio
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`${ui.td} whitespace-nowrap text-right`}>
                    {deal.status === 'nuevo' && (
                      <>
                        <button
                          type="button"
                          className={`${ui.link} mr-4 text-paper`}
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api.buyDeal(deal.id);
                              return `«${name}» añadido a Inventario como pedido.`;
                            })
                          }
                        >
                          Comprado
                        </button>
                        <button
                          type="button"
                          className={ui.link}
                          disabled={busy}
                          onClick={() =>
                            void run(() => api.updateDeal(deal.id, { status: 'descartado' }).then(() => undefined))
                          }
                        >
                          Descartar
                        </button>
                      </>
                    )}
                    {deal.status === 'descartado' && (
                      <button
                        type="button"
                        className={ui.link}
                        disabled={busy}
                        onClick={() => void run(() => api.updateDeal(deal.id, { status: 'nuevo' }).then(() => undefined))}
                      >
                        Restaurar
                      </button>
                    )}
                    {deal.status === 'comprado' && (
                      <Link to="/inventario" className={ui.link}>
                        Ver en inventario
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td className="px-3 py-10 text-center text-muted" colSpan={8}>
                  {deals === null
                    ? 'Cargando…'
                    : all.length === 0
                      ? 'Aún no hay oportunidades. Pulsa «Buscar ahora» o espera a la próxima búsqueda automática (cada 10 min).'
                      : 'Ninguna oportunidad cumple estos filtros.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 max-w-prose text-xs text-muted">
        El precio de venta estimado se rellena solo desde Tendencias (marcado «auto») cuando el título coincide con
        una búsqueda medida; si lo escribes tú, manda el tuyo, y si lo borras vuelve el automático. Las oportunidades cuyo título coincide
        con <code>brand-blocklist.json</code> se marcan como riesgo de marca y nunca se recomiendan.
      </p>

      <details className="mt-8 border border-line" open={failedSources > 0}>
        <summary className="cursor-pointer px-4 py-3 font-display text-2xl font-bold uppercase">
          Fuentes{' '}
          <span className="font-sans text-xs font-normal normal-case text-muted">
            {sources ? `${sources.sources.length} en sources.json` : ''}
            {failedSources > 0 ? ` · ${failedSources} con error` : ''}
          </span>
        </summary>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-line bg-panel">
              <tr>
                <th className={ui.th}>Fuente</th>
                <th className={ui.th}>Última búsqueda</th>
                <th className={`${ui.th} text-right`}>Enlaces</th>
                <th className={`${ui.th} text-right`}>Nuevas</th>
                <th className={ui.th}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {(sources?.sources ?? []).map((source) => (
                <tr key={`${source.type}|${source.url}`} className="border-b border-line last:border-b-0">
                  <td className={ui.td}>
                    <a href={source.url} target="_blank" rel="noreferrer noopener" className="hover:text-accent">
                      {source.name}
                    </a>
                  </td>
                  <td className={`${ui.td} text-muted`}>
                    {source.last_run_at
                      ? new Date(source.last_run_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                      : 'Pendiente'}
                  </td>
                  <td className={`${ui.td} text-right`}>{source.last_run_at ? source.found : '—'}</td>
                  <td className={`${ui.td} text-right`}>{source.last_run_at ? source.added : '—'}</td>
                  <td className={ui.td}>
                    {source.ok === null ? (
                      <span className="text-muted">—</span>
                    ) : source.ok ? (
                      'Correcto'
                    ) : (
                      <span className="text-accent">{source.error ?? 'Error'}</span>
                    )}
                  </td>
                </tr>
              ))}
              {sources !== null && sources.sources.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-muted" colSpan={5}>
                    No hay fuentes. Añádelas en <code>sources.json</code>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
          <p className="text-muted">
            {sources?.telegram
              ? 'Avisos por Telegram activados: recibirás un mensaje cuando una oportunidad pase a recomendada.'
              : 'Telegram sin configurar: añade TELEGRAM_BOT_TOKEN en .env para recibir avisos.'}
          </p>
          <button
            type="button"
            className={ui.secondary}
            disabled={busy || !sources?.telegram}
            onClick={() => void testTelegram()}
          >
            Probar Telegram
          </button>
        </div>
      </details>
    </section>
  );
}
