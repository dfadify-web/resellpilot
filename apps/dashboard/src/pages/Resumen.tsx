import { STOCK_LABELS, STOCK_STATES } from '@resellpilot/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError, type SummaryResponse } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { eur, monthName, num, pct, shortDate, signedEur } from '../format';
import { ui, usePageTitle } from '../ui';

interface KpiProps {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}

function Kpi({ label, value, note, accent = false }: KpiProps) {
  return (
    <div className="border-b border-line px-5 py-5 sm:border-r xl:border-b-0 xl:last:border-r-0">
      <p className={ui.eyebrow}>{label}</p>
      <p
        className={`mt-2 font-display text-6xl font-bold leading-none tracking-tight ${accent ? 'text-accent' : ''}`}
      >
        {value}
      </p>
      <p className="mt-2 text-xs text-muted">{note}</p>
    </div>
  );
}

export function Resumen() {
  usePageTitle('Resumen');
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .summary()
      .then((data) => alive && setSummary(data))
      .catch((error: unknown) => alive && setProblem(describeError(error)));
    return () => {
      alive = false;
    };
  }, []);

  const maxCount = summary ? Math.max(1, ...Object.values(summary.by_stock)) : 1;
  const sales = (n: number) => (n === 1 ? '1 venta' : `${n} ventas`);

  return (
    <section className="px-6 py-8 md:px-12 md:py-12">
      <p className={ui.eyebrow}>01 / 07</p>
      <h1 className={ui.h1}>Resumen</h1>

      <div className="mt-8">
        <ErrorNote problem={problem} />
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-1 border border-line sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label={`Beneficio · ${monthName(summary.month)}`}
              value={signedEur(summary.month_profit)}
              note={`${sales(summary.month_sales)} este mes · total histórico ${signedEur(summary.total_profit)}`}
              accent={summary.month_profit > 0}
            />
            <Kpi
              label="Capital inmovilizado"
              value={eur(summary.tied_capital)}
              note="Comprado y aún sin vender"
            />
            <Kpi
              label="Rotación media"
              value={summary.avg_rotation_days === null ? '—' : `${num(summary.avg_rotation_days)} d`}
              note={
                summary.total_sales === 0
                  ? 'Sin ventas todavía'
                  : `Días del alta a la venta · ${sales(summary.total_sales)}`
              }
            />
            <Kpi label="Items" value={String(summary.total_items)} note="En todos los estados" />
          </div>

          <div className="mt-10 grid grid-cols-1 gap-10 xl:grid-cols-2">
            <div>
              <h2 className="font-display text-3xl font-bold uppercase">Items por estado</h2>
              <table className="mt-3 w-full border-collapse border border-line text-sm">
                <tbody>
                  {STOCK_STATES.map((state) => {
                    const total = summary.by_stock[state];
                    return (
                      <tr key={state} className="border-b border-line last:border-b-0">
                        <th scope="row" className={`${ui.th} w-32 whitespace-nowrap`}>
                          {STOCK_LABELS[state]}
                        </th>
                        <td className="px-3 py-2">
                          <div
                            aria-hidden="true"
                            className={`h-2 ${state === 'vendido' ? 'bg-accent' : 'bg-muted'}`}
                            style={{ width: `${(total / maxCount) * 100}%` }}
                          />
                        </td>
                        <td className="w-12 px-3 py-2 text-right font-semibold">{total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <h2 className="font-display text-3xl font-bold uppercase">Últimas ventas</h2>
              <div className="mt-3 overflow-x-auto border border-line">
                <table className="w-full border-collapse text-sm">
                  <thead className="border-b border-line bg-panel">
                    <tr>
                      <th className={ui.th}>Item</th>
                      <th className={ui.th}>Fecha</th>
                      <th className={`${ui.th} text-right`}>Venta</th>
                      <th className={`${ui.th} text-right`}>Beneficio</th>
                      <th className={`${ui.th} text-right`}>ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recent_sales.map((item) => (
                      <tr key={item.id} className="border-b border-line last:border-b-0">
                        <td className={`${ui.td} font-semibold`}>{item.name}</td>
                        <td className={`${ui.td} text-muted`}>{shortDate(item.sold_at)}</td>
                        <td className={`${ui.td} text-right`}>{eur(item.sold_price)}</td>
                        <td
                          className={`${ui.td} text-right font-semibold ${
                            item.profit !== null && item.profit > 0 ? 'text-accent' : ''
                          }`}
                        >
                          {signedEur(item.profit)}
                        </td>
                        <td className={`${ui.td} text-right`}>{pct(item.roi)}</td>
                      </tr>
                    ))}
                    {summary.recent_sales.length === 0 && (
                      <tr>
                        <td className="px-3 py-8 text-center text-muted" colSpan={5}>
                          Aún no hay ventas. Registra una compra en{' '}
                          <Link to="/inventario" className="text-paper underline">
                            Inventario
                          </Link>{' '}
                          y márcala vendida.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {!summary && !problem && <p className="text-sm text-muted">Cargando…</p>}
    </section>
  );
}
