import {
  LISTING_STATUS_LABELS,
  suggestLinks,
  type CommandType,
  type ItemWithCalc,
  type ListingView,
  type OfferPlanRow,
  type RepricingRow,
  type VintedStatus,
} from '@resellpilot/shared';
import { ArrowDownRight, ExternalLink, Heart, Link2, MessageCircleHeart } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { LinkSuggestionsDialog } from '../components/LinkSuggestionsDialog';
import { MarketCell } from '../components/MarketCell';
import { Badge, Chips, EmptyState, Notice, Page, PageHeader, StatStrip, TableCard, Thumb, type BadgeTone } from '../components/kit';
import { CommandBox, OffersDialog, useOffers } from '../components/OffersPanel';
import { RepricingPanel } from '../components/RepricingPanel';
import { VintedStatusBar } from '../components/VintedStatusBar';
import { eur, shortDate } from '../format';
import { ui, usePageTitle } from '../ui';

type Filter = 'en_venta' | 'stale' | 'caros' | 'vendidos' | 'todos';

const onSaleTest = (l: ListingView): boolean => l.status === 'activo' || l.status === 'reservado';

const FILTERS: Record<Filter, { label: string; test: (listing: ListingView) => boolean }> = {
  en_venta: { label: 'En venta', test: onSaleTest },
  stale: { label: 'Estancados', test: (l) => l.stale },
  caros: { label: 'Caros vs Vinted', test: (l) => onSaleTest(l) && l.market?.verdict === 'caro' },
  vendidos: { label: 'Vendidos', test: (l) => l.status === 'vendido' },
  todos: { label: 'Todos', test: () => true },
};

