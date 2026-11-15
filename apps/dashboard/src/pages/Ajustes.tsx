import { type SettingKey, type Settings, type VintedStatus } from '@resellpilot/shared';
import { MessageSquareHeart, ScanSearch, ShieldCheck, Shirt, Sparkles, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, describeError, type SettingsResponse } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { Badge, Card, CardHeader, Notice, Page, PageHeader } from '../components/kit';
import { ui, usePageTitle } from '../ui';

type NumericKey = Exclude<SettingKey, 'DRY_RUN'>;

interface Field {
  key: NumericKey;
  label: string;
  help: string;
  step: string;
  unit?: string;
}

interface Group {
  id: 'oportunidades' | 'anuncios' | 'tendencias' | 'ofertas';
  title: string;
  description: string;
  icon: LucideIcon;
  fields: Field[];
}

const GROUPS: Group[] = [
  {
    id: 'oportunidades',
    title: 'Oportunidades',
    description: 'Cuándo una oportunidad pasa a recomendada y te avisa.',
    icon: Sparkles,
    fields: [
      { key: 'MIN_PROFIT_EUR', label: 'Beneficio mínimo', help: 'Para recomendar.', step: '0.5', unit: '€' },
      { key: 'MIN_ROI_PCT', label: 'ROI mínimo', help: 'Para recomendar.', step: '1', unit: '%' },
      { key: 'PACKAGING_EUR', label: 'Embalaje', help: 'Se suma al coste.', step: '0.05', unit: '€' },
    ],
  },
  {
    id: 'anuncios',
    title: 'Anuncios y lectura de Vinted',
    description: 'Cuándo un anuncio se considera estancado y el ritmo de la extensión.',
    icon: Shirt,
    fields: [
      { key: 'STALE_DAYS', label: 'Días para estancado', help: 'En venta más días que esto.', step: '1', unit: 'días' },
      { key: 'READ_MIN_INTERVAL_S', label: 'Pausa entre lecturas', help: 'Mínimo entre peticiones.', step: '0.5', unit: 's' },
    ],
  },
  {
    id: 'tendencias',
    title: 'Tendencias',
    description: 'Qué se mide en Vinted y cada cuánto.',
    icon: ScanSearch,
    fields: [
      { key: 'TRENDS_MAX_REQ_PER_HOUR', label: 'Búsquedas por hora', help: '0 las desactiva.', step: '1' },
      { key: 'TRENDS_CACHE_H', label: 'Caché', help: 'Repetir cada N horas como mucho.', step: '1', unit: 'h' },
    ],
  },
  {
    id: 'ofertas',
    title: 'Ofertas a favoritos',
    description: 'Descuento, ritmo y texto de los mensajes.',
    icon: MessageSquareHeart,
    fields: [
      { key: 'OFFER_DISCOUNT_PCT', label: 'Descuento', help: '', step: '1', unit: '%' },
      { key: 'MAX_MESSAGES_PER_DAY', label: 'Mensajes por día', help: 'Máximo.', step: '1' },
      { key: 'SHIP_HOURS', label: 'Horas de envío', help: 'Plazo prometido.', step: '1', unit: 'h' },
      { key: 'MSG_DELAY_MIN_S', label: 'Espera mínima', help: 'Entre mensajes.', step: '1', unit: 's' },
      { key: 'MSG_DELAY_MAX_S', label: 'Espera máxima', help: 'Entre mensajes.', step: '1', unit: 's' },
    ],
  },
];

const toText = (value: number): string => String(value);
const toNumber = (text: string): number => Number(text.replace(',', '.'));

