import {
  STOCK_LABELS,
  calculate,
  estPriceFromTrend,
  matchTrend,
  type StockState,
  type TrendView,
  type Verdict,
} from '@resellpilot/shared';
import { CircleCheck, CircleX, PackagePlus, Scale, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, describeError } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { Badge, Card, CardHeader, Notice, Page, PageHeader } from '../components/kit';
import { eur, pct, signedEur } from '../format';
import { ui, usePageTitle } from '../ui';

const VERDICTS: Record<Verdict, { title: string; text: string; tone: string; icon: typeof CircleCheck }> = {
  compensa: { title: 'Compensa', text: 'Cumple tu beneficio y tu ROI mínimos.', tone: 'bg-accent text-on-accent', icon: CircleCheck },
  justo: { title: 'Justo', text: 'Ganas algo, pero no llegas a tus mínimos.', tone: 'bg-pink-soft text-pink', icon: Scale },
  no_compensa: { title: 'No compensa', text: 'A ese precio pierdes dinero o no ganas nada.', tone: 'bg-pink-ink text-white', icon: CircleX },
};

const toText = (value: number): string => (value === 0 ? '' : String(value).replace('.', ','));
const toNumber = (text: string): number => {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

interface MoneyFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  unit?: string;
}

function MoneyField({ id, label, value, onChange, help, unit = '€' }: MoneyFieldProps) {
  return (
    <div>
      <label className={ui.label} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className={`${ui.input} pr-9`}
          inputMode="decimal"
          placeholder="0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{unit}</span>
      </div>
      {help && <p className={ui.help}>{help}</p>}
    </div>
  );
}

