import type { TrendOrigin, TrendView } from '@resellpilot/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError, type TrendsResponse } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { eur, num } from '../format';
import { ui, usePageTitle } from '../ui';

const ORIGIN_LABELS: Record<TrendOrigin, string> = { semilla: 'Semilla', item: 'Item', deal: 'Deal' };
const REFRESH_MS = 30_000;

const signedPct = (ratio: number | null): string => {
  if (ratio === null) return '—';
  const value = Math.round(ratio * 100);
  return `${value > 0 ? '+' : ''}${value} %`;
};

const ago = (iso: string | null): string => {
  if (!iso) return 'Pendiente';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
};

export function Tendencias() {
  usePageTitle('Tendencias');

  const [data, setData] = useState<TrendsResponse | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api.trends());
    } catch (error) {
      setProblem(describeError(error));
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  /** Copia la consulta y abre la web de enlaces (ni Hacoo ni esa web admiten búsqueda por URL). */
  async function searchSource(trend: TrendView) {
    if (!data) return;
    const template = data.hacoo_search_url;
    const url = template.includes('{query}') ? template.replace('{query}', encodeURIComponent(trend.query)) : template;
    let copied = false;
    try {
      await navigator.clipboard.writeText(trend.query);
      copied = true;
    } catch {
      // Sin permiso de portapapeles: se abre igualmente.
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    setNotice(copied ? `«${trend.query}» copiado: pégalo en el buscador de la web que se ha abierto.` : null);
  }

  const trends = data?.trends ?? [];
  const measured = trends.filter((trend) => trend.computed_at !== null);

  return (
    <section className="px-6 py-8 md:px-12 md:py-12">
      <p className={ui.eyebrow}>05 / 07</p>
      <h1 className={ui.h1}>Tendencias</h1>

      <div className="mt-8 space-y-3">
        <ErrorNote problem={problem} />
        {notice && (
          <p role="status" className="border border-line px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        {data && (
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">
            {measured.length} de {trends.length} búsquedas medidas
            {data.due > 0 && <span className="text-paper"> · {data.due} en la próxima sync de la extensión</span>}
          </p>
        )}
      </div>

      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead className="border-b border-line bg-panel">
            <tr>
              <th className={`${ui.th} w-8 text-right`}>#</th>
              <th className={`${ui.th} min-w-[220px]`}>Búsqueda</th>
              <th className={`${ui.th} text-right`}>Favs / día</th>
              <th className={`${ui.th} text-right`}>vs semana ant.</th>
              <th className={`${ui.th} text-right`}>Mediana</th>
              <th className={`${ui.th} text-right`}>P25</th>
              <th className={`${ui.th} text-right`}>Venta est.</th>
              <th className={`${ui.th} text-right`}>Anuncios</th>
              <th className={`${ui.th} text-right`}>Favs medios</th>
              <th className={ui.th}>Medido</th>
              <th className={`${ui.th} text-right`}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {trends.map((trend, index) => (
              <tr key={trend.query} className="border-b border-line last:border-b-0 hover:bg-panel">
                <td className={`${ui.td} text-right text-muted`}>{trend.computed_at ? index + 1 : '—'}</td>
                <td className={ui.td}>
                  <a
                    href={`https://www.vinted.es/catalog?search_text=${encodeURIComponent(trend.query)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-semibold hover:text-accent"
                  >
                    {trend.query} <span aria-hidden="true">↗</span>
                  </a>
                  <span className="block text-[10px] uppercase tracking-[0.12em] text-muted">
                    {trend.origins.map((origin) => ORIGIN_LABELS[origin]).join(' · ')}
                  </span>
                </td>
                <td className={`${ui.td} text-right font-display text-xl font-bold`}>
                  {trend.favs_per_day === null ? '—' : trend.favs_per_day.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                </td>
                <td
                  className={`${ui.td} text-right ${
                    trend.week_change !== null && trend.week_change > 0 ? 'font-semibold text-accent' : ''
                  }`}
                >
                  {signedPct(trend.week_change)}
                </td>
                <td className={`${ui.td} text-right`}>{eur(trend.median_price)}</td>
                <td className={`${ui.td} text-right`}>{eur(trend.p25_price)}</td>
                <td className={`${ui.td} text-right font-semibold`}>{eur(trend.est_price)}</td>
                <td className={`${ui.td} text-right`}>
                  {trend.computed_at === null ? '—' : trend.listings_count >= 500 ? '500+' : trend.listings_count}
                </td>
                <td className={`${ui.td} text-right`}>{num(trend.avg_favs)}</td>
                <td className={`${ui.td} whitespace-nowrap text-muted`}>
                  {ago(trend.computed_at)}
                  {trend.pending && trend.computed_at !== null && <span className="ml-1 text-paper">· caducada</span>}
                </td>
                <td className={`${ui.td} whitespace-nowrap text-right`}>
                  <button type="button" className={`${ui.link} text-paper`} onClick={() => void searchSource(trend)}>
                    Buscar en Hacoo
                  </button>
                </td>
              </tr>
            ))}
            {trends.length === 0 && (
              <tr>
                <td className="px-3 py-10 text-center text-muted" colSpan={11}>
                  {data === null ? (
                    'Cargando…'
                  ) : (
                    <>
                      No hay búsquedas que medir. Añade queries semilla en{' '}
                      <Link to="/ajustes" className="text-paper underline">
                        Ajustes
                      </Link>
                      , o registra items y oportunidades: de sus títulos salen búsquedas automáticas.
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 max-w-prose space-y-2 text-xs text-muted">
        <p>
          Cada búsqueda es la primera página de resultados públicos de vinted.es, leída por la extensión. Se repite
          como mucho cada <code>TRENDS_CACHE_H</code> horas y sin pasar de <code>TRENDS_MAX_REQ_PER_HOUR</code>.
        </p>
        <p>
          <strong className="text-paper">Favs / día es una estimación</strong>: Vinted no muestra la fecha de
          publicación en los resultados, así que la antigüedad de cada anuncio se calcula a partir de su número de
          id (Vinted crea unos 13 millones de ids al día). Sirve para comparar búsquedas entre sí, no como cifra
          exacta. «Venta est.» = (P25 + mediana) / 2 y es lo que se aplica a las oportunidades.
        </p>
        <p>
          «Buscar en Hacoo» copia la búsqueda y abre tu web de enlaces: Hacoo solo tiene buscador dentro de su app.
          Puedes cambiar la URL en Ajustes.
        </p>
      </div>
    </section>
  );
}
