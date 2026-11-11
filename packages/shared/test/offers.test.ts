import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFER_TEMPLATE,
  dayKey,
  findForbiddenContent,
  formatOfferPrice,
  offerBlocker,
  offerPrice,
  randomDelaySeconds,
  remainingToday,
  renderOfferMessage,
  templateIssues,
} from '../src';

describe('precio de la oferta', () => {
  it('aplica el descuento y redondea hacia abajo al céntimo', () => {
    expect(offerPrice(20, 10)).toBe(18);
    expect(offerPrice(14, 10)).toBe(12.6);
    expect(offerPrice(9.99, 10)).toBe(8.99);
    expect(offerPrice(4.99, 10)).toBe(4.49);
    expect(offerPrice(0.1, 10)).toBe(0.09);
    expect(offerPrice(15, 15)).toBe(12.75);
    expect(offerPrice(19.9, 5)).toBe(18.9);
  });

  it('formatea sin decimales inútiles', () => {
    expect(formatOfferPrice(18)).toBe('18');
    expect(formatOfferPrice(12.6)).toBe('12,60');
    expect(formatOfferPrice(8.99)).toBe('8,99');
  });
});

describe('plantilla', () => {
  const values = { nombre: 'ana_23', titulo: 'Termo acero 500 ml', precio_final: '12,60', horas_envio: '48', descuento: '10' };

  it('rellena la plantilla por defecto', () => {
    expect(renderOfferMessage(DEFAULT_OFFER_TEMPLATE, values)).toBe(
      'Hola ana_23, vi que te gustó Termo acero 500 ml. Te lo dejo a 12,60 € (−10 %) y lo envío en 48 h. ¿Te lo reservo?',
    );
    expect(templateIssues(DEFAULT_OFFER_TEMPLATE)).toEqual([]);
  });

  it('deja intactas las variables desconocidas y compacta espacios', () => {
    expect(renderOfferMessage('Hola   {nombre}\n{otra}', values)).toBe('Hola ana_23 {otra}');
  });

  it('valida longitud, variables y contenido', () => {
    expect(templateIssues('Hola')).toEqual(['es demasiado corta']);
    expect(templateIssues('x'.repeat(501))[0]).toMatch(/500/);
    expect(templateIssues('Hola {nombre}, te dejo {titulo} a {precio}')[0]).toMatch(/variable desconocida \{precio\}/);
    expect(templateIssues('Hola {nombre}, escríbeme por WhatsApp y hablamos')[0]).toMatch(/otra plataforma/);
    expect(templateIssues('Hola {nombre}, mira mi tienda en https://tienda.example')[0]).toMatch(/enlace/);
  });
});

describe('regla 9: sin enlaces ni datos de contacto', () => {
  it('acepta mensajes normales', () => {
    for (const ok of [
      'Hola ana, te lo dejo a 12,60 € (−10 %) y lo envío en 48 h. ¿Te lo reservo?',
      'Camiseta talla M, 100 % algodón. Mide 70 cm.',
      'Lámpara LED 220 V 12 W',
    ]) {
      expect(findForbiddenContent(ok), ok).toBeNull();
    }
  });

  it('rechaza enlaces, correos, teléfonos, usuarios y otras plataformas', () => {
    const bad: [string, RegExp][] = [
      ['Mira http://ejemplo.test/oferta', /enlace/],
      ['Visita www.mitienda.example', /enlace/],
      ['Lo tienes en mitienda.com más barato', /enlace/],
      ['Escríbeme a ana@correo.es', /correo/],
      ['Sígueme, soy @ana_vende', /usuario/],
      ['Llámame al 612 345 678', /teléfono/],
      ['Mi número: +34612345678', /teléfono/],
      ['Hablamos por Instagram', /plataforma/],
      ['Te hago un Bizum', /plataforma/],
    ];
    for (const [text, expected] of bad) expect(findForbiddenContent(text), text).toMatch(expected);
  });
});

describe('elegibilidad (regla 8)', () => {
  const listing = { status: 'activo', price: 14 };

  it('solo anuncios activos, con precio y con item «en mano»', () => {
    expect(offerBlocker(listing, { stock: 'en_mano' })).toBeNull();
    expect(offerBlocker(listing, null)).toMatch(/enlaza/);
    for (const stock of ['idea', 'pedido', 'en_camino', 'listado', 'reservado', 'vendido', 'devuelto'] as const) {
      expect(offerBlocker(listing, { stock }), stock).toMatch(/en mano/);
    }
    expect(offerBlocker({ status: 'vendido', price: 14 }, { stock: 'en_mano' })).toMatch(/activo/);
    expect(offerBlocker({ status: 'activo', price: null }, { stock: 'en_mano' })).toMatch(/precio/);
    expect(offerBlocker({ status: 'activo', price: 0 }, { stock: 'en_mano' })).toMatch(/precio/);
  });
});

describe('ritmo y límite diario', () => {
  it('espera aleatoria dentro del rango', () => {
    expect(randomDelaySeconds(45, 120, 0)).toBe(45);
    expect(randomDelaySeconds(45, 120, 1)).toBe(120);
    expect(randomDelaySeconds(45, 120, 0.5)).toBe(83);
    expect(randomDelaySeconds(120, 45, 0)).toBe(45);
    for (let i = 0; i < 100; i++) {
      const delay = randomDelaySeconds(45, 120);
      expect(delay).toBeGreaterThanOrEqual(45);
      expect(delay).toBeLessThanOrEqual(120);
    }
  });

  it('mensajes que quedan hoy', () => {
    expect(remainingToday(15, 0)).toBe(15);
    expect(remainingToday(15, 14)).toBe(1);
    expect(remainingToday(15, 15)).toBe(0);
    expect(remainingToday(15, 40)).toBe(0);
    expect(remainingToday(0, 0)).toBe(0);
  });

  it('el día del contador es el local', () => {
    expect(dayKey(new Date(2026, 10, 9, 23, 59))).toBe('2026-11-09');
    expect(dayKey(new Date(2026, 10, 10, 0, 1))).toBe('2026-11-10');
  });
});