const STATUS_TONES: Record<string, BadgeTone> = {
  activo: 'accent',
  reservado: 'outline',
  vendido: 'accentSolid',
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
  const [linking, setLinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
  const suggestions = useMemo(() => suggestLinks(listings ?? [], items), [listings, items]);
  const visible = all.filter(FILTERS[filter].test);
  const onSale = all.filter(FILTERS.en_venta.test);
  const linkedItems = new Set(all.map((listing) => listing.item_id).filter((id): id is number => id !== null));
  const totalValue = onSale.reduce((sum, listing) => sum + (listing.price ?? 0), 0);

  const planByListing = new Map((offers.plan?.rows ?? []).map((row) => [row.listing_id, row]));
  const offerable = (offers.plan?.rows ?? []).filter((row) => row.blocker === null && row.pending > 0).length;
  const commandActive = offers.plan?.active_command_id != null;
  const discount = offers.plan?.discount_pct ?? 10;
  const offersDisabled = !offers.plan || commandActive || offerable === 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Tu armario en Vinted"
        title="Anuncios"
        description="Favoritos, vistas y días publicados de cada anuncio. Enlázalos con su item para saber qué tienes en casa y cuánto ganas."
        illustration="anuncios"
        actions={
          <>
            <button
              type="button"
              className={ui.primary}
              disabled={offersDisabled}
              onClick={() => setDialog({ type: 'price_drop', listingId: null })}
            >
              <ArrowDownRight size={16} aria-hidden="true" />
              Bajar precio −{discount} %
            </button>
            <button
              type="button"
              className={ui.secondary}
              disabled={offersDisabled}
              onClick={() => setDialog({ type: 'send_offers', listingId: null })}
            >
              <MessageCircleHeart size={16} aria-hidden="true" />
              Oferta a favoritos
            </button>
            <VintedStatusBar status={status?.last_sync_at && !status.paused ? status : null} />
          </>
        }
      />

      {status && (status.paused || !status.last_sync_at) && <VintedStatusBar status={status} />}
      <ErrorNote problem={problem} />
      {notice && <Notice>{notice}</Notice>}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <Link2 size={18} aria-hidden="true" className="text-accent" />
          <p className="min-w-0 flex-1">
            {suggestions.length === 1 ? 'Hay 1 anuncio' : `Hay ${suggestions.length} anuncios`} que parece{suggestions.length === 1 ? '' : 'n'}{' '}
            corresponder a items de tu inventario. Enlazarlos activa el margen por anuncio y las ventas automáticas.
          </p>
          <button type="button" className={`${ui.primary} h-9`} onClick={() => setLinking(true)}>
            Revisar y enlazar
          </button>
        </div>
      )}
      {offers.command && (
        <CommandBox
          command={offers.command}
          onCancel={() => {
            const id = offers.command?.id;
            if (id !== undefined) void api.cancelCommand(id).then(() => offers.reload());
          }}
        />
      )}

      {all.length > 0 && (
        <StatStrip
          items={[
            ['En venta', String(onSale.length)],
            ['Valor publicado', eur(totalValue)],
            ['Favoritos', String(onSale.reduce((sum, listing) => sum + listing.favs, 0))],
            ['Estancados', String(all.filter((listing) => listing.stale).length)],
          ]}
        />
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Chips
            label="Filtrar anuncios"
            value={filter}
            onChange={setFilter}
            options={(Object.keys(FILTERS) as Filter[]).map((key) => ({
              value: key,
              label: FILTERS[key].label,
              count: all.filter(FILTERS[key].test).length,
            }))}
          />
          {offers.plan && all.length > 0 && offerable === 0 && !commandActive && (
            <p className="text-xs text-muted">
              Para ofertar, el anuncio debe estar activo, enlazado a un item «en mano» y tener favoritos sin ofertar.
            </p>
          )}
        </div>

        {all.length === 0 ? (
          <div className={ui.card}>
            <EmptyState illustration="vacio-anuncios" title={listings === null ? 'Cargando…' : 'Aún no hay anuncios'}>
              {listings !== null && 'Aparecerán aquí tras la primera sincronización de la extensión.'}
            </EmptyState>
          </div>
        ) : (
          <TableCard minWidth={940}>
            <thead>
              <tr>
                <th className={`${ui.th} min-w-[280px]`}>Anuncio</th>
                <th className={`${ui.th} text-right`}>Precio</th>
                <th className={`${ui.th} text-right`} title="Precio medio de ese artículo en Vinted">
                  Mercado
                </th>
                <th className={`${ui.th} text-right`}>Favs</th>
                <th className={`${ui.th} text-right`}>Sin ofertar</th>
                <th className={`${ui.th} text-right`}>Días</th>
                <th className={ui.th}>Estado</th>
                <th className={ui.th}>Item de inventario</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((listing) => (
                <tr key={listing.id} className={ui.tr}>
                  <td className={ui.td}>
                    <div className="flex items-center gap-3">
                      <Thumb src={listing.photo} />
                      <div className="min-w-0">
                        <a
                          href={listing.url ?? `https://www.vinted.es/items/${listing.vinted_id}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="group inline-flex items-center gap-1.5 font-semibold hover:text-accent"
                        >
                          {listing.title}
                          <ExternalLink size={13} aria-hidden="true" className="text-faint group-hover:text-accent" />
                        </a>
                        <span className="block text-xs text-muted">
                          {[
                            listing.brand,
                            listing.size && `Talla ${listing.size}`,
                            listing.condition,
                            `${listing.views} ${listing.views === 1 ? 'vista' : 'vistas'}`,
                            `publicado ${shortDate(listing.listed_at)}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className={`${ui.td} text-right font-semibold`}>{eur(listing.price)}</td>
                  <td className={`${ui.td} text-right`}>
                    <MarketCell market={listing.market} pending={FILTERS.en_venta.test(listing)} />
                  </td>
                  <td className={`${ui.td} text-right`}>
                    <span className="inline-flex items-center gap-1">
                      <Heart size={13} aria-hidden="true" className={listing.favs > 0 ? 'fill-pink-ink text-pink-ink' : 'text-faint'} />
                      {listing.favs}
                    </span>
                  </td>
                  <td className={`${ui.td} whitespace-nowrap text-right`}>
                    <OfferCell
                      row={planByListing.get(listing.id)}
                      discount={discount}
                      disabled={commandActive}
                      onOffer={() => setDialog({ type: 'send_offers', listingId: listing.id })}
                    />
                  </td>
                  <td className={`${ui.td} text-right ${listing.stale ? 'font-semibold text-pink' : ''}`}>
                    {listing.days_listed ?? '—'}
                  </td>
                  <td className={ui.td}>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONES[listing.status] ?? 'neutral'}>
                        {LISTING_STATUS_LABELS[listing.status] ?? listing.status}
                      </Badge>
                      {listing.stale && <Badge tone="pink">Estancado</Badge>}
                    </span>
                  </td>
                  <td className={ui.td}>
                    <select
                      aria-label={`Item de inventario enlazado a ${listing.title}`}
                      className={`${ui.selectSm} w-full max-w-[170px]`}
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
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-muted">
                    Ningún anuncio en este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </TableCard>
        )}
        <p className="max-w-[80ch] text-xs leading-relaxed text-muted">
          Estancado = en venta más días que <code>STALE_DAYS</code>. La fecha de publicación es la de subida de la
          primera foto. Mercado = precio medio en Vinted de la búsqueda que mejor encaja con el título (la extensión mide
          sola las palabras clave de cada anuncio en venta); «caro» o «barato» si te separas más de un 15 % de la media.
        </p>
      </div>

      <RepricingPanel rows={repricing} />

      {linking && (
        <LinkSuggestionsDialog
          suggestions={suggestions}
          listings={all}
          items={items}
          onClose={() => setLinking(false)}
          onDone={(linked) => {
            setLinking(false);
            setNotice(linked === 1 ? '1 anuncio enlazado.' : `${linked} anuncios enlazados.`);
            void reload();
          }}
        />
      )}

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
    </Page>
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
  if (!row || row.pending === 0) return <span className="text-faint">—</span>;
  if (row.blocker !== null) {
    return (
      <span className="text-muted" title={`No se puede ofertar: ${row.blocker}`}>
        {row.pending} · bloqueado
      </span>
    );
  }
  return (
    <button
      type="button"
      className={ui.link}
      disabled={disabled}
      onClick={onOffer}
      title={`Oferta del −${discount} % a ${row.pending} ${row.pending === 1 ? 'favorito' : 'favoritos'}`}
    >
      Ofertar a {row.pending}
    </button>
  );
}
