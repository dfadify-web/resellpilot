import { STOCK_LABELS, STOCK_STATES } from '@resellpilot/shared';
import { Boxes, CircleDollarSign, Clock3, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError, type SummaryResponse } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { Badge, Card, CardHeader, EmptyState, Kpi, Page, PageHeader } from '../components/kit';
import { ReportsPanel } from '../components/ReportsPanel';
import { eur, monthName, num, pct, shortDate, signedEur } from '../format';
import { ui, usePageTitle } from '../ui';

const sales = (n: number) => (n === 1 ? '1 venta' : `${n} ventas`);

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
  const month = summary ? monthName(summary.month) : '';

  return (
    <Page>
      <PageHeader
        eyebrow={month || 'Resumen'}
        title="Cómo va tu reventa"
        description="Beneficio real, dinero parado en stock y lo rápido que vendes. Todo sale de tu inventario."
        illustration="dinero"
      />

      <ErrorNote problem={problem} />
      {!summary && !problem && <p className="text-sm text-muted">Cargando…</p>}

      {summary && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              tone="feature"
              icon={CircleDollarSign}
              label="Beneficio del mes"
              value={signedEur(summary.month_profit)}
              note={`${sales(summary.month_sales)} este mes · ${signedEur(summary.total_profit)} en total`}
            />
            <Kpi icon={Wallet} label="Capital inmovilizado" value={eur(summary.tied_capital)} note="Comprado y aún sin vender" />
            <Kpi
              icon={Clock3}
              label="Rotación media"
              value={summary.avg_rotation_days === null ? '—' : `${num(summary.avg_rotation_days)} d`}
              note={summary.total_sales === 0 ? 'Sin ventas todavía' : `Del alta a la venta · ${sales(summary.total_sales)}`}
            />
            <Kpi icon={Boxes} label="Items" value={String(summary.total_items)} note="En todos los estados" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Card>
              <CardHeader title="Items por estado" description="Dónde está cada cosa que has comprado." />
              <ul className="space-y-3 px-5 pb-5 pt-4">
                {STOCK_STATES.map((state) => {
                  const total = summary.by_stock[state];
                  return (
                    <li key={state} className="grid grid-cols-[96px_1fr_32px] items-center gap-3 text-sm">
                      <span className="text-muted">{STOCK_LABELS[state]}</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                        <span
                          className={`block h-full rounded-full transition-[width] duration-700 ${
                            state === 'vendido' ? 'bg-accent' : state === 'devuelto' ? 'bg-pink-ink' : 'bg-line-strong'
                          }`}
                          style={{ width: `${(total / maxCount) * 100}%` }}
                        />
                      </span>
                      <span className="text-right font-semibold tabular-nums">{total}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card>
              <CardHeader
                title="Últimas ventas"
                description="Las cinco más recientes, con su beneficio real."
                actions={
                  <Link to="/inventario" className={ui.link}>
                    Ver inventario
                  </Link>
                }
              />
              {summary.recent_sales.length === 0 ? (
                <EmptyState illustration="vacio-anuncios" title="Aún no hay ventas">
                  Registra una compra en <Link to="/inventario" className={ui.link}>Inventario</Link> y márcala como
                  vendida para ver aquí tu beneficio.
                </EmptyState>
              ) : (
                <ul className="mt-3 divide-y divide-line border-t border-line">
                  {summary.recent_sales.map((item) => (
                    <li key={item.id} className="flex items-center gap-4 px-5 py-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{item.name}</p>
                        <p className="text-xs text-muted">
                          {shortDate(item.sold_at)} · vendido por {eur(item.sold_price)}
                        </p>
                      </div>
                      <span className="hidden text-xs text-muted sm:inline">ROI {pct(item.roi)}</span>
                      <Badge tone={item.profit !== null && item.profit > 0 ? 'accent' : 'pink'}>{signedEur(item.profit)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <ReportsPanel />
        </>
      )}
    </Page>
  );
}
