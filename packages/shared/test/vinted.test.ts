import { describe, expect, it } from 'vitest';
import {
  VintedFormatError,
  classifyResponse,
  daysListed,
  isStale,
  nextSyncDelayMinutes,
  normalizeConversation,
  normalizeListing,
  normalizeNotification,
  pickCommandTab,
  parseInboxPage,
  parseNotificationsPage,
  parseWardrobePage,
} from '../src';

// Formas reales de las respuestas de vinted.es (valores inventados). Ver docs/vinted-endpoints.md.
const rawItem = (overrides: Record<string, unknown> = {}) => ({
  id: 7001234567,
  title: 'Zapatillas camuflaje talla 41',
  user_id: 1234,
  is_draft: false,
  is_closed: false,
  is_reserved: false,
  is_hidden: false,
  price: { amount: '20.0', currency_code: 'EUR' },
  item_closing_action: null,
  favourite_count: 4,
  view_count: 87,
  status: 'Muy bueno',
  photos: [
    { id: 1, high_resolution: { id: 'a', timestamp: 1793000000, orientation: null } },
    { id: 2, high_resolution: { id: 'b', timestamp: 1793000500, orientation: null } },
  ],
  ...overrides,
});

const rawNotification = (overrides: Record<string, unknown> = {}) => ({
  body: 'ana_23 ha marcado como favorito tu artículo "Zapatillas camuflaje talla 41".',
  entry_type: 20,
  id: '0193a1c2-aaaa-bbbb-cccc-1234567890ab',
  is_read: false,
  link: '/items/7001234567/want_it/new?offering_id=555',
  subject_id: 7001234567,
  updated_at: '2026-11-10T15:46:12+00:00',
  user_id: 555,
  ...overrides,
});

const rawConversation = (overrides: Record<string, unknown> = {}) => ({
  id: 24083642155,
  item_count: 1,
  description: 'Hola, ¿sigue disponible?',
  unread: true,
  updated_at: '2026-11-10T16:00:00+00:00',
  opposite_user: { id: 555, login: 'ana_23', photo: {}, badge: null },
  ...overrides,
});

describe('armario', () => {
  it('normaliza un anuncio activo', () => {
    expect(normalizeListing(rawItem())).toEqual({
      vinted_id: '7001234567',
      title: 'Zapatillas camuflaje talla 41',
      price: 20,
      status: 'activo',
      favs: 4,
      views: 87,
      listed_at: new Date(1793000000 * 1000).toISOString(),
    });
  });

  it('el estado sale de los flags, no del campo `status` (que es el estado de uso)', () => {
    expect(normalizeListing(rawItem({ is_draft: true }))?.status).toBe('borrador');
    expect(normalizeListing(rawItem({ is_closed: true, item_closing_action: 'sold' }))?.status).toBe('vendido');
    expect(normalizeListing(rawItem({ is_closed: true }))?.status).toBe('cerrado');
    expect(normalizeListing(rawItem({ is_reserved: true }))?.status).toBe('reservado');
    expect(normalizeListing(rawItem({ is_hidden: true }))?.status).toBe('oculto');
  });

  it('aguanta campos ausentes o raros', () => {
    expect(normalizeListing(rawItem({ photos: [], price: null, favourite_count: undefined, view_count: '12' }))).toMatchObject({
      price: null,
      favs: 0,
      views: 12,
      listed_at: null,
    });
    expect(normalizeListing(rawItem({ price: 15.5 }))?.price).toBe(15.5);
    expect(normalizeListing(rawItem({ id: null }))).toBeNull();
    expect(normalizeListing(rawItem({ title: '   ' }))).toBeNull();
  });

  it('lee la página y la paginación', () => {
    const page = parseWardrobePage({ items: [rawItem(), rawItem({ id: 7001234568 })], pagination: { current_page: 1, total_pages: 3 } });
    expect(page.rows.map((row) => row.vinted_id)).toEqual(['7001234567', '7001234568']);
    expect(page.totalPages).toBe(3);
    expect(parseWardrobePage({ items: [] })).toEqual({ rows: [], totalPages: 1 });
  });

  it('si el formato cambia, falla en vez de guardar basura', () => {
    expect(() => parseWardrobePage({ productos: [] })).toThrow(VintedFormatError);
    expect(() => parseWardrobePage('<html>')).toThrow(VintedFormatError);
    expect(() => parseWardrobePage({ items: [{ foo: 1 }, { bar: 2 }] })).toThrow(/armario/);
  });
});

