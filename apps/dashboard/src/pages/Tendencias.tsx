import type { TrendOrigin, TrendView } from '@resellpilot/shared';
import { ArrowDownRight, ArrowUpRight, ExternalLink, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError, type TrendsResponse } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { Badge, Card, EmptyState, IconButton, Notice, Page, PageHeader, TableCard } from '../components/kit';
import { eur, num } from '../format';
import { ui, usePageTitle } from '../ui';

const ORIGIN_LABELS: Record<TrendOrigin, string> = { semilla: 'Semilla', item: 'Item', deal: 'Oportunidad' };
const REFRESH_MS = 30_000;

const ago = (iso: string | null): string => {
  if (!iso) return 'Pendiente';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
};

function Change({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-faint">—</span>;
  const value = Math.round(ratio * 100);
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${up ? 'text-accent' : value < 0 ? 'text-pink' : 'text-muted'}`}>
      {value !== 0 && <Icon size={14} aria-hidden="true" />}
      {up ? '+' : ''}
      {value} %
    </span>
  );
}

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
  const maxDemand = Math.max(0.0001, ...measured.map((trend) => trend.favs_per_day ?? 0));

  return (
    <Page>
      <PageHeader
        eyebrow={data ? `${measured.length} de ${trends.length} búsquedas medidas` : 'Demanda en Vinted'}
        title="Tendencias"
        description="Qué se busca y se guarda en favoritos en Vinted, y a qué precio se vende. Úsalo antes de comprar un lote."
        illustration="tendencias"
        actions={
          data && data.due > 0 ? <Badge tone="accent">{data.due} en la próxima sync de la extensión</Badge> : undefined
        }
      />

      <ErrorNote problem={problem} />
      {notice && <Notice>{notice}</Notice>}

      {trends.length === 0 ? (
        <div className={ui.card}>
          <EmptyState illustration="tendencias" title={data === null ? 'Cargando…' : 'No hay búsquedas que medir'}>
            {data !== null && (
              <>
                Añade queries semilla en <Link to="/ajustes" className={ui.link}>Ajustes</Link>, o registra items y
                oportunidades: de sus títulos salen búsquedas automáticas.
              </>
            )}
          </EmptyState>
        </div>
      ) : (
        <TableCard minWidth={900}>
          <thead>
            <tr>
              <th className={`${ui.th} w-10 text-right`}>#</th>
              <th className={`${ui.th} min-w-[220px]`}>Búsqueda</th>
              <th className={`${ui.th} min-w-[170px]`}>Favs / día</th>
              <th className={`${ui.th} text-right`}>vs semana ant.</th>
              <th className={`${ui.th} text-right`}>Mediana · P25</th>
              <th className={`${ui.th} text-right`}>Venta est.</th>
              <th className={`${ui.th} text-right`}>Anuncios</th>
              <th className={ui.th}>Medido</th>
              <th className={`${ui.th} text-right`}>
                <span className="sr-only">Acción</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {trends.map((trend, index) => (
              <tr key={trend.query} className={ui.tr}>
                <td className={`${ui.td} text-right text-faint`}>{trend.computed_at ? index + 1 : '—'}</td>
                <td className={ui.td}>
                  <a
                    href={`https://www.vinted.es/catalog?search_text=${encodeURIComponent(trend.query)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group inline-flex items-center gap-1.5 font-semibold hover:text-accent"
                  >
                    {trend.query}
                    <ExternalLink size={12} aria-hidden="true" className="text-faint group-hover:text-accent" />
                  </a>
                  <span className="mt-1 flex gap-1">
                    {trend.origins.map((origin) => (
                      <Badge key={origin} tone="neutral">
                        {ORIGIN_LABELS[origin]}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className={ui.td}>
                  {trend.favs_per_day === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <span className="flex items-center gap-3">
                      <span className={`${ui.num} w-12 text-lg`}>
                        {trend.favs_per_day.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${(trend.favs_per_day / maxDemand) * 100}%` }} />
                      </span>
                    </span>
                  )}
                </td>
                <td className={`${ui.td} text-right`}>
                  <Change ratio={trend.week_change} />
                </td>
                <td className={`${ui.td} whitespace-nowrap text-right text-muted`}>
                  {eur(trend.median_price)}
                  <span className="block text-xs text-faint">{eur(trend.p25_price)}</span>
                </td>
                <td className={`${ui.td} text-right font-semibold`}>{eur(trend.est_price)}</td>
                <td className={`${ui.td} text-right`}>
                  {trend.computed_at === null ? '—' : trend.listings_count >= 500 ? '500+' : trend.listings_count}
                  {trend.avg_favs !== null && <span className="block text-xs text-faint">{num(trend.avg_favs)} favs/anuncio</span>}
                </td>
                <td className={`${ui.td} whitespace-nowrap text-xs text-muted`}>
                  {ago(trend.computed_at)}
                  {trend.pending && trend.computed_at !== null && <span className="ml-1 text-pink">· caducada</span>}
                </td>
                <td className={`${ui.td} whitespace-nowrap text-right`}>
                  <IconButton label={`Buscar «${trend.query}» en Hacoo`} icon={Search} onClick={() => void searchSource(trend)} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      <Card className="grid gap-4 p-5 text-[13px] leading-relaxed text-muted md:grid-cols-3">
        <p>
          <strong className="block font-display text-base font-semibold text-ink">De dónde salen</strong>
          Primera página de resultados públicos de vinted.es, leída por la extensión. Cada búsqueda se repite como mucho
          cada <code>TRENDS_CACHE_H</code> horas.
        </p>
        <p>
          <strong className="block font-display text-base font-semibold text-ink">Favs / día es una estimación</strong>
          Vinted no muestra la fecha de publicación: la antigüedad se calcula por el número de id. Sirve para comparar
          búsquedas, no como cifra exacta.
        </p>
        <p>
          <strong className="block font-display text-base font-semibold text-ink">Venta estimada</strong>
          (P25 + mediana) / 2. Es el precio que se aplica a las oportunidades. «Buscar en Hacoo» copia la búsqueda y abre
          tu web de enlaces.
        </p>
      </Card>
    </Page>
  );
}
