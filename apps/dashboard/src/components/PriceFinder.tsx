import { estPriceFromTrend, undercutPrice, type TrendView } from '@resellpilot/shared';
import { CircleAlert, LoaderCircle, ScanSearch, Sparkles } from 'lucide-react';
import { eur } from '../format';
import { ui } from '../ui';
import type { PriceSearch } from '../usePriceSearch';

interface Props {
  search: PriceSearch;
  /** Tendencia ya medida que coincide con el nombre (sin buscar). */
  matched: TrendView | null;
  undercutPct: number;
  onUse: (price: number) => void;
}

/** Precio que se propone a partir de una tendencia: media − X %. Sin media, el estimado clásico. */
export function suggestedPrice(trend: TrendView, undercutPct: number): number | null {
  if (trend.avg_price !== null) return undercutPrice(trend.avg_price, undercutPct);
  return estPriceFromTrend(trend);
}

function TrendCard({ trend, undercutPct, onUse, fresh }: { trend: TrendView; undercutPct: number; onUse: (price: number) => void; fresh: boolean }) {
  const price = suggestedPrice(trend, undercutPct);
  return (
    <div className="mt-2 animate-rise rounded-2xl border border-accent/30 bg-accent-soft p-4 text-[13px]">
      <p className="flex items-center gap-2 font-semibold text-accent">
        <Sparkles size={15} aria-hidden="true" />
        {fresh ? 'Precio encontrado en Vinted' : 'Ya medido en Tendencias'} · «{trend.query}»
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {(
          [
            ['Precio medio', eur(trend.avg_price)],
            ['Mediana', eur(trend.median_price)],
            ['Anuncios', trend.listings_count >= 500 ? '500+' : String(trend.listings_count)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl bg-surface/70 px-3 py-2">
            <dt className="text-[11px] font-medium text-muted">{label}</dt>
            <dd className={`${ui.num} text-lg`}>{value}</dd>
          </div>
        ))}
      </dl>
      {price !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1">
            Para vender un poco más barato que la media (−{undercutPct} %):{' '}
            <strong className={`${ui.num} text-base`}>{eur(price)}</strong>
          </p>
          <button type="button" className={`${ui.primary} h-9`} onClick={() => onUse(price)}>
            Usar {eur(price)}
          </button>
        </div>
      )}
      {trend.favs_per_day !== null && (
        <p className="mt-2 text-xs text-muted">
          Demanda: {trend.favs_per_day.toLocaleString('es-ES', { maximumFractionDigits: 2 })} favoritos al día por anuncio parecido.
        </p>
      )}
    </div>
  );
}

/** Resultado del buscador de precio de la Calculadora. */
export function PriceFinder({ search, matched, undercutPct, onUse }: Props) {
  if (search.phase === 'waiting') {
    return (
      <div className="mt-2 rounded-2xl border border-line bg-sunken p-4 text-[13px]" role="status">
        <p className="flex items-center gap-2 font-semibold">
          <LoaderCircle size={15} aria-hidden="true" className="animate-spin text-accent" />
          Buscando «{search.query}» en Vinted…
        </p>
        <p className="mt-1 text-muted">La extensión lo hace en tu pestaña de vinted.es en menos de un minuto.</p>
        {search.warning && <p className="mt-2 font-medium text-pink">{search.warning}</p>}
      </div>
    );
  }
  if (search.phase === 'error') {
    return (
      <p className="mt-2 flex gap-2 rounded-2xl border border-pink/30 bg-pink-soft p-3 text-[13px]" role="alert">
        <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-pink" />
        {search.message}
      </p>
    );
  }
  if (search.phase === 'done') return <TrendCard trend={search.trend} undercutPct={undercutPct} onUse={onUse} fresh />;
  if (matched) return <TrendCard trend={matched} undercutPct={undercutPct} onUse={onUse} fresh={false} />;
  return (
    <p className={`${ui.help} flex items-center gap-1.5`}>
      <ScanSearch size={13} aria-hidden="true" />
      Pulsa «Buscar precio» y ResellPilot mira en Vinted a cuánto se vende de media.
    </p>
  );
}
