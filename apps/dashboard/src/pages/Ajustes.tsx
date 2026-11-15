import { type SettingKey, type Settings, type VintedStatus } from '@resellpilot/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { api, describeError, type SettingsResponse } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { ui, usePageTitle } from '../ui';

type NumericKey = Exclude<SettingKey, 'DRY_RUN'>;

interface Field {
  key: NumericKey;
  label: string;
  help: string;
  step: string;
}

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: 'Oportunidades',
    fields: [
      { key: 'MIN_PROFIT_EUR', label: 'Beneficio mínimo €', help: 'Para recomendar una oportunidad.', step: '0.5' },
      { key: 'MIN_ROI_PCT', label: 'ROI mínimo %', help: 'Para recomendar una oportunidad.', step: '1' },
      { key: 'PACKAGING_EUR', label: 'Embalaje €', help: 'Se suma al coste de cada oportunidad.', step: '0.05' },
    ],
  },
  {
    title: 'Anuncios y lectura de Vinted',
    fields: [
      { key: 'STALE_DAYS', label: 'Días para stale', help: 'Anuncio en venta más días que esto.', step: '1' },
      { key: 'READ_MIN_INTERVAL_S', label: 'Segundos entre lecturas', help: 'Pausa mínima entre peticiones a Vinted.', step: '0.5' },
    ],
  },
  {
    title: 'Tendencias',
    fields: [
      { key: 'TRENDS_MAX_REQ_PER_HOUR', label: 'Búsquedas por hora (máx.)', help: '0 desactiva las tendencias.', step: '1' },
      { key: 'TRENDS_CACHE_H', label: 'Horas de caché', help: 'Cada búsqueda se repite como mucho cada N horas.', step: '1' },
    ],
  },
  {
    title: 'Ofertas a favoritos',
    fields: [
      { key: 'OFFER_DISCOUNT_PCT', label: 'Descuento de la oferta %', help: '', step: '1' },
      { key: 'MAX_MESSAGES_PER_DAY', label: 'Mensajes por día (máx.)', help: '', step: '1' },
      { key: 'MSG_DELAY_MIN_S', label: 'Espera mínima entre mensajes (s)', help: '', step: '1' },
      { key: 'MSG_DELAY_MAX_S', label: 'Espera máxima entre mensajes (s)', help: '', step: '1' },
      { key: 'SHIP_HOURS', label: 'Horas de envío', help: 'Plazo que se promete en los mensajes.', step: '1' },
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

  return (
    <section className="px-6 py-8 md:px-12 md:py-12">
      <p className={ui.eyebrow}>07 / 07</p>
      <h1 className={ui.h1}>Ajustes</h1>

      {!data && !problem && <p className="mt-8 text-sm text-muted">Cargando…</p>}
      {!data && <div className="mt-8"><ErrorNote problem={problem} /></div>}

      {data && (
        <form onSubmit={save} className="mt-8 max-w-4xl space-y-10 border-t border-line pt-6">
          {GROUPS.map((group) => (
            <fieldset key={group.title}>
              <legend className="font-display text-3xl font-bold uppercase">{group.title}</legend>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.fields.map((field) => (
                  <div key={field.key}>
                    <label className={ui.label} htmlFor={field.key}>
                      {field.label}
                    </label>
                    <input
                      id={field.key}
                      className={ui.input}
                      type="number"
                      inputMode="decimal"
                      step={field.step}
                      min="0"
                      required
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))}
                    />
                    <p className="mt-1 text-xs text-muted">
                      {field.help} Por defecto: {String(data.defaults[field.key]).replace('.', ',')}.
                    </p>
                  </div>
                ))}
              </div>

              {group.title === 'Tendencias' && (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <label className={ui.label} htmlFor="trend-seeds">
                      Queries semilla (una por línea)
                    </label>
                    <textarea
                      id="trend-seeds"
                      className={`${ui.input} h-40 font-mono`}
                      placeholder={'termo acero\norganizador cables\nlampara led'}
                      value={seeds}
                      onChange={(e) => setSeeds(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted">
                      Además se miden solas las búsquedas derivadas de tus items sin vender y de las oportunidades
                      pendientes.
                    </p>
                  </div>
                  <div>
                    <label className={ui.label} htmlFor="search-url">
                      URL del botón «Buscar en Hacoo»
                    </label>
                    <input
                      id="search-url"
                      className={ui.input}
                      value={searchUrl}
                      onChange={(e) => setSearchUrl(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted">
                      Web que se abre al pulsar el botón (la búsqueda se copia al portapapeles). Si tu web admite
                      búsqueda por URL, pon <code>{'{query}'}</code> donde va el texto. Vacío = valor por defecto.
                    </p>
                  </div>
                </div>
              )}
              {group.title === 'Ofertas a favoritos' && (
                <div className="mt-4">
                  <label className={ui.label} htmlFor="offer-template">
                    Plantilla del mensaje
                  </label>
                  <textarea
                    id="offer-template"
                    className={`${ui.input} h-24`}
                    maxLength={500}
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted">
                    Variables: <code>{'{nombre} {titulo} {precio_final} {horas_envio} {descuento}'}</code>. No puede
                    llevar enlaces ni datos de contacto.{' '}
                    <button
                      type="button"
                      className="text-paper underline"
                      onClick={() => setTemplate(data.default_offer_template)}
                    >
                      Restaurar la original
                    </button>
                  </p>
                </div>
              )}
            </fieldset>
          ))}

          <fieldset>
            <legend className="font-display text-3xl font-bold uppercase">Seguridad</legend>
            <dl className="mt-3 grid grid-cols-1 border border-line sm:grid-cols-2">
              <div className="border-b border-line px-4 py-3 sm:border-b-0 sm:border-r">
                <dt className={ui.label}>Modo simulación (DRY_RUN)</dt>
                <dd className="font-display text-2xl font-bold uppercase text-accent">
                  {data.settings.DRY_RUN ? 'Activado' : 'Desactivado'}
                </dd>
                <dd className="mt-1 text-xs text-muted">
                  Las ofertas y bajadas de precio solo se simulan: ResellPilot todavía no escribe nada en Vinted. No
                  se puede desactivar hasta que la escritura real esté verificada. Mientras tanto, los precios se
                  bajan a mano con «Editar en Vinted» (Anuncios) y la sync lo registra.
                </dd>
              </div>
              <div className="px-4 py-3">
                <dt className={ui.label}>Cuenta de Vinted sincronizada</dt>
                <dd className="font-display text-2xl font-bold">{vinted?.account ? `#${vinted.account}` : 'Ninguna'}</dd>
                <dd className="mt-1 text-xs text-muted">
                  Solo se aceptan datos de esta cuenta.{' '}
                  {vinted?.account && (
                    <button
                      type="button"
                      className={confirmForget ? 'text-accent underline' : 'text-paper underline'}
                      onClick={() => void forgetAccount()}
                      onBlur={() => setConfirmForget(false)}
                    >
                      {confirmForget ? '¿Seguro? Pulsa otra vez' : 'Cambiar de cuenta'}
                    </button>
                  )}
                </dd>
              </div>
            </dl>
          </fieldset>

          <div className="space-y-3">
            <ErrorNote problem={problem} />
            {notice && (
              <p role="status" className="border border-line px-3 py-2 text-sm">
                {notice}
              </p>
            )}
            <button type="submit" className={ui.primary} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar ajustes'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
