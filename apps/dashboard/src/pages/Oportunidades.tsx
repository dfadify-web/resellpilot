import { RISK_BRAND, type DealStatus, type DealView } from '@resellpilot/shared';
import { Calculator, ExternalLink, ImageOff, RefreshCw, RotateCcw, Search, Send, ShoppingBag, Star, X } from 'lucide-react';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, describeError, type SourcesResponse } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { Badge, Card, CardHeader, Chips, EmptyState, IconButton, Notice, Page, PageHeader, TableCard } from '../components/kit';
import { pct, shortDate, signedEur } from '../format';
import { ui, usePageTitle } from '../ui';

const STATUS_LABELS: Record<DealStatus, string> = {
  nuevo: 'Nuevas',
  descartado: 'Descartadas',
  comprado: 'Compradas',
};

const RISK_LABELS: Record<string, string> = { [RISK_BRAND]: 'Marca' };

type Sort = 'score' | 'beneficio' | 'roi' | 'precio' | 'recientes';

const SORTS: Record<Sort, { label: string; compare: (a: DealView, b: DealView) => number }> = {
  score: { label: 'Mejor score', compare: (a, b) => b.score - a.score },
  beneficio: { label: 'Más beneficio', compare: (a, b) => (b.est_profit ?? -Infinity) - (a.est_profit ?? -Infinity) },
  roi: { label: 'Más ROI', compare: (a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity) },
  precio: { label: 'Más baratas', compare: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) },
  recientes: { label: 'Más recientes', compare: (a, b) => b.found_at.localeCompare(a.found_at) },
};

/** Sin acentos ni mayúsculas, para buscar. */
const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const toText = (value: number | null): string => (value === null ? '' : value.toFixed(2).replace('.', ','));

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
      className={`h-8 w-20 rounded-lg border bg-surface px-2 text-right text-sm text-ink placeholder:text-faint transition focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:border-transparent disabled:bg-transparent ${
        invalid ? 'border-pink' : 'border-line'
      }`}
    />
  );
}

/** Puntuación 0–100 como anillo. */
function Score({ value, muted }: { value: number; muted: boolean }) {
  const angle = Math.max(0, Math.min(100, value)) * 3.6;
  return (
    <span
      className="relative inline-grid h-10 w-10 place-items-center rounded-full"
      style={{ background: muted ? 'var(--color-sunken)' : `conic-gradient(var(--color-accent) ${angle}deg, var(--color-sunken) 0)` }}
      title={`Score ${toText(value)} de 100`}
    >
      <span className="grid h-8 w-8 place-items-center rounded-full bg-surface text-[12px] font-bold tabular-nums">
        {muted ? '—' : Math.round(value)}
      </span>
    </span>
  );
}

