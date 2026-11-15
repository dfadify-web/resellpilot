import { STOCK_LABELS, STOCK_STATES, type ItemWithCalc, type StockState } from '@resellpilot/shared';
import { Download, ExternalLink, PenLine, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { EXPORT_CSV_URL, api, describeError } from '../api';
import { ErrorNote, type Problem } from '../components/ErrorNote';
import { ItemDialog } from '../components/ItemDialog';
import { Chips, EmptyState, IconButton, Notice, Page, PageHeader, TableCard } from '../components/kit';
import { ListingTextDialog } from '../components/ListingTextDialog';
import { SellDialog } from '../components/SellDialog';
import { eur, pct, shortDate, signedEur } from '../format';
import { ui, usePageTitle } from '../ui';

type Filter = StockState | 'todos';

/** Color del selector de estado, para leer la tabla de un vistazo. */
const STOCK_TONES: Partial<Record<StockState, string>> = {
  en_mano: 'border-accent/40 bg-accent-soft text-accent',
  listado: 'border-accent/40 bg-accent-soft text-accent',
  vendido: 'border-accent bg-accent text-on-accent',
  devuelto: 'border-pink/40 bg-pink-soft text-pink',
};

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
  const [writing, setWriting] = useState<ItemWithCalc | null>(null);
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
    void run(() => api.deleteItem(item.id), `«${item.name}» borrado.`);
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

  return (
    <Page>
      <PageHeader
        eyebrow={`${all.length} items`}
        title="Inventario"
        description="Todo lo que compras para revender, con su coste real. Al venderlo ves el beneficio y el ROI exactos."
        illustration="inventario"
        actions={
          <>
            <button type="button" className={ui.primary} onClick={() => setEditing('new')}>
              <Plus size={16} aria-hidden="true" />
              Nuevo item
            </button>
            <a className={ui.secondary} href={EXPORT_CSV_URL} download>
              <Download size={16} aria-hidden="true" />
              Exportar CSV
            </a>
            <button type="button" className={ui.secondary} disabled={busy} onClick={() => fileInput.current?.click()}>
              <Upload size={16} aria-hidden="true" />
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
          </>
        }
      />

      <ErrorNote problem={problem} />
      {notice && <Notice>{notice}</Notice>}

      <div className="space-y-3">
        <Chips
          label="Filtrar por estado"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'todos' as Filter, label: 'Todos', count: all.length },
            ...STOCK_STATES.filter((state) => count(state) > 0 || state === 'en_mano').map((state) => ({
              value: state as Filter,
              label: STOCK_LABELS[state],
              count: count(state),
            })),
          ]}
        />

        {visible.length === 0 ? (
          <div className={ui.card}>
            <EmptyState
              illustration="inventario"
              title={items === null ? 'Cargando…' : all.length === 0 ? 'Tu inventario está vacío' : 'Nada en este estado'}
              action={
                items !== null && all.length === 0 ? (
                  <button type="button" className={ui.primary} onClick={() => setEditing('new')}>
                    <Plus size={16} aria-hidden="true" />
                    Registrar mi primera compra
                  </button>
                ) : undefined
              }
            >
              {items !== null && all.length === 0 && 'Apunta lo que compras con su coste y sabrás cuánto ganas de verdad al venderlo.'}
            </EmptyState>
          </div>
        ) : (
          <TableCard minWidth={880}>
            <thead>
              <tr>
                <th className={`${ui.th} min-w-[220px]`}>Item</th>
                <th className={ui.th}>Estado</th>
                <th className={`${ui.th} text-right`}>Coste</th>
                <th className={`${ui.th} text-right`}>Venta</th>
                <th className={`${ui.th} text-right`}>Beneficio</th>
                <th className={`${ui.th} text-right`}>ROI</th>
                <th className={ui.th}>Alta</th>
                <th className={`${ui.th} text-right`}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className={ui.tr}>
                  <td className={ui.td}>
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      {item.name}
                      {item.source_url && (
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-faint transition hover:text-accent"
                          aria-label={`Abrir el enlace de origen de ${item.name}`}
                        >
                          <ExternalLink size={13} aria-hidden="true" />
                        </a>
                      )}
                    </span>
                    {item.brand && <span className="block text-xs text-muted">{item.brand}</span>}
                  </td>
                  <td className={ui.td}>
                    <select
                      aria-label={`Estado de ${item.name}`}
                      className={`h-8 cursor-pointer rounded-full border px-3 text-xs font-semibold transition focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-50 ${
                        STOCK_TONES[item.stock] ?? 'border-line bg-surface text-ink'
                      }`}
                      value={item.stock}
                      disabled={busy}
                      onChange={(event) => changeStock(item, event.target.value as StockState)}
                    >
                      {STOCK_STATES.map((state) => (
                        <option key={state} value={state}>
                          {STOCK_LABELS[state]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={`${ui.td} text-right`}>{eur(item.total_cost)}</td>
                  <td className={`${ui.td} text-right text-muted`}>{eur(item.sold_price)}</td>
                  <td
                    className={`${ui.td} text-right font-semibold ${
                      item.profit === null ? 'text-faint' : item.profit > 0 ? 'text-accent' : 'text-pink'
                    }`}
                  >
                    {signedEur(item.profit)}
                  </td>
                  <td className={`${ui.td} text-right text-muted`}>{pct(item.roi)}</td>
                  <td className={`${ui.td} whitespace-nowrap text-xs text-muted`}>
                    {shortDate(item.created_at)}
                    {item.sold_at && <span className="block">vendido {shortDate(item.sold_at)}</span>}
                  </td>
                  <td className={`${ui.td} whitespace-nowrap text-right`}>
                    <span className="inline-flex items-center gap-1">
                      {item.stock !== 'vendido' && (
                        <button type="button" className={`${ui.link} mr-2`} disabled={busy} onClick={() => setSelling(item)}>
                          Vender
                        </button>
                      )}
                      {item.stock !== 'vendido' && item.stock !== 'devuelto' && (
                        <IconButton label={`Texto del anuncio de ${item.name}`} icon={PenLine} onClick={() => setWriting(item)} />
                      )}
                      <IconButton label={`Editar ${item.name}`} icon={Pencil} disabled={busy} onClick={() => setEditing(item)} />
                      {confirmDelete === item.id ? (
                        <button
                          type="button"
                          className={`${ui.linkDanger} ml-1`}
                          disabled={busy}
                          onClick={() => remove(item)}
                          onBlur={() => setConfirmDelete((id) => (id === item.id ? null : id))}
                          autoFocus
                        >
                          ¿Borrar?
                        </button>
                      ) : (
                        <IconButton label={`Borrar ${item.name}`} icon={Trash2} disabled={busy} onClick={() => remove(item)} />
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        )}
        <p className="max-w-[80ch] text-xs leading-relaxed text-muted">
          Importar añade filas nuevas (no actualiza las existentes). Columnas: name (obligatoria), brand, source_url, cost,
          shipping_cost, extra_costs, stock, sold_price, sold_at, created_at.
        </p>
      </div>

      {editing !== null && (
        <ItemDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={afterSave} />
      )}
      {selling !== null && <SellDialog item={selling} onClose={() => setSelling(null)} onSaved={afterSave} />}
      {writing !== null && <ListingTextDialog item={writing} onClose={() => setWriting(null)} />}
    </Page>
  );
}
