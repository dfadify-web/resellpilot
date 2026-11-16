/**
 * Sugerencias para enlazar anuncios de Vinted con items del inventario por parecido del título.
 * Solo sugiere: el usuario confirma cada enlace en el dashboard.
 */
import { keywordsOf } from './trends';

export interface LinkSuggestion {
  listing_id: number;
  item_id: number;
  /** 0–1: proporción de palabras clave en común (Jaccard). */
  score: number;
  shared: string[];
}

/** Mínimo de parecido para sugerir un enlace. */
export const MIN_LINK_SCORE = 0.34;

/**
 * Empareja anuncios sin item con items sin anuncio. Cada uno se usa una sola vez: primero los pares más
 * parecidos. Hacen falta 2 palabras clave en común (o 1 si alguno de los dos títulos solo tiene una).
 * Los items vendidos o devueltos solo se emparejan con anuncios vendidos, y al revés.
 */
export function suggestLinks(
  listings: readonly { id: number; title: string; status: string | null; item_id: number | null }[],
  items: readonly { id: number; name: string; stock: string }[],
): LinkSuggestion[] {
  const linked = new Set(listings.map((listing) => listing.item_id).filter((id): id is number => id !== null));
  const freeItems = items.filter((item) => !linked.has(item.id)).map((item) => ({ item, words: keywordsOf(item.name) }));
  const freeListings = listings
    .filter((listing) => listing.item_id === null)
    .map((listing) => ({ listing, words: keywordsOf(listing.title) }));

  const candidates: LinkSuggestion[] = [];
  for (const { listing, words: listingWords } of freeListings) {
    const listingSold = listing.status === 'vendido';
    for (const { item, words: itemWords } of freeItems) {
      const itemDone = item.stock === 'vendido' || item.stock === 'devuelto';
      if (itemDone !== listingSold) continue;
      const itemSet = new Set(itemWords);
      const shared = listingWords.filter((word) => itemSet.has(word));
      const needed = Math.min(2, listingWords.length, itemWords.length);
      if (needed === 0 || shared.length < needed) continue;
      const union = new Set([...listingWords, ...itemWords]).size;
      const score = Math.round((shared.length / union) * 1000) / 1000;
      if (score >= MIN_LINK_SCORE) candidates.push({ listing_id: listing.id, item_id: item.id, score, shared });
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.shared.length - a.shared.length || a.listing_id - b.listing_id);
  const usedListings = new Set<number>();
  const usedItems = new Set<number>();
  const chosen: LinkSuggestion[] = [];
  for (const candidate of candidates) {
    if (usedListings.has(candidate.listing_id) || usedItems.has(candidate.item_id)) continue;
    usedListings.add(candidate.listing_id);
    usedItems.add(candidate.item_id);
    chosen.push(candidate);
  }
  return chosen;
}
