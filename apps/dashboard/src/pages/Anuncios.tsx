import {
  LISTING_STATUS_LABELS,
  type ItemWithCalc,
  type ListingView,
  type CommandType,
  type OfferPlanRow,
  type RepricingRow,
  type VintedStatus,
} from '@resellpilot/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, describeError } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { CommandBox, OffersDialog, useOffers } from '../components/OffersPanel';
import { RepricingPanel } from '../components/RepricingPanel';
import { VintedStatusBar } from '../components/VintedStatusBar';
import { eur, shortDate } from '../format';
import { ui, usePageTitle } from '../ui';

type Filter = 'en_venta' | 'stale' | 'vendidos' | 'todos';

const FILTERS: Record<Filter, { label: string; test: (listing: ListingView) => boolean }> = {
  en_venta: { label: 'En venta', test: (l) => l.status === 'activo' || l.status === 'reservado' },
  stale: { label: 'Stale', test: (l) => l.stale },
  vendidos: { label: 'Vendidos', test: (l) => l.status === 'vendido' },
  todos: { label: 'Todos', test: () => true },
};

const REFRESH_MS = 30_000;

export function Anuncios() {
  usePageTitle('Anuncios');

  const [listings, setListings] = useState<ListingView[] | null>(null);
  const [items, setItems] = useState<ItemWithCalc[]>([]);
  const [status, setStatus] = useState<VintedStatus | null>(null);
  const [repricing, setRepricing] = useState<RepricingRow[]>([]);
  const [filter, setFilter] = useState<Filter>('en_venta');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [dialog, setDialog] = useState<{ type: CommandType; listingId: number | null } | null>(null);
  const offers = useOffers();

  const reload = useCallback(async () => {
    try {
      const [listingRows, itemRows, vinted, suggestions] = await Promise.all([
        api.listListings(),
        api.listItems(),
        api.vintedStatus(),
        api.repricing(),
      ]);
      setListings(listingRows);
      setItems(itemRows);
      setStatus(vinted);
      setRepricing(suggestions);
    } catch (error) {
      setProblem(describeError(error));
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  async function link(listing: ListingView, value: string) {
    setBusy(true);
    setProblem(null);
    try {
      await api.linkListing(listing.id, value === '' ? null : Number(value));
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      await reload();
      setBusy(false);
    }
  }

  const all = listings ?? [];
  const visible = all.filter(FILTERS[filter].test);
  const onSale = all.filter(FILTERS.en_venta.test);
  const linkedItems = new Set(all.map((listing) => listing.item_id).filter((id): id is number => id !== null));
  const totalValue = onSale.reduce((sum, listing) => sum + (listing.price ?? 0), 0);

  const planByListing = new Map((offers.plan?.rows ?? []).map((row) => [row.listing_id, row]));
  const offerable = (offers.plan?.rows ?? []).filter((row) => row.blocker === null && row.pending > 0).length;
  const commandActive = offers.plan?.active_command_id != null;
  const discount = offers.plan?.discount_pct ?? 10;

  const kpis: [string, string][] = [
    ['En venta', String(onSale.length)],
    ['Valor publicado', eur(totalValue)],
    ['Favoritos', String(onSale.reduce((sum, listing) => sum + listing.favs, 0))],
    ['Stale', String(all.filter((listing) => listing.stale).length)],
  ];

  return (
    <section className="px-6 py-8 md:px-12 md:py-12">
      <p className={ui.eyebrow}>02 / 07</p>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className={ui.h1}>Anuncios</h1>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={ui.secondary}
            disabled={!offers.plan || commandActive || offerable === 0}
            onClick={() => setDialog({ type: 'send_offers', listingId: null })}
          >
            Enviar oferta −{discount} %
          </button>
          <button
            type="button"
            className={ui.primary}
            disabled={!offers.plan || commandActive || offerable === 0}
            onClick={() => setDialog({ type: 'price_drop', listingId: null })}
          >
            Bajar precio −{discount} %
          </button>
        </div>
      </div>

      <div className="mt-8 space-y-3">
        <VintedStatusBar status={status} />
        <ErrorNote problem={problem} />
        {offers.command && (
          <CommandBox
            command={offers.command}
            onCancel={() => {
              const id = offers.command?.id;
              if (id !== undefined) void api.cancelCommand(id).then(() => offers.reload());
            }}
          />
        )}
        {offers.plan && all.length > 0 && offerable === 0 && !commandActive && (
          <p className="text-xs text-muted">
            Ofertas a favoritos: ahora mismo ningún anuncio las admite. Hace falta que esté activo, enlazado a un item
            en estado «en mano» y con favoritos a los que aún no se haya ofertado.
          </p>
        )}
      </div>

      {all.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 border border-line xl:grid-cols-4">
          {kpis.map(([label, value]) => (
            <div key={label} className="border-b border-r border-line px-5 py-4 xl:border-b-0 xl:last:border-r-0">
              <dt className={ui.eyebrow}>{label}</dt>
              <dd className="mt-1 font-display text-5xl font-bold leading-none">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as Filter[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`border px-3 py-1 text-[11px] uppercase tracking-[0.14em] ${
              filter === key ? 'border-accent text-paper' : 'border-line text-muted hover:text-paper'
            }`}
          >
            {FILTERS[key].label} <span className="ml-1 text-paper">{all.filter(FILTERS[key].test).length}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[1020px] border-collapse text-sm">
          <thead className="border-b border-line bg-panel">
            <tr>
              <th className={`${ui.th} min-w-[260px]`}>Anuncio</th>
              <th className={`${ui.th} text-right`}>Precio</th>
              <th className={`${ui.th} text-right`}>Favs</th>
              <th className={`${ui.th} text-right`}>Sin ofertar</th>
              <th className={`${ui.th} text-right`}>Vistas</th>
              <th className={`${ui.th} text-right`}>Días</th>
              <th className={ui.th}>Publicado</th>
              <th className={ui.th}>Estado</th>
              <th className={ui.th}>Item de inventario</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((listing) => (
              <tr key={listing.id} className="border-b border-line last:border-b-0 hover:bg-panel">
                <td className={ui.td}>
                  <a
                    href={`https://www.vinted.es/items/${listing.vinted_id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-semibold hover:text-accent"
                  >
                    {listing.title} <span aria-hidden="true">↗</span>
                  </a>
                </td>
                <td className={`${ui.td} text-right`}>{eur(listing.price)}</td>
                <td className={`${ui.td} text-right`}>{listing.favs}</td>
                <td className={`${ui.td} whitespace-nowrap text-right`}>
                  <OfferCell
                    row={planByListing.get(listing.id)}
                    discount={discount}
                    disabled={commandActive}
                    onOffer={() => setDialog({ type: 'send_offers', listingId: listing.id })}
                  />
                </td>
                <td className={`${ui.td} text-right`}>{listing.views}</td>
                <td className={`${ui.td} text-right ${listing.stale ? 'font-semibold text-accent' : ''}`}>
                  {listing.days_listed ?? '—'}
                </td>
                <td className={`${ui.td} text-muted`}>{shortDate(listing.listed_at)}</td>
                <td className={ui.td}>
                  <span className="text-xs uppercase tracking-wide">{LISTING_STATUS_LABELS[listing.status] ?? listing.status}</span>
                  {listing.stale && (
                    <span className="ml-2 bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ink">
                      Stale
                    </span>
                  )}
                </td>
                <td className={ui.td}>
                  <select
                    aria-label={`Item de inventario enlazado a ${listing.title}`}
                    className="w-full max-w-[220px] border border-line bg-ink px-2 py-1 text-xs text-paper focus:border-accent focus:outline-none"
                    value={listing.item_id ?? ''}
                    disabled={busy}
                    onChange={(event) => void link(listing, event.target.value)}
                  >
                    <option value="">Sin enlazar</option>
                    {items
                      .filter((item) => item.id === listing.item_id || !linkedItems.has(item.id))
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td className="px-3 py-10 text-center text-muted" colSpan={9}>
                  {listings === null
                    ? 'Cargando…'
                    : all.length === 0
                      ? 'Aún no hay anuncios. Aparecerán tras la primera sync de la extensión.'
                      : 'Ningún anuncio en este filtro.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 max-w-prose text-xs text-muted">
        Stale = en venta y con más días publicados que <code>STALE_DAYS</code>. La fecha de publicación es la de
        subida de la primera foto. Enlazar un anuncio con su item permite saber qué stock tienes en mano.
      </p>
      <RepricingPanel rows={repricing} />

      {dialog && offers.plan && (
        <OffersDialog
          type={dialog.type}
          plan={offers.plan}
          onlyListingId={dialog.listingId}
          onClose={() => setDialog(null)}
          onCreated={() => {
            setDialog(null);
            void offers.reload();
          }}
        />
      )}
    </section>
  );
}

interface OfferCellProps {
  row: OfferPlanRow | undefined;
  discount: number;
  disabled: boolean;
  onOffer: () => void;
}

/** Favoritos a los que aún no se ha ofertado, con el botón de oferta del anuncio. */
function OfferCell({ row, discount, disabled, onOffer }: OfferCellProps) {
  if (!row || row.pending === 0) return <span className="text-muted">—</span>;
  if (row.blocker !== null) {
    return (
      <span className="text-muted" title={`No se puede ofertar: ${row.blocker}`}>
        {row.pending} · bloqueado
      </span>
    );
  }
  return (
    <button type="button" className={`${ui.link} text-paper`} disabled={disabled} onClick={onOffer}>
      {row.pending} · Oferta −{discount} %
    </button>
  );
}