describe('notificaciones', () => {
  it('favorito: tipo, anuncio, usuario y nombre', () => {
    expect(normalizeNotification(rawNotification())).toEqual({
      vinted_id: 'n:0193a1c2-aaaa-bbbb-cccc-1234567890ab',
      type: 'favorito',
      text: 'ana_23 ha marcado como favorito tu artículo "Zapatillas camuflaje talla 41".',
      listing_vinted_id: '7001234567',
      user_id: '555',
      username: 'ana_23',
      at: '2026-11-10T15:46:12.000Z',
      read: false,
    });
  });

  it('clasifica otros tipos por el texto y quita HTML', () => {
    const sale = normalizeNotification(rawNotification({ entry_type: 99, body: '<b>¡Enhorabuena!</b> Has vendido tu artículo', link: '/inbox/1' }));
    expect(sale).toMatchObject({ type: 'venta', text: '¡Enhorabuena! Has vendido tu artículo', listing_vinted_id: null, username: null });
    expect(normalizeNotification(rawNotification({ entry_type: 5, body: 'Tu pedido está en camino', link: '' }))?.type).toBe('otro');
    expect(normalizeNotification(rawNotification({ body: '' }))).toBeNull();
    expect(normalizeNotification(rawNotification({ id: 'con espacios no' }))).toBeNull();
  });

  it('no confunde avisos de anuncios ajenos con favoritos o ventas propios', () => {
    const type = (body: string, entry_type = 7) => normalizeNotification(rawNotification({ entry_type, body, link: '/items/9' }))?.type;
    expect(type('Un artículo de tus favoritos ha bajado de precio')).toBe('otro');
    expect(type('Un artículo de tu lista de favoritos se ha vendido')).toBe('otro');
    expect(type('El artículo que te gustaba ya está vendido')).toBe('otro');
    expect(type('luis ha marcado como favorito tu artículo "Termo"')).toBe('favorito');
    expect(type('Se ha vendido tu artículo "Termo"')).toBe('venta');
    expect(type('marta te ha enviado un mensaje')).toBe('mensaje');
    expect(type('Lee nuestros consejos sobre mensajes')).toBe('otro');
  });

  it('lee la página', () => {
    const page = parseNotificationsPage({ notifications: [rawNotification()], pagination: { total_pages: 2 } });
    expect(page.rows).toHaveLength(1);
    expect(page.totalPages).toBe(2);
    expect(() => parseNotificationsPage({ error: 'x' })).toThrow(/notificaciones/);
  });
});

describe('bandeja de mensajes', () => {
  it('una conversación sin leer genera un evento de mensaje', () => {
    expect(normalizeConversation(rawConversation())).toEqual({
      user_id: '555',
      event: {
        vinted_id: 'm:24083642155:2026-11-10T16:00:00.000Z',
        type: 'mensaje',
        text: 'ana_23: Hola, ¿sigue disponible?',
        listing_vinted_id: null,
        user_id: '555',
        username: 'ana_23',
        at: '2026-11-10T16:00:00.000Z',
        read: false,
      },
    });
  });

  it('un mensaje nuevo en la misma conversación es otro evento; una leída no genera nada', () => {
    const later = normalizeConversation(rawConversation({ updated_at: '2026-11-10T17:30:00+00:00' }));
    expect(later?.event?.vinted_id).toBe('m:24083642155:2026-11-10T17:30:00.000Z');
    expect(normalizeConversation(rawConversation({ unread: false }))).toEqual({ user_id: '555', event: null });
  });

  it('lee la página', () => {
    const page = parseInboxPage({ conversations: [rawConversation(), rawConversation({ id: 2, unread: false })] });
    expect(page.rows.map((row) => row.user_id)).toEqual(['555', '555']);
    expect(() => parseInboxPage({})).toThrow(/bandeja/);
  });
});

describe('pestaña de un comando', () => {
  const tabs = [{ id: 1 }, { id: 2, active: true }, { id: 3 }];
  it('sigue en la misma pestaña aunque cambie la activa', () => {
    expect(pickCommandTab(tabs, { id: 9, tabId: 3 }, 9)).toBe(3);
  });
  it('un comando nuevo o una pestaña cerrada van a la activa o a la primera', () => {
    expect(pickCommandTab(tabs, null, 9)).toBe(2);
    expect(pickCommandTab(tabs, { id: 8, tabId: 3 }, 9)).toBe(2);
    expect(pickCommandTab(tabs, { id: 9, tabId: 7 }, 9)).toBe(2);
    expect(pickCommandTab([{ id: 4 }, { id: 5 }], null, 9)).toBe(4);
    expect(pickCommandTab([{}], null, 9)).toBeNull();
    expect(pickCommandTab([], null, 9)).toBeNull();
  });
});

describe('reglas de la sync', () => {
  it('cada 15 min con jitter de ±2', () => {
    expect(nextSyncDelayMinutes(0)).toBe(13);
    expect(nextSyncDelayMinutes(0.5)).toBe(15);
    expect(nextSyncDelayMinutes(1)).toBe(17);
    expect(nextSyncDelayMinutes(7)).toBe(17);
    for (let i = 0; i < 50; i++) {
      const delay = nextSyncDelayMinutes();
      expect(delay).toBeGreaterThanOrEqual(13);
      expect(delay).toBeLessThanOrEqual(17);
    }
  });

  it('días publicado y stale', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    expect(daysListed('2026-11-05T12:00:00Z', now)).toBe(15);
    expect(daysListed('2026-11-20T11:00:00Z', now)).toBe(0);
    expect(daysListed(null, now)).toBeNull();
    expect(daysListed('ayer', now)).toBeNull();

    expect(isStale({ status: 'activo', listed_at: '2026-11-05T12:00:00Z' }, 14, now)).toBe(true);
    expect(isStale({ status: 'activo', listed_at: '2026-11-06T12:00:00Z' }, 14, now)).toBe(false);
    expect(isStale({ status: 'vendido', listed_at: '2026-01-01T00:00:00Z' }, 14, now)).toBe(false);
    expect(isStale({ status: 'activo', listed_at: null }, 14, now)).toBe(false);
  });

  it('clasifica las respuestas que obligan a parar', () => {
    expect(classifyResponse(200, true)).toBeNull();
    expect(classifyResponse(403, true)).toBe('blocked');
    expect(classifyResponse(429, false)).toBe('rate_limited');
    expect(classifyResponse(401, true)).toBe('logged_out');
    expect(classifyResponse(0, false)).toBe('redirect');
    expect(classifyResponse(302, false)).toBe('redirect');
    expect(classifyResponse(200, false)).toBe('verification');
    expect(classifyResponse(404, true)).toBe('error');
    expect(classifyResponse(500, false)).toBe('error');
  });
});
