import type { ItemWithCalc, LinkSuggestion, ListingView } from '@resellpilot/shared';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { api, describeError } from '../api';
import { ui } from '../ui';
import { ErrorNote, type Problem } from './ErrorNote';
import { Badge } from './kit';
import { Modal } from './Modal';

interface Props {
  suggestions: LinkSuggestion[];
  listings: ListingView[];
  items: ItemWithCalc[];
  onClose: () => void;
  onDone: (linked: number) => void;
}

/** Lista de enlaces anuncio ↔ item sugeridos por el título. Se aplican solo los marcados. */
export function LinkSuggestionsDialog({ suggestions, listings, items, onClose, onDone }: Props) {
  const [selected, setSelected] = useState(() => new Set(suggestions.map((s) => s.listing_id)));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const itemById = new Map(items.map((item) => [item.id, item]));

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function apply() {
    setSaving(true);
    setProblem(null);
    let linked = 0;
    try {
      for (const suggestion of suggestions) {
        if (!selected.has(suggestion.listing_id)) continue;
        await api.linkListing(suggestion.listing_id, suggestion.item_id);
        linked += 1;
      }
      onDone(linked);
    } catch (error) {
      setProblem(describeError(error));
      setSaving(false);
      if (linked > 0) onDone(linked);
    }
  }

  return (
    <Modal title="Enlazar anuncios con su item" onClose={onClose} illustration="anuncios" size="lg">
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Parejas con títulos parecidos. Al enlazarlas ResellPilot sabe qué tienes en mano, calcula el margen de cada anuncio y,
          cuando se venda en Vinted, pasa el item a vendido solo.
        </p>
        <ul className="scroll-soft max-h-[50vh] space-y-2 overflow-y-auto">
          {suggestions.map((suggestion) => {
            const listing = listingById.get(suggestion.listing_id);
            const item = itemById.get(suggestion.item_id);
            if (!listing || !item) return null;
            return (
              <li key={suggestion.listing_id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line bg-bg/60 p-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 cursor-pointer"
                    checked={selected.has(suggestion.listing_id)}
                    onChange={() => toggle(suggestion.listing_id)}
                  />
                  <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{listing.title}</span>
                      <span className="text-xs text-muted">Anuncio de Vinted</span>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" className="text-faint" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{item.name}</span>
                      <span className="text-xs text-muted">Item del inventario</span>
                    </span>
                  </span>
                  <Badge tone={suggestion.score >= 0.6 ? 'accent' : 'outline'} title={`En común: ${suggestion.shared.join(', ')}`}>
                    {Math.round(suggestion.score * 100)} %
                  </Badge>
                </label>
              </li>
            );
          })}
        </ul>
        <ErrorNote problem={problem} />
        <div className="flex justify-end gap-3">
          <button type="button" className={ui.secondary} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={ui.primary} disabled={saving || selected.size === 0} onClick={() => void apply()}>
            {saving ? 'Enlazando…' : `Enlazar ${selected.size}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
