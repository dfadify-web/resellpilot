import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeEntities, extractLinks, parseProductPage, parseTelegramChannel } from '../src/deals/parsers';
import { normalizeUrl } from '../src/deals/url';
import { isPublicHttpUrl } from '../src/http';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const fixture = (name: string): string => readFileSync(join(fixturesDir, name), 'utf8');

const SHORT_LINK = 'https?://c\\.onlyaff\\.app/[A-Za-z0-9]+';

describe('canal público de Telegram', () => {
  const candidates = parseTelegramChannel(fixture('telegram-channel.html'), SHORT_LINK, 'https://t.me/s/canal_prueba');

  it('saca un candidato por enlace, sin repetir y solo los que casan con link_regex', () => {
    expect(candidates.map((c) => c.link)).toEqual([
      'https://c.onlyaff.app/abc111',
      'https://c.onlyaff.app/abc222',
      'https://c.onlyaff.app/abc333',
    ]);
  });

  it('usa la primera línea del mensaje como título y la primera foto como imagen', () => {
    expect(candidates[0]).toEqual({
      link: 'https://c.onlyaff.app/abc111',
      title: 'Termo acero 500ml',
      image: 'https://cdn4.telesco.pe/file/foto-termo-1.jpg',
    });
  });

  it('limpia emojis y entidades HTML del título', () => {
    expect(candidates[1]).toEqual({
      link: 'https://c.onlyaff.app/abc222',
      title: 'Sudadera Nike Tech & pantalón',
      image: 'https://cdn4.telesco.pe/file/foto-sudadera.jpg',
    });
  });

  it('un mensaje sin foto y que empieza por el enlace no inventa imagen', () => {
    expect(candidates[2]?.image).toBeNull();
    expect(candidates[2]?.title).toBe('Sin título antes del enlace, y otro: repetido');
  });

  it('una página sin mensajes no da candidatos', () => {
    expect(parseTelegramChannel('<html><body>nada</body></html>', SHORT_LINK, 'https://t.me/s/x')).toEqual([]);
  });
});

describe('enlaces de una web', () => {
  it('resuelve enlaces relativos y no repite', () => {
    expect(
      extractLinks(fixture('web-listing.html'), '/produit/[a-z0-9-]+', 'https://catalogo.example/categorie/accessoires'),
    ).toEqual([
      'https://catalogo.example/produit/organisateur-cables-179000000000001',
      'https://catalogo.example/produit/ralph-lauren-179000000000002',
    ]);
  });

  it('descarta enlaces a este equipo o con otro protocolo', () => {
    const html = '<a href="http://127.0.0.1:4317/api/items">x</a> <a href="http://localhost/x">y</a> <a href="https://ok.example/p/1">z</a>';
    expect(extractLinks(html, 'https?://[^"\\s<]+', 'https://fuente.example/')).toEqual(['https://ok.example/p/1']);
  });
});

describe('página de producto', () => {
  it('JSON-LD: título, precio e imagen (gana a Open Graph)', () => {
    expect(parseProductPage(fixture('product-jsonld.html'))).toEqual({
      title: 'Organisateur de câbles',
      fallbackTitle: 'Organisateur de câbles — Lien | Catálogo de prueba',
      price: 6.9,
      image: 'https://img.example/179000000000001_1.jpg',
      brand: null,
    });
  });

  it('JSON-LD con @graph, tipo múltiple, lowPrice y marca', () => {
    expect(parseProductPage(fixture('product-jsonld-brand.html'))).toMatchObject({
      title: 'Sac bandoulière',
      price: 45.4,
      image: 'https://img.example/179000000000002_1.jpg',
      brand: 'Ralph Lauren',
    });
  });

  it('meta tags: Open Graph y product:price:amount con coma decimal', () => {
    expect(parseProductPage(fixture('hacoo-meta.html'))).toEqual({
      title: 'Funda de silicona "Soft" para móvil',
      fallbackTitle: 'Hacoo - Sharing, Discovering and Inspiring',
      price: 3.49,
      image: 'https://img.hacoo.example/goods/funda-1.jpg',
      brand: null,
    });
  });

  it('JSON embebido en window.__INITIAL_STATE__', () => {
    expect(parseProductPage(fixture('hacoo-embedded.html'))).toMatchObject({
      title: 'Botella térmica 750 ml',
      price: 7.8,
      image: 'https://img.hacoo.example/goods/botella-1.jpg',
    });
  });

  it('JSON embebido en __NEXT_DATA__', () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"product":{"title":"Soporte portátil","price":12,"images":["https://img.example/s.jpg"]}}}}</script>';
    expect(parseProductPage(html)).toMatchObject({
      title: 'Soporte portátil',
      price: 12,
      image: 'https://img.example/s.jpg',
    });
  });

  it('si la página no expone datos (SPA), precio null y solo el <title> genérico', () => {
    expect(parseProductPage(fixture('hacoo-spa-shell.html'))).toEqual({
      title: null,
      fallbackTitle: 'Hacoo - Sharing, Discovering and Inspiring',
      price: null,
      image: null,
      brand: null,
    });
  });

  it('aguanta HTML vacío, JSON roto y precios absurdos', () => {
    const empty = { title: null, fallbackTitle: null, price: null, image: null, brand: null };
    expect(parseProductPage('')).toEqual(empty);
    expect(parseProductPage('<script type="application/ld+json">{ roto</script>')).toEqual(empty);
    const html =
      '<meta property="og:title" content="X"><meta property="product:price:amount" content="gratis"><meta property="og:image" content="javascript:alert(1)">';
    expect(parseProductPage(html)).toMatchObject({ title: 'X', price: null, image: null });
    expect(parseProductPage('<meta property="product:price:amount" content="-5">').price).toBeNull();
    expect(parseProductPage('<meta property="product:price:amount" content="0">').price).toBeNull();
  });
});

describe('utilidades', () => {
  it('decodifica entidades HTML', () => {
    expect(decodeEntities('a &amp; b &quot;c&quot; &#243; &#xF3; &desconocida;')).toBe('a & b "c" ó ó &desconocida;');
  });

  it('normaliza URLs para deduplicar', () => {
    expect(
      normalizeUrl('https://www.hacoo.pl/p/15660187?f=p_aff.o_alguien.g_affiliate&ets=1796848231100#top'),
    ).toBe('https://www.hacoo.pl/p/15660187');
    expect(normalizeUrl('https://Tienda.Example/producto/9/?utm_source=tg&b=2&a=1&ref=x')).toBe(
      'https://tienda.example/producto/9?a=1&b=2',
    );
    expect(normalizeUrl('https://tienda.example/')).toBe('https://tienda.example/');
    expect(normalizeUrl('https://tienda.example/p?id=7')).toBe('https://tienda.example/p?id=7');
  });

  it('solo permite URLs http(s) públicas', () => {
    for (const ok of ['https://t.me/s/canal', 'http://tienda.example/p/1', 'https://8.8.8.8/x']) {
      expect(isPublicHttpUrl(ok), ok).toBe(true);
    }
    for (const bad of [
      'http://localhost:4317/api/items',
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://router.local/',
      'http://intranet/',
      'ftp://tienda.example/x',
      'javascript:alert(1)',
      'file:///C:/Windows/win.ini',
      'no es una url',
    ]) {
      expect(isPublicHttpUrl(bad), bad).toBe(false);
    }
  });
});
