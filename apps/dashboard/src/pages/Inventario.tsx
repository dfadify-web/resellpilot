import {
  STOCK_LABELS,
  STOCK_STATES,
  type ItemWithCalc,
  type StockState,
} from '@resellpilot/shared';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { EXPORT_CSV_URL, api, describeError } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { ItemDialog } from '../components/ItemDialog';
import { SellDialog } from '../components/SellDialog';
import { eur, pct, shortDate, signedEur } from '../format';
import { ui, usePageTitle } from '../ui';

type Filter = StockState | 'todos';

/** Lee el archivo como UTF-8 y, si no lo es (CSV guardado por Excel), como Windows-1252. */
async function readCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export function Inventario() {
  usePageTitle('Inventario');

  const [items, setItems] = useState<ItemWithCalc[] | null>(null);
  const [filter, setFilter] = useState<Filter>('todos');
  const [editing, setEditing] = useState<ItemWithCalc | 'new' | null>(null);
  const [selling, setSelling] = useState<ItemWithCalc | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await api.listItems());
    } catch (error) {
      setProblem(describeError(error));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Ejecuta una acción sobre la API, recarga la tabla y muestra el error si falla. */
  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      await reload();
      setBusy(false);
    }
  }

  function changeStock(item: ItemWithCalc, stock: StockState) {
    if (stock === item.stock) return;
    // Vender exige precio: se pide en su propio diálogo.
    if (stock === 'vendido') setSelling(item);
    else void run(() => api.updateItem(item.id, { stock }));
  }

  function remove(item: ItemWithCalc) {
    if (confirmDelete !== item.id) {
      setConfirmDelete(item.id);
      return;
    }
    setConfirmDelete(null);
    void run(() => api.deleteItem(item.id), `"${item.name}" borrado.`);
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await run(async () => {
      const { imported } = await api.importCsv(await readCsvFile(file));
      setNotice(imported === 1 ? '1 item importado.' : `${imported} items importados.`);
    });
  }

  const afterSave = () => {
    setEditing(null);
    setSelling(null);
    setProblem(null);
    setNotice(null);
    void reload();
  };

  const all = items ?? [];
  const visible = filter === 'todos' ? all : all.filter((item) => item.stock === filter);
  const count = (state: StockState) => all.filter((item) => item.stock === state).length;

  const chip = (value: Filter, label: string, total: number) => (
    <button
      key={value}
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={`border px-3 py-1 text-[11px] uppercase tracking-[0.14em] ${
        filter === value ? 'border-accent text-paper' : 'border-line text-muted hover:text-paper'
      }`}
    >
      {label} <span className="ml-1 text-paper">{total}</span>
    </button>
  );

  return (
    <section className="px-6 py-8 md:px-12 md:py-12">
      <p className={ui.eyebrow}>06 / 07</p>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className={ui.h1}>Inventario</h1>
        <div className="flex flex-wrap gap-3">
          <a className={ui.secondary} href={EXPORT_CSV_URL} download>
            Exportar CSV
          </a>
          <button type="button" className={ui.secondary} disabled={busy} onClick={() => fileInput.current?.click()}>
            Importar CSV
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label="Archivo CSV para importar"
            onChange={(event) => void importFile(event)}
          />
          <button type="button" className={ui.primary} onClick={() => setEditing('new')}>
            Nuevo item
          </button>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-2 border-t border-line pt-6">
        {chip('todos', 'Todos', all.length)}
        {STOCK_STATES.map((state) => chip(state, STOCK_LABELS[state], count(state)))}
      </div>

      <div className="mt-4 space-y-3">
        <ErrorNote problem={problem} />
        {notice && (
          <p role="status" className="border border-line px-3 py-2 text-sm">
            {notice}
          </p>
        )}
      </div>

      <div className="mt-4 overflow-x-auto border border-line">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead className="border-b border-line bg-panel">
            <tr>
              <th className={ui.th}>Item</th>
              <th className={ui.th}>Estado</th>
              <th className={`${ui.th} text-right`}>Coste total</th>
              <th className={`${ui.th} text-right`}>Venta</th>
              <th className={`${ui.th} text-right`}>Beneficio</th>
              <th className={`${ui.th} text-right`}>ROI</th>
              <th className={ui.th}>Alta</th>
              <th className={ui.th}>Vendido</th>
              <th className={`${ui.th} text-right`}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id} className="border-b border-line last:border-b-0 hover:bg-panel">
                <td className={ui.td}>
                  <span className="font-semibold">{item.name}</span>
                  {item.source_url && (
                    <a
                      href={item.source_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-2 text-muted hover:text-accent"
                      aria-label={`Abrir el enlace de origen de ${item.name}`}
                    >
                      ↗
                    </a>
                  )}
                  {item.brand && <span className="block text-xs text-muted">{item.brand}</span>}
                </td>
                <td className={ui.td}>
                  <select
                    aria-label={`Estado de ${item.name}`}
                    className="border border-line bg-ink px-2 py-1 text-xs uppercase tracking-wide text-paper focus:border-accent focus:outline-none"
                    value={item.stock}
                    disabled={busy}
                    onChange={(e) => changeStock(item, e.target.value as StockState)}
                  >
                    {STOCK_STATES.map((state) => (
                      <option key={state} value={state}>
                        {STOCK_LABELS[state]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`${ui.td} text-right`}>{eur(item.total_cost)}</td>
                <td className={`${ui.td} text-right`}>{eur(item.sold_price)}</td>
                <td
                  className={`${ui.td} text-right font-semibold ${
                    item.profit !== null && item.profit > 0 ? 'text-accent' : ''
                  }`}
                >
                  {signedEur(item.profit)}
                </td>
                <td className={`${ui.td} text-right`}>{pct(item.roi)}</td>
                <td className={`${ui.td} text-muted`}>{shortDate(item.created_at)}</td>
                <td className={`${ui.td} text-muted`}>{shortDate(item.sold_at)}</td>
                <td className={`${ui.td} whitespace-nowrap text-right`}>
                  {item.stock !== 'vendido' && (
                    <button type="button" className={`${ui.link} mr-4 text-paper`} disabled={busy} onClick={() => setSelling(item)}>
                      Vender
                    </button>
                  )}
                  <button type="button" className={`${ui.link} mr-4`} disabled={busy} onClick={() => setEditing(item)}>
                    Editar
                  </button>
                  <button
                    type="button"
                    className={confirmDelete === item.id ? `${ui.link} text-accent` : ui.link}
                    disabled={busy}
                    onClick={() => remove(item)}
                    onBlur={() => setConfirmDelete((id) => (id === item.id ? null : id))}
                  >
                    {confirmDelete === item.id ? '¿Seguro?' : 'Borrar'}
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td className="px-3 py-10 text-center text-muted" colSpan={9}>
                  {items === null
                    ? 'Cargando…'
                    : all.length === 0
                      ? 'Aún no hay items. Registra tu primera compra con «Nuevo item».'
                      : 'No hay items en este estado.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 max-w-prose text-xs text-muted">
        Importar añade filas nuevas (no actualiza las existentes). Columnas: name (obligatoria), brand,
        source_url, cost, shipping_cost, extra_costs, stock, sold_price, sold_at, created_at.
      </p>

      {editing !== null && (
        <ItemDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={afterSave} />
      )}
      {selling !== null && <SellDialog item={selling} onClose={() => setSelling(null)} onSaved={afterSave} />}
    </section>
  );
}
