import type { RepricingRow } from '@resellpilot/shared';
import { useState } from 'react';
import { eur, signedEur, vintedEditUrl } from '../format';
import { ui } from '../ui';

const priceText = (price: number): string => price.toFixed(2).replace('.', ',');

/**
 * Bajadas de precio sugeridas para los anuncios stale. ResellPilot no cambia el precio:
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
      // Sin portapapeles: el precio sugerido sigue a la vista en la tabla.
    }
    window.open(vintedEditUrl(row.vinted_id), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="mt-10">
      <h2 className="font-display text-3xl font-bold uppercase">Bajadas de precio sugeridas</h2>
      <p className="mt-1 max-w-prose text-xs text-muted">
        Anuncios que llevan en venta más de <code>STALE_DAYS</code> días: −5 % al principio y −10 % a partir del doble
        de ese plazo. «Editar en Vinted» copia el precio nuevo y abre el anuncio: lo cambias tú y la siguiente sync lo
        registra. Tras una bajada, el anuncio no vuelve a aparecer aquí hasta que pase otra vez ese plazo.
      </p>
      <div className="mt-3 overflow-x-auto border border-line">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="border-b border-line bg-panel">
            <tr>
              <th className={`${ui.th} min-w-[240px]`}>Anuncio</th>
              <th className={`${ui.th} text-right`}>Días</th>
              <th className={`${ui.th} text-right`}>Favs</th>
              <th className={`${ui.th} text-right`}>Precio</th>
              <th className={`${ui.th} text-right`}>−5 %</th>
              <th className={`${ui.th} text-right`}>−10 %</th>
              <th className={`${ui.th} text-right`}>Sugerido</th>
              <th className={`${ui.th} text-right`}>Margen</th>
              <th className={`${ui.th} text-right`}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.listing_id} className="border-b border-line last:border-b-0 hover:bg-panel">
                <td className={ui.td}>
                  <span className="font-semibold">{row.title}</span>
                  {row.item_name && <span className="block text-xs text-muted">{row.item_name}</span>}
                </td>
                <td className={`${ui.td} text-right`}>{row.days_listed}</td>
                <td className={`${ui.td} text-right`}>{row.favs}</td>
                <td className={`${ui.td} text-right`}>{eur(row.price)}</td>
                <td className={`${ui.td} text-right text-muted`}>{eur(row.price_minus_5)}</td>
                <td className={`${ui.td} text-right text-muted`}>{eur(row.price_minus_10)}</td>
                <td className={`${ui.td} whitespace-nowrap text-right font-semibold`}>
                  {eur(row.new_price)} <span className="text-xs font-normal text-muted">−{row.pct} %</span>
                </td>
                <td
                  className={`${ui.td} whitespace-nowrap text-right ${row.below_cost ? 'font-semibold text-accent' : ''}`}
                  title={row.total_cost === null ? 'Enlaza el anuncio con su item para ver el margen' : `Coste total ${eur(row.total_cost)}`}
                >
                  {row.margin === null ? '—' : signedEur(row.margin)}
                  {row.below_cost && <span className="block text-[10px] uppercase tracking-[0.12em]">Bajo coste</span>}
                </td>
                <td className={`${ui.td} whitespace-nowrap text-right`}>
                  <button type="button" className={`${ui.link} text-paper`} onClick={() => void open(row)}>
                    {copied === row.listing_id ? `Copiado ${priceText(row.new_price)}` : 'Editar en Vinted ↗'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
