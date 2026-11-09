import { toDateInputValue, type ItemWithCalc } from '@resellpilot/shared';
import { useState, type FormEvent } from 'react';
import { api, describeError } from '../api';
import { eur, pct, signedEur } from '../format';
import { ui } from '../ui';
import { ErrorNote, type Problem } from './ErrorNote';
import { Modal } from './Modal';

interface Props {
  item: ItemWithCalc;
  onClose: () => void;
  onSaved: () => void;
}

/** Marca un item como vendido: pide precio y fecha, y enseña el beneficio antes de guardar. */
export function SellDialog({ item, onClose, onSaved }: Props) {
  const today = toDateInputValue(new Date());
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const priceNumber = price.trim() === '' ? null : Number(price.replace(',', '.'));
  const valid = priceNumber !== null && Number.isFinite(priceNumber) && priceNumber >= 0;
  const profit = valid ? Math.round((priceNumber - item.total_cost) * 100) / 100 : null;
  const roi = profit !== null && item.total_cost > 0 ? profit / item.total_cost : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    setProblem(null);
    try {
      await api.updateItem(item.id, {
        stock: 'vendido',
        sold_price: priceNumber,
        // Si la venta es de hoy no se envía fecha: el server guarda la hora exacta.
        ...(date === '' || date === today ? {} : { sold_at: date }),
      });
      onSaved();
    } catch (error) {
      setProblem(describeError(error));
      setSaving(false);
    }
  }

  return (
    <Modal title="Marcar vendido" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm">
          {item.name}
          <span className="text-muted"> · coste total {eur(item.total_cost)}</span>
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={ui.label} htmlFor="sell-price">
              Precio de venta €
            </label>
            <input
              id="sell-price"
              className={ui.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              required
              autoFocus
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div>
            <label className={ui.label} htmlFor="sell-date">
              Fecha de venta
            </label>
            <input
              id="sell-date"
              className={ui.input}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 border border-line">
          <div className="border-r border-line px-3 py-2">
            <dt className={ui.label}>Beneficio</dt>
            <dd className={`font-display text-3xl font-bold ${profit !== null && profit > 0 ? 'text-accent' : ''}`}>
              {signedEur(profit)}
            </dd>
          </div>
          <div className="px-3 py-2">
            <dt className={ui.label}>ROI</dt>
            <dd className="font-display text-3xl font-bold">{pct(roi)}</dd>
          </div>
        </dl>

        <ErrorNote problem={problem} />

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className={ui.secondary} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={ui.primary} disabled={saving || !valid}>
            {saving ? 'Guardando…' : 'Vendido'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
