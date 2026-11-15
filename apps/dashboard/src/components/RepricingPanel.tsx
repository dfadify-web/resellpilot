import type { RepricingRow } from '@resellpilot/shared';
import { Check, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { eur, signedEur, vintedEditUrl } from '../format';
import { ui } from '../ui';
import { Badge, Card, CardHeader } from './kit';

const priceText = (price: number): string => price.toFixed(2).replace('.', ',');

/**
 * Bajadas de precio sugeridas para los anuncios estancados. ResellPilot no cambia el precio:
 * copia el nuevo y abre la edición del anuncio en Vinted; la siguiente sync registra la bajada.
 */
export function RepricingPanel({ rows }: { rows: RepricingRow[] }) {
  const [copied, setCopied] = useState<number | null>(null);
  if (rows.length === 0) return null;

  async function open(row: RepricingRow) {
    try {
      await navigator.clipboard.writeText(priceText(row.new_price));
      setCopied(row.listing_id);
      setTimeout(() => setCopied((current) => (current === row.listing_id ? null : current)), 4000);
    } catch {
      // Sin portapapeles: el precio sugerido sigue a la vista.
    }
    window.open(vintedEditUrl(row.vinted_id), '_blank', 'noopener,noreferrer');
  }

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
              <div className="min-w-0">
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
            <button type="button" className={`${ui.secondary} h-9 self-start`} onClick={() => void open(row)}>
              {copied === row.listing_id ? (
                <>
                  <Check size={15} aria-hidden="true" /> Copiado {priceText(row.new_price)} €
                </>
              ) : (
                <>
                  <ExternalLink size={15} aria-hidden="true" /> Editar en Vinted
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
