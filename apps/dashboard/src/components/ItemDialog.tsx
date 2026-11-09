import {
  STOCK_LABELS,
  STOCK_STATES,
  toDateInputValue,
  type ItemInput,
  type ItemWithCalc,
  type StockState,
} from '@resellpilot/shared';
import { useState, type FormEvent } from 'react';
import { api, describeError } from '../api';
import { eur } from '../format';
import { ui } from '../ui';
import { ErrorNote, type Problem } from './ErrorNote';
import { Modal } from './Modal';

interface Props {
  /** Item a editar, o `null` para crear uno nuevo. */
  item: ItemWithCalc | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Texto de un campo numérico → número. Vacío cuenta como 0; admite coma decimal. */
const toNumber = (text: string): number => (text.trim() === '' ? 0 : Number(text.replace(',', '.')));
const fromNumber = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

export function ItemDialog({ item, onClose, onSaved }: Props) {
  const today = toDateInputValue(new Date());
  const initialCreatedAt = item ? toDateInputValue(item.created_at) : today;
  const initialSoldAt = item?.sold_at ? toDateInputValue(item.sold_at) : today;

  const [name, setName] = useState(item?.name ?? '');
  const [brand, setBrand] = useState(item?.brand ?? '');
  const [sourceUrl, setSourceUrl] = useState(item?.source_url ?? '');
  const [cost, setCost] = useState(fromNumber(item?.cost));
  const [shipping, setShipping] = useState(fromNumber(item?.shipping_cost));
  const [extra, setExtra] = useState(fromNumber(item?.extra_costs));
  const [stock, setStock] = useState<StockState>(item?.stock ?? 'pedido');
  const [soldPrice, setSoldPrice] = useState(fromNumber(item?.sold_price));
  const [soldAt, setSoldAt] = useState(initialSoldAt);
  const [createdAt, setCreatedAt] = useState(initialCreatedAt);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const total = toNumber(cost) + toNumber(shipping) + toNumber(extra);
  const sold = stock === 'vendido';

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: ItemInput = {
      name,
      brand: brand.trim() === '' ? null : brand,
      source_url: sourceUrl.trim() === '' ? null : sourceUrl,
      cost: toNumber(cost),
      shipping_cost: toNumber(shipping),
      extra_costs: toNumber(extra),
      stock,
    };
    if (sold) {
      input.sold_price = soldPrice.trim() === '' ? null : toNumber(soldPrice);
      // Solo se envía la fecha si se ha tocado, para no perder la hora original.
      if (soldAt !== initialSoldAt && soldAt !== '') input.sold_at = soldAt;
    }
    if (createdAt !== initialCreatedAt && createdAt !== '') input.created_at = createdAt;

    setSaving(true);
    setProblem(null);
    try {
      if (item) await api.updateItem(item.id, input);
      else await api.createItem(input);
      onSaved();
    } catch (error) {
      setProblem(describeError(error));
      setSaving(false);
    }
  }

  const money = (label: string, value: string, onChange: (v: string) => void, id: string) => (
    <div>
      <label className={ui.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={ui.input}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        placeholder="0,00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );

  return (
    <Modal title={item ? 'Editar item' : 'Nuevo item'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={ui.label} htmlFor="item-name">
            Nombre
          </label>
          <input
            id="item-name"
            className={ui.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            autoFocus
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={ui.label} htmlFor="item-brand">
              Marca
            </label>
            <input
              id="item-brand"
              className={ui.input}
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              maxLength={100}
            />
          </div>
          <div>
            <label className={ui.label} htmlFor="item-url">
              Enlace de origen
            </label>
            <input
              id="item-url"
              className={ui.input}
              type="url"
              placeholder="https://"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {money('Coste €', cost, setCost, 'item-cost')}
          {money('Envío €', shipping, setShipping, 'item-shipping')}
          {money('Otros costes €', extra, setExtra, 'item-extra')}
        </div>
        <p className="text-sm text-muted">
          Coste total: <span className="text-paper">{eur(Number.isFinite(total) ? total : null)}</span>
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={ui.label} htmlFor="item-stock">
              Estado
            </label>
            <select
              id="item-stock"
              className={ui.input}
              value={stock}
              onChange={(e) => setStock(e.target.value as StockState)}
            >
              {STOCK_STATES.map((state) => (
                <option key={state} value={state}>
                  {STOCK_LABELS[state]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={ui.label} htmlFor="item-created">
              Fecha de alta
            </label>
            <input
              id="item-created"
              className={ui.input}
              type="date"
              value={createdAt}
              onChange={(e) => setCreatedAt(e.target.value)}
            />
          </div>
        </div>

        {sold && (
          <div className="grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <div>
              <label className={ui.label} htmlFor="item-sold-price">
                Precio de venta €
              </label>
              <input
                id="item-sold-price"
                className={ui.input}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                required
                value={soldPrice}
                onChange={(e) => setSoldPrice(e.target.value)}
              />
            </div>
            <div>
              <label className={ui.label} htmlFor="item-sold-at">
                Fecha de venta
              </label>
              <input
                id="item-sold-at"
                className={ui.input}
                type="date"
                value={soldAt}
                onChange={(e) => setSoldAt(e.target.value)}
              />
            </div>
          </div>
        )}

        <ErrorNote problem={problem} />

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className={ui.secondary} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={ui.primary} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
