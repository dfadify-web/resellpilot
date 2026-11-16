import type { RepricingRow } from '@resellpilot/shared';
import { Check, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { eur, signedEur, vintedEditUrl } from '../format';
import { ui } from '../ui';
import { Badge, Card, CardHeader, Thumb } from './kit';
import { diffText, marketTitle } from './MarketCell';

const priceText = (price: number): string => price.toFixed(2).replace('.', ',');

/**
 * Precio de mercado (media de Vinted −10 %) como alternativa a la bajada fija, solo si baja el precio
 * actual, es distinto de la bajada sugerida y no deja el anuncio por debajo del coste.
 */
function marketAlternative(row: RepricingRow): number | null {
  const price = row.market?.suggested_price;
  if (price === undefined || row.market?.verdict === null || price >= row.price || price === row.new_price) return null;
  if (row.total_cost !== null && price < row.total_cost) return null;
  return price;
}

/**
 * Bajadas de precio sugeridas para los anuncios estancados. ResellPilot no cambia el precio:
 * copia el nuevo y abre la edición del anuncio en Vinted; la siguiente sync registra la bajada.
 */
export function RepricingPanel({ rows }: { rows: RepricingRow[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (rows.length === 0) return null;

  async function open(row: RepricingRow, price: number) {
    const key = `${row.listing_id}:${price}`;
    try {
      await navigator.clipboard.writeText(priceText(price));
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 4000);
    } catch {
      // Sin portapapeles: el precio sugerido sigue a la vista.
    }
    window.open(vintedEditUrl(row.vinted_id), '_blank', 'noopener,noreferrer');
  }

  const alternatives = new Map<number, number>();
  for (const row of rows) {
    const alternative = marketAlternative(row);
    if (alternative !== null) alternatives.set(row.listing_id, alternative);
  }

  const button = (row: RepricingRow, price: number, label: string, primary: boolean) => (
    <button type="button" className={`${primary ? ui.secondary : ui.ghost} h-9`} onClick={() => void open(row, price)}>
      {copied === `${row.listing_id}:${price}` ? (
        <>
          <Check size={15} aria-hidden="true" /> Copiado {priceText(price)} €
        </>
      ) : (
        <>
          <ExternalLink size={15} aria-hidden="true" /> {label}
        </>
      )}
    </button>
  );

  return (
    <Card as="section">
      <CardHeader
        illustration="bajada-precio"
        title="Bajadas de precio sugeridas"
        description={
          <>
            −5 % al pasar <code>STALE_DAYS</code> días y −10 % al doble. «Editar en Vinted» copia el precio nuevo y abre
            el anuncio: lo cambias tú y la sync lo registra. Tras una bajada, el anuncio descansa otro plazo.
          </>
        }
      />
      <ul className="mt-4 grid grid-cols-1 gap-3 p-5 pt-0 lg:grid-cols-2">
        {rows.map((row) => (
          <li key={row.listing_id} className="flex flex-col gap-3 rounded-2xl border border-line bg-bg/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <Thumb src={row.photo} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{row.title}</p>
                <p className="text-xs text-muted">
                  {row.days_listed} días publicado · {row.favs} favoritos{row.item_name ? ` · ${row.item_name}` : ''}
                </p>
              </div>
              <Badge tone={row.pct === 10 ? 'pinkSolid' : 'pink'}>−{row.pct} %</Badge>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="flex items-baseline gap-2">
                <span className="text-sm text-faint line-through">{eur(row.price)}</span>
                <span className={`${ui.num} text-[28px] leading-none`}>{eur(row.new_price)}</span>
              </p>
              <p
                className={`text-xs ${row.below_cost ? 'font-semibold text-pink' : 'text-muted'}`}
                title={row.total_cost === null ? 'Enlaza el anuncio con su item para ver el margen' : `Coste total ${eur(row.total_cost)}`}
              >
                {row.margin === null ? 'Sin item enlazado' : `Te quedan ${signedEur(row.margin)}`}
                {row.below_cost && ' · por debajo del coste'}
              </p>
            </div>
            {row.market && (
              <p className="text-xs text-muted" title={marketTitle(row.market)}>
                Media en Vinted: <span className="font-semibold text-ink">{eur(row.market.avg_price)}</span>
                {row.market.diff !== null && ` · tu precio ${diffText(row.market.diff)}`}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {button(row, row.new_price, 'Editar en Vinted', true)}
              {alternatives.get(row.listing_id) !== undefined &&
                button(row, alternatives.get(row.listing_id) as number, `Precio de mercado ${eur(alternatives.get(row.listing_id) ?? null)}`, false)}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
