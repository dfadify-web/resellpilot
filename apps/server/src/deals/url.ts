/** Parámetros que solo sirven para seguimiento o afiliación. */
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|msclkid|ref|referrer|aff.*|f|ets|from|spm|share.*|source|campaign)$/i;

/** Páginas de producto de Hacoo: `https://www.hacoo.<tld>/p/<id>`. Toda su query es seguimiento. */
const HACOO_PRODUCT = /^(www\.)?hacoo\.[a-z.]+$/;

/**
 * URL canónica para deduplicar: sin fragmento, sin parámetros de seguimiento,
 * con los parámetros restantes ordenados y sin barra final.
 */
export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  url.username = '';
  url.password = '';

  if (HACOO_PRODUCT.test(url.hostname)) {
    url.search = '';
  } else {
    const kept = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAM.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    url.search = new URLSearchParams(kept).toString();
  }

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.href;
}
