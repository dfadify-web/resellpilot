/** Minúsculas, sin acentos y con todo lo que no sea letra o número convertido en espacio. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Marcas de la lista que aparecen en el texto como palabras completas.
 * "Nike TN" coincide con "nike"; "Bonike" no.
 */
export function matchBlockedBrands(text: string | null | undefined, brands: readonly string[]): string[] {
  if (!text) return [];
  const haystack = ` ${normalizeForMatch(text)} `;
  const matches: string[] = [];
  for (const brand of brands) {
    const needle = normalizeForMatch(brand);
    if (needle !== '' && haystack.includes(` ${needle} `) && !matches.includes(brand)) {
      matches.push(brand);
    }
  }
  return matches;
}
