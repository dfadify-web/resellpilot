import { MARKET_UNDERCUT_PCT, MARKET_VERDICT_LABELS, type ListingMarket, type MarketVerdict } from '@resellpilot/shared';
import { eur, shortDate } from '../format';
import { Badge, type BadgeTone } from './kit';

const VERDICT_TONES: Record<MarketVerdict, BadgeTone> = {
  caro: 'pink',
  en_precio: 'outline',
  barato: 'accent',
};

/** "+18 %" · "−12 %". */
export const diffText = (diff: number): string => {
  const value = Math.round(diff * 100);
  return value > 0 ? `+${value} %` : value < 0 ? `−${Math.abs(value)} %` : '0 %';
};

/** Explicación de dónde sale la media, para el `title`. */
export const marketTitle = (market: ListingMarket): string =>
  `Media de Vinted para «${market.query}» (${market.listings_count} anuncios, medida el ${shortDate(market.computed_at)}). ` +
  `Para vender un poco antes: ${eur(market.suggested_price)} (−${MARKET_UNDERCUT_PCT} %).`;

/** Precio medio en Vinted del mismo artículo y si el anuncio está caro, en precio o barato. */
export function MarketCell({ market, pending }: { market: ListingMarket | null; pending: boolean }) {
  if (!market) {
    return pending ? (
      <span className="text-xs text-faint" title="La extensión lo medirá en las próximas sincronizaciones (necesita al menos 2 palabras clave en el título).">
        Midiendo…
      </span>
    ) : (
      <span className="text-faint">—</span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1" title={marketTitle(market)}>
      <span className="font-semibold">{eur(market.avg_price)}</span>
      {market.verdict && market.diff !== null ? (
        <Badge tone={VERDICT_TONES[market.verdict]}>
          {market.verdict === 'en_precio' ? MARKET_VERDICT_LABELS.en_precio : `${MARKET_VERDICT_LABELS[market.verdict]} ${diffText(market.diff)}`}
        </Badge>
      ) : (
        <span className="text-[11px] text-faint">pocos anuncios</span>
      )}
    </span>
  );
}
