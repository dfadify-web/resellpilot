import {
  DEFAULT_SETTINGS,
  ITEM_CONDITIONS,
  ITEM_CONDITION_LABELS,
  generateListingText,
  type ItemCondition,
  type ItemWithCalc,
} from '@resellpilot/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ui } from '../ui';
import { Modal } from './Modal';

interface Props {
  item: ItemWithCalc;
  onClose: () => void;
}

type Copied = 'title' | 'description' | null;

/** Genera título, descripción y hashtags del anuncio a partir del item. Solo texto para copiar: no toca Vinted. */
export function ListingTextDialog({ item, onClose }: Props) {
  const [condition, setCondition] = useState<ItemCondition>('nuevo_sin_etiquetas');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [notes, setNotes] = useState('');
  const [shipHours, setShipHours] = useState<number>(DEFAULT_SETTINGS.SHIP_HOURS);
  const [copied, setCopied] = useState<Copied>(null);

  useEffect(() => {
    api
      .settings()
      .then((response) => setShipHours(response.settings.SHIP_HOURS))
      .catch(() => undefined);
  }, []);

  const inHand = item.stock === 'en_mano' || item.stock === 'listado';
  const text = useMemo(
    () => generateListingText({ name: item.name, brand: item.brand, condition, size, color, notes, shipHours, inHand }),
    [item.name, item.brand, condition, size, color, notes, shipHours, inHand],
  );

  async function copy(what: Exclude<Copied, null>) {
    try {
      await navigator.clipboard.writeText(what === 'title' ? text.title : text.description);
      setCopied(what);
      setTimeout(() => setCopied((current) => (current === what ? null : current)), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <Modal title="Texto del anuncio" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          {item.name}
          {item.brand && <span className="text-muted"> · {item.brand}</span>}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={ui.label} htmlFor="text-condition">
              Estado
            </label>
            <select
              id="text-condition"
              className={ui.input}
              value={condition}
              onChange={(event) => setCondition(event.target.value as ItemCondition)}
            >
              {ITEM_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {ITEM_CONDITION_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={ui.label} htmlFor="text-size">
              Talla
            </label>
            <input id="text-size" className={ui.input} maxLength={20} value={size} onChange={(event) => setSize(event.target.value)} />
          </div>
          <div>
            <label className={ui.label} htmlFor="text-color">
              Color
            </label>
            <input id="text-color" className={ui.input} maxLength={30} value={color} onChange={(event) => setColor(event.target.value)} />
          </div>
        </div>

        <div>
          <label className={ui.label} htmlFor="text-notes">
            Detalles (uno por línea): medidas, material, defectos…
          </label>
          <textarea
            id="text-notes"
            className={`${ui.input} h-20`}
            maxLength={600}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        {text.warnings.map((warning) => (
          <p key={warning} role="alert" className="border border-accent px-3 py-2 text-accent">
            {warning}
          </p>
        ))}

        <div className="border border-line">
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
            <p className={ui.eyebrow}>Título · {text.title.length} caracteres</p>
            <button type="button" className={`${ui.link} text-paper`} onClick={() => void copy('title')}>
              {copied === 'title' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="px-3 py-2 font-semibold">{text.title}</p>
        </div>

        <div className="border border-line">
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
            <p className={ui.eyebrow}>Descripción y hashtags</p>
            <button type="button" className={`${ui.link} text-paper`} onClick={() => void copy('description')}>
              {copied === 'description' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="max-h-56 overflow-y-auto whitespace-pre-wrap px-3 py-2">{text.description}</p>
        </div>

        <p className="text-xs text-muted">
          {inHand
            ? `El item está en mano: se promete envío en ${shipHours} h (ajuste «Horas de envío»).`
            : 'El item aún no está en mano: el texto no promete plazo de envío.'}{' '}
          Es una plantilla, sin IA: repásalo antes de publicarlo.
        </p>

        <div className="flex justify-end">
          <button type="button" className={ui.secondary} onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}