/** Herramienta «¿Me compensa?»: rentabilidad de una compra antes de hacerla. */
export function Calculadora() {
  usePageTitle('Calculadora');
  const [params] = useSearchParams();

  const [name, setName] = useState(params.get('nombre') ?? '');
  const [buy, setBuy] = useState(params.get('precio')?.replace('.', ',') ?? '');
  const [shipping, setShipping] = useState('');
  const [extra, setExtra] = useState('');
  const [packaging, setPackaging] = useState('0,3');
  const [sell, setSell] = useState(params.get('venta')?.replace('.', ',') ?? '');
  const [offerPct, setOfferPct] = useState('10');
  const [minProfit, setMinProfit] = useState(5);
  const [minRoiPct, setMinRoiPct] = useState(80);
  const [trends, setTrends] = useState<TrendView[]>([]);
  const [stock, setStock] = useState<StockState>('idea');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .settings()
      .then(({ settings }) => {
        setPackaging(toText(settings.PACKAGING_EUR) || '0');
        setOfferPct(String(settings.OFFER_DISCOUNT_PCT));
        setMinProfit(settings.MIN_PROFIT_EUR);
        setMinRoiPct(settings.MIN_ROI_PCT);
      })
      .catch(() => undefined);
    api
      .trends()
      .then((data) => setTrends(data.trends.filter((trend) => trend.computed_at !== null)))
      .catch(() => undefined);
  }, []);

  const trend = useMemo(() => (name.trim().length >= 3 ? matchTrend(name, trends) : null), [name, trends]);
  const trendPrice = trend ? estPriceFromTrend(trend) : null;

  const result = calculate({
    buy: toNumber(buy),
    buyShipping: toNumber(shipping),
    extra: toNumber(extra),
    packaging: toNumber(packaging),
    sell: toNumber(sell),
    offerPct: toNumber(offerPct),
    minProfit,
    minRoiPct,
  });
  const ready = toNumber(sell) > 0 && result.cost > 0;
  const verdict = VERDICTS[result.verdict];
  const VerdictIcon = verdict.icon;

  async function save() {
    setSaving(true);
    setProblem(null);
    setNotice(null);
    try {
      await api.createItem({
        name: name.trim() || 'Compra sin nombre',
        cost: toNumber(buy),
        shipping_cost: toNumber(shipping),
        extra_costs: toNumber(extra),
        stock,
      });
      setNotice(`«${name.trim() || 'Compra sin nombre'}» guardado en Inventario como ${STOCK_LABELS[stock].toLowerCase()}.`);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Herramienta"
        title="¿Me compensa?"
        description="Antes de comprar: mete lo que te cuesta y a cuánto crees que se vende. Te dice si merece la pena, a cuánto anunciarlo y qué oferta mínima aceptar."
        illustration="dinero"
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Card as="section">
          <CardHeader title="Datos de la compra" description="En Vinted el vendedor no paga comisión: lo que cobras es el precio de venta." />
          <div className="space-y-5 p-5">
            <div>
              <label className={ui.label} htmlFor="calc-name">
                Producto
              </label>
              <input
                id="calc-name"
                className={ui.input}
                placeholder="Termo acero 500 ml"
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
              {trend && trendPrice !== null ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[13px]">
                  <Sparkles size={14} aria-hidden="true" className="text-accent" />
                  <span>
                    Tendencia «{trend.query}»: venta estimada <strong>{eur(trendPrice)}</strong>
                    <span className="text-muted">
                      {' '}
                      · {trend.listings_count >= 500 ? '500+' : trend.listings_count} anuncios ·{' '}
                      {trend.favs_per_day?.toLocaleString('es-ES', { maximumFractionDigits: 2 }) ?? '—'} favs/día
                    </span>
                  </span>
                  <button type="button" className={`${ui.link} ml-auto`} onClick={() => setSell(String(trendPrice).replace('.', ','))}>
                    Usar este precio
                  </button>
                </div>
              ) : (
                <p className={ui.help}>
                  Si el nombre coincide con una búsqueda medida en <Link to="/tendencias" className={ui.link}>Tendencias</Link>, te
                  propone el precio de venta real de Vinted.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MoneyField id="calc-buy" label="Precio de compra" value={buy} onChange={setBuy} />
              <MoneyField id="calc-shipping" label="Envío de la compra" value={shipping} onChange={setShipping} />
              <MoneyField id="calc-extra" label="Otros costes" value={extra} onChange={setExtra} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MoneyField id="calc-sell" label="Precio de venta previsto" value={sell} onChange={setSell} />
              <MoneyField id="calc-packaging" label="Embalaje" value={packaging} onChange={setPackaging} />
              <MoneyField id="calc-offer" label="Oferta habitual" value={offerPct} onChange={setOfferPct} unit="%" />
            </div>
            <p className="text-xs text-muted">
              Tus mínimos (en <Link to="/ajustes" className={ui.link}>Ajustes</Link>): beneficio {eur(minProfit)} y ROI {minRoiPct} %.
            </p>
          </div>
        </Card>

        <div className="space-y-4">
          <Card as="section" className="overflow-hidden">
            <div className={`flex items-center gap-4 px-5 py-5 ${ready ? verdict.tone : 'bg-sunken text-muted'}`}>
              <VerdictIcon size={34} aria-hidden="true" className="shrink-0" />
              <div>
                <p className="font-display text-3xl font-semibold leading-none tracking-[-0.02em]">
                  {ready ? verdict.title : 'Rellena compra y venta'}
                </p>
                <p className="mt-1.5 text-sm opacity-85">{ready ? verdict.text : 'El resultado se calcula al momento.'}</p>
              </div>
            </div>
            <dl className="grid grid-cols-3 divide-x divide-line border-b border-line">
              {(
                [
                  ['Coste total', eur(result.cost)],
                  ['Beneficio', ready ? signedEur(result.profit) : '—'],
                  ['ROI', ready ? pct(result.roi) : '—'],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="px-5 py-4">
                  <dt className="text-xs font-medium text-muted">{label}</dt>
                  <dd className={`${ui.num} mt-1 text-[26px] leading-none`}>{value}</dd>
                </div>
              ))}
            </dl>
            <ul className="divide-y divide-line text-sm">
              {(
                [
                  ['Precio mínimo sin perder', eur(result.breakEven), 'Por debajo, pierdes dinero.'],
                  ['Precio mínimo para tus objetivos', eur(result.minPrice), `Beneficio ${eur(minProfit)} y ROI ${minRoiPct} %.`],
                  [
                    'Precio de anuncio recomendado',
                    eur(result.listPrice),
                    `Deja margen para una oferta del ${toNumber(offerPct)} % sin bajar de tus mínimos.`,
                  ],
                  ['Oferta más baja que puedes aceptar', eur(result.minOffer), 'Si te ofrecen menos, contraoferta o rechaza.'],
                ] as const
              ).map(([label, value, help]) => (
                <li key={label} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{label}</p>
                    <p className="text-xs text-muted">{help}</p>
                  </div>
                  <p className={`${ui.num} text-xl`}>{result.cost > 0 ? value : '—'}</p>
                </li>
              ))}
            </ul>
          </Card>

          {ready && (
            <Card as="section">
              <CardHeader title="Si tienes que bajarlo" description="Lo que te quedaría al vender por debajo de lo previsto." />
              <ul className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-4">
                {[result.afterOffer, ...result.scenarios.slice(1)].map((scenario) => (
                  <li key={scenario.label} className="rounded-2xl bg-sunken px-3 py-3">
                    <p className="text-xs font-medium text-muted">{scenario.label}</p>
                    <p className={`${ui.num} mt-1 text-lg`}>{eur(scenario.price)}</p>
                    <Badge tone={scenario.profit >= minProfit ? 'accent' : scenario.profit > 0 ? 'outline' : 'pink'}>
                      {signedEur(scenario.profit)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card as="section" className="flex flex-wrap items-end gap-3 p-5">
            <div className="min-w-[160px] flex-1">
              <label className={ui.label} htmlFor="calc-stock">
                Guardar en inventario como
              </label>
              <select id="calc-stock" className={ui.select} value={stock} onChange={(event) => setStock(event.target.value as StockState)}>
                {(['idea', 'pedido', 'en_camino', 'en_mano'] as StockState[]).map((value) => (
                  <option key={value} value={value}>
                    {STOCK_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className={ui.primary} disabled={saving || toNumber(buy) === 0} onClick={() => void save()}>
              <PackagePlus size={16} aria-hidden="true" />
              {saving ? 'Guardando…' : 'Guardar en inventario'}
            </button>
          </Card>
          <ErrorNote problem={problem} />
          {notice && <Notice>{notice}</Notice>}
        </div>
      </div>
    </Page>
  );
}