export function Oportunidades() {
  usePageTitle('Oportunidades');

  const [deals, setDeals] = useState<DealView[] | null>(null);
  const [sources, setSources] = useState<SourcesResponse | null>(null);
  const [status, setStatus] = useState<DealStatus>('nuevo');
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [maxPrice, setMaxPrice] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('score');
  const navigate = useNavigate();
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
    // Las fuentes se revisan cada 10 min en el server: la lista se refresca sola cada minuto.
    const timer = setInterval(() => void reload(), 60_000);
    return () => clearInterval(timer);
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
  const words = fold(query).split(/\s+/).filter((word) => word !== '');
  const visible = all
    .filter(
      (deal) =>
        deal.status === status &&
        (!onlyRecommended || deal.recommended) &&
        (maxPriceNumber === null || !Number.isFinite(maxPriceNumber) || (deal.price !== null && deal.price <= maxPriceNumber)) &&
        (words.length === 0 || words.every((word) => fold(`${deal.title ?? ''} ${deal.source ?? ''}`).includes(word))),
    )
    .sort((a, b) => SORTS[sort].compare(a, b) || b.found_at.localeCompare(a.found_at));
  const count = (value: DealStatus) => all.filter((deal) => deal.status === value).length;
  const recommendedCount = all.filter((deal) => deal.recommended).length;
  const failedSources = sources?.sources.filter((source) => source.ok === false).length ?? 0;

  return (
    <Page>
      <PageHeader
        eyebrow={recommendedCount > 0 ? `${recommendedCount} recomendadas` : 'Cada 10 minutos'}
        title="Oportunidades"
        description="Productos de tus fuentes con el beneficio que dejarían revendidos en Vinted, según los precios reales de Tendencias."
        illustration="oportunidades"
        actions={
          <button type="button" className={ui.primary} disabled={busy} onClick={() => void searchNow()}>
            <RefreshCw size={16} aria-hidden="true" className={searching ? 'animate-spin' : ''} />
            {searching ? 'Buscando…' : 'Buscar ahora'}
          </button>
        }
      />

      <ErrorNote problem={problem} />
      {notice && <Notice>{notice}</Notice>}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Buscar oportunidades</span>
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="search"
              placeholder="Buscar por título o fuente…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={`${ui.input} rounded-full pl-10`}
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] font-medium text-muted">
            Ordenar
            <select className={`${ui.select} h-10 w-auto rounded-full`} value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              {(Object.keys(SORTS) as Sort[]).map((key) => (
                <option key={key} value={key}>
                  {SORTS[key].label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Chips
            label="Estado de las oportunidades"
            value={status}
            onChange={setStatus}
            options={(Object.keys(STATUS_LABELS) as DealStatus[]).map((value) => ({
              value,
              label: STATUS_LABELS[value],
              count: count(value),
            }))}
          />
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-muted">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer"
              checked={onlyRecommended}
              onChange={(event) => setOnlyRecommended(event.target.checked)}
            />
            Solo recomendadas
          </label>
          <label className="flex items-center gap-2 text-[13px] font-medium text-muted">
            Precio máx.
            <span className="relative">
              <input
                inputMode="decimal"
                placeholder="—"
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
                className="h-8 w-24 rounded-full border border-line bg-surface pl-3 pr-7 text-right text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">€</span>
            </span>
          </label>
        </div>

        {visible.length === 0 ? (
          <div className={ui.card}>
            <EmptyState
              illustration="vacio-oportunidades"
              title={deals === null ? 'Cargando…' : all.length === 0 ? 'Aún no hay oportunidades' : 'Nada con estos filtros'}
              action={
                deals !== null && all.length === 0 ? (
                  <button type="button" className={ui.secondary} disabled={busy} onClick={() => void searchNow()}>
                    Buscar ahora
                  </button>
                ) : undefined
              }
            >
              {deals !== null && all.length === 0 && 'La búsqueda automática pasa por tus fuentes cada 10 minutos.'}
            </EmptyState>
          </div>
        ) : (
          <TableCard minWidth={900}>
            <thead>
              <tr>
                <th className={`${ui.th} min-w-[280px]`}>Oportunidad</th>
                <th className={`${ui.th} text-right`}>Compra</th>
                <th className={`${ui.th} text-right`}>Venta est.</th>
                <th className={`${ui.th} text-right`}>Beneficio</th>
                <th className={`${ui.th} text-right`}>ROI</th>
                <th className={`${ui.th} text-center`}>Score</th>
                <th className={`${ui.th} text-right`}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((deal) => {
                const name = deal.title ?? `Oportunidad #${deal.id}`;
                const editable = deal.status === 'nuevo' && !busy;
                return (
                  <tr key={deal.id} className={`${ui.tr} ${deal.recommended ? 'bg-accent-soft/35' : ''}`}>
                    <td className={ui.td}>
                      <div className="flex items-center gap-3">
                        <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-sunken">
                          {deal.image ? (
                            <img
                              src={deal.image}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                              onError={(event) => {
                                event.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : (
                            <ImageOff size={18} aria-hidden="true" className="text-faint" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <a
                            href={deal.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="group line-clamp-2 font-semibold leading-snug hover:text-accent"
                          >
                            {name}
                            <ExternalLink size={12} aria-hidden="true" className="ml-1 inline text-faint group-hover:text-accent" />
                          </a>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            {deal.recommended && (
                              <Badge tone="accentSolid">
                                <Star size={11} aria-hidden="true" className="fill-current" /> Recomendada
                              </Badge>
                            )}
                            {deal.risk_flags.map((flag) => (
                              <Badge key={flag} tone="outline">
                                {RISK_LABELS[flag] ?? flag}
                              </Badge>
                            ))}
                            {deal.price === null && deal.status === 'nuevo' && <Badge tone="pink">Falta precio</Badge>}
                            <span>
                              {deal.source ?? 'Sin fuente'} · {shortDate(deal.found_at)}
                            </span>
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
                        onCommit={(est_price) => void run(() => api.updateDeal(deal.id, { est_price }).then(() => undefined))}
                      />
                      {deal.est_price !== null && !deal.est_manual && (
                        <span className="mt-0.5 block text-[11px] text-faint" title="Calculado por Tendencias: (p25 + mediana) / 2">
                          automático
                        </span>
                      )}
                    </td>
                    <td
                      className={`${ui.td} text-right font-semibold ${
                        deal.est_profit !== null && deal.est_profit > 0 ? 'text-accent' : deal.est_profit !== null ? 'text-pink' : ''
                      }`}
                    >
                      {signedEur(deal.est_profit)}
                    </td>
                    <td className={`${ui.td} text-right`}>{pct(deal.roi)}</td>
                    <td className={`${ui.td} text-center`}>
                      <Score value={deal.score} muted={deal.est_profit === null} />
                    </td>
                    <td className={`${ui.td} whitespace-nowrap text-right`}>
                      {deal.status === 'nuevo' && (
                        <span className="inline-flex items-center gap-1">
                          <IconButton
                            label={`Calcular si compensa «${name}»`}
                            icon={Calculator}
                            onClick={() => {
                              const search = new URLSearchParams({ nombre: name });
                              if (deal.price !== null) search.set('precio', String(deal.price));
                              if (deal.est_price !== null) search.set('venta', String(deal.est_price));
                              navigate(`/calculadora?${search.toString()}`);
                            }}
                          />
                          <IconButton
                            label={`Comprado: añadir «${name}» a Inventario`}
                            icon={ShoppingBag}
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api.buyDeal(deal.id);
                                return `«${name}» añadido a Inventario como pedido.`;
                              })
                            }
                          />
                          <IconButton
                            label={`Descartar «${name}»`}
                            icon={X}
                            disabled={busy}
                            onClick={() => void run(() => api.updateDeal(deal.id, { status: 'descartado' }).then(() => undefined))}
                          />
                        </span>
                      )}
                      {deal.status === 'descartado' && (
                        <IconButton
                          label={`Restaurar «${name}»`}
                          icon={RotateCcw}
                          disabled={busy}
                          onClick={() => void run(() => api.updateDeal(deal.id, { status: 'nuevo' }).then(() => undefined))}
                        />
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
            </tbody>
          </TableCard>
        )}
        <p className="max-w-[80ch] text-xs leading-relaxed text-muted">
          La venta estimada sale sola de Tendencias («automático») cuando el título coincide con una búsqueda medida. Si
          la escribes tú, manda la tuya; si la borras, vuelve la automática.
        </p>
      </div>

      <Card as="section">
        <CardHeader
          title="Fuentes"
          description={
            <>
              {sources ? `${sources.sources.length} en sources.json` : 'Cargando…'}
              {failedSources > 0 && <span className="font-semibold text-pink"> · {failedSources} con error</span>}
            </>
          }
          actions={
            <button type="button" className={ui.secondary} disabled={busy || !sources?.telegram} onClick={() => void testTelegram()}>
              <Send size={15} aria-hidden="true" />
              Probar Telegram
            </button>
          }
        />
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {(sources?.sources ?? []).map((source) => (
            <li key={`${source.type}|${source.url}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${source.ok === null ? 'bg-faint' : source.ok ? 'bg-accent' : 'bg-pink-ink'}`}
              />
              <a href={source.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                {source.name}
              </a>
              <span className="text-xs text-muted">
                {source.last_run_at
                  ? `${new Date(source.last_run_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · ${source.found} enlaces · ${source.added} nuevas`
                  : 'Pendiente'}
              </span>
              {source.ok === false && <span className="w-full pl-6 text-xs text-pink">{source.error ?? 'Error'}</span>}
            </li>
          ))}
          {sources !== null && sources.sources.length === 0 && (
            <li className="px-5 py-6 text-center text-sm text-muted">
              No hay fuentes. Añádelas en <code>sources.json</code>.
            </li>
          )}
        </ul>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          {sources?.telegram
            ? 'Avisos por Telegram activados: te llega un mensaje cuando una oportunidad pasa a recomendada.'
            : 'Telegram sin configurar: añade TELEGRAM_BOT_TOKEN en .env para recibir avisos.'}
        </p>
      </Card>
    </Page>
  );
}
