/** Respuesta HTTP mínima que necesita la ingesta. */
export interface HttpResponse {
  status: number;
  /** URL que se pidió (tras seguir redirecciones, la final). */
  url: string;
  /** Cabecera Location si es una redirección. */
  location: string | null;
  text: string;
}

/** Hace UNA petición GET sin seguir redirecciones. Inyectable para los tests. */
export type Fetcher = (url: string) => Promise<HttpResponse>;

/** Identificación honesta: sin navegador headless ni user-agent falso. */
export const USER_AGENT = 'ResellPilot/0.1 (herramienta personal local)';

const TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 2_000_000;
const MAX_REDIRECTS = 5;

/**
 * Solo http(s) hacia Internet. Los enlaces vienen de contenido externo, así que nunca
 * se piden direcciones de este equipo o de la red local.
 */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  if (host === '' || host === 'localhost' || host.startsWith('[')) return false;
  if (/\.(localhost|local|internal|lan|home)$/.test(host)) return false;
  if (!host.includes('.')) return false;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

export const httpFetcher: Fetcher = async (url) => {
  if (!isPublicHttpUrl(url)) throw new Error('URL no permitida');
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      'accept-language': 'es-ES,es;q=0.9,en;q=0.5',
    },
  });
  const isRedirect = response.status >= 300 && response.status < 400;
  const text = isRedirect ? '' : (await response.text()).slice(0, MAX_BODY_CHARS);
  return { status: response.status, url, location: response.headers.get('location'), text };
};

/** Sigue redirecciones a mano (máx. 5), validando cada salto. */
export async function fetchFollow(fetcher: Fetcher, startUrl: string): Promise<HttpResponse> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicHttpUrl(url)) throw new Error('Redirección a una URL no permitida');
    const response = await fetcher(url);
    const isRedirect = response.status >= 300 && response.status < 400 && response.location;
    if (!isRedirect) return { ...response, url };
    url = new URL(response.location as string, url).href;
  }
  throw new Error('Demasiadas redirecciones');
}