export function Ajustes() {
  usePageTitle('Ajustes');

  const [data, setData] = useState<SettingsResponse | null>(null);
  const [vinted, setVinted] = useState<VintedStatus | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [seeds, setSeeds] = useState('');
  const [searchUrl, setSearchUrl] = useState('');
  const [template, setTemplate] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);

  function load(response: SettingsResponse) {
    setData(response);
    setValues(
      Object.fromEntries(
        Object.entries(response.settings)
          .filter(([, value]) => typeof value === 'number')
          .map(([key, value]) => [key, toText(value as number)]),
      ),
    );
    setSeeds(response.trend_seeds.join('\n'));
    setSearchUrl(response.hacoo_search_url);
    setTemplate(response.offer_template);
  }

  useEffect(() => {
    api.settings().then(load).catch((error: unknown) => setProblem(describeError(error)));
    api.vintedStatus().then(setVinted).catch(() => undefined);
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    setSaving(true);
    setProblem(null);
    setNotice(null);
    try {
      const settings: Partial<Settings> = {};
      for (const group of GROUPS) {
        for (const field of group.fields) settings[field.key] = toNumber(values[field.key] ?? '');
      }
      const trendSeeds = seeds
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      load(await api.saveSettings({ settings, trend_seeds: trendSeeds, hacoo_search_url: searchUrl.trim(), offer_template: template.trim() }));
      setNotice('Ajustes guardados.');
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setSaving(false);
    }
  }

  async function forgetAccount() {
    if (!confirmForget) {
      setConfirmForget(true);
      return;
    }
    setConfirmForget(false);
    try {
      setVinted(await api.forgetVintedAccount());
      setNotice('Cuenta de Vinted olvidada. La próxima sync fijará la cuenta que esté abierta.');
    } catch (error) {
      setProblem(describeError(error));
    }
  }

  const fields = (group: Group): ReactNode => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {group.fields.map((field) => (
        <div key={field.key}>
          <label className={ui.label} htmlFor={field.key}>
            {field.label}
          </label>
          <div className="relative">
            <input
              id={field.key}
              className={`${ui.input} ${field.unit ? 'pr-12' : ''}`}
              type="number"
              inputMode="decimal"
              step={field.step}
              min="0"
              required
              value={values[field.key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
            {field.unit && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">{field.unit}</span>
            )}
          </div>
          <p className={ui.help}>
            {field.help} Por defecto {String(data?.defaults[field.key] ?? '').replace('.', ',')}.
          </p>
        </div>
      ))}
    </div>
  );

  return (
    <Page>
      <PageHeader
        eyebrow="Configuración"
        title="Ajustes"
        description="Umbrales, límites de lectura y textos. Los cambios se aplican al momento a oportunidades y tendencias."
        illustration="ajustes"
      />

      {!data && !problem && <p className="text-sm text-muted">Cargando…</p>}
      {!data && <ErrorNote problem={problem} />}

      {data && (
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {GROUPS.map((group) => (
              <Card key={group.id} as="section" className={group.id === 'ofertas' || group.id === 'tendencias' ? 'xl:col-span-2' : ''}>
                <CardHeader icon={group.icon} title={group.title} description={group.description} />
                <div className="space-y-5 p-5">
                  {fields(group)}

                  {group.id === 'tendencias' && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <label className={ui.label} htmlFor="trend-seeds">
                          Búsquedas semilla (una por línea)
                        </label>
                        <textarea
                          id="trend-seeds"
                          className={`${ui.textarea} h-36 font-mono text-[13px]`}
                          placeholder={'termo acero\norganizador cables\nlampara led'}
                          value={seeds}
                          onChange={(event) => setSeeds(event.target.value)}
                        />
                        <p className={ui.help}>
                          Además se miden solas las búsquedas que salen de tus items sin vender y de las oportunidades pendientes.
                        </p>
                      </div>
                      <div>
                        <label className={ui.label} htmlFor="search-url">
                          Web del botón «Buscar en Hacoo»
                        </label>
                        <input id="search-url" className={ui.input} value={searchUrl} onChange={(event) => setSearchUrl(event.target.value)} />
                        <p className={ui.help}>
                          La búsqueda se copia al portapapeles y se abre esta web. Si admite búsqueda por URL, pon{' '}
                          <code>{'{query}'}</code> donde va el texto. Vacío = valor por defecto.
                        </p>
                      </div>
                    </div>
                  )}

                  {group.id === 'ofertas' && (
                    <div>
                      <label className={ui.label} htmlFor="offer-template">
                        Plantilla del mensaje
                      </label>
                      <textarea
                        id="offer-template"
                        className={`${ui.textarea} h-24`}
                        maxLength={500}
                        value={template}
                        onChange={(event) => setTemplate(event.target.value)}
                      />
                      <p className={ui.help}>
                        Variables: <code>{'{nombre}'}</code> <code>{'{titulo}'}</code> <code>{'{precio_final}'}</code>{' '}
                        <code>{'{horas_envio}'}</code> <code>{'{descuento}'}</code>. Sin enlaces ni datos de contacto.{' '}
                        <button type="button" className={ui.link} onClick={() => setTemplate(data.default_offer_template)}>
                          Restaurar la original
                        </button>
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            ))}

            <Card as="section" className="xl:col-span-2">
              <CardHeader icon={ShieldCheck} title="Seguridad" description="Lo que ResellPilot puede hacer en tu cuenta de Vinted." />
              <dl className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
                <div className="rounded-2xl border border-pink/25 bg-pink-soft/60 p-4">
                  <dt className="flex items-center gap-2 text-sm font-semibold">
                    Modo simulación <Badge tone="pinkSolid">{data.settings.DRY_RUN ? 'Activado' : 'Desactivado'}</Badge>
                  </dt>
                  <dd className="mt-2 text-[13px] leading-relaxed text-muted">
                    Las ofertas y bajadas de precio solo se simulan: ResellPilot todavía no escribe nada en Vinted. Mientras,
                    los precios se bajan a mano con «Editar en Vinted» y la sync lo registra.
                  </dd>
                </div>
                <div className="rounded-2xl border border-line bg-sunken p-4">
                  <dt className="text-sm font-semibold">Cuenta de Vinted sincronizada</dt>
                  <dd className={`${ui.num} mt-1 text-2xl`}>{vinted?.account ? `#${vinted.account}` : 'Ninguna'}</dd>
                  <dd className="mt-1 text-[13px] text-muted">
                    Solo se aceptan datos de esta cuenta.{' '}
                    {vinted?.account && (
                      <button
                        type="button"
                        className={confirmForget ? ui.linkDanger : ui.link}
                        onClick={() => void forgetAccount()}
                        onBlur={() => setConfirmForget(false)}
                      >
                        {confirmForget ? '¿Seguro? Pulsa otra vez' : 'Cambiar de cuenta'}
                      </button>
                    )}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>

          <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-full border border-line bg-surface/90 p-2 pl-5 shadow-[var(--shadow-pop)] backdrop-blur">
            <p className="mr-auto text-sm text-muted">Los cambios no se aplican hasta que guardas.</p>
            <button type="submit" className={ui.primary} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar ajustes'}
            </button>
          </div>
          <ErrorNote problem={problem} />
          {notice && <Notice>{notice}</Notice>}
        </form>
      )}
    </Page>
  );
}
