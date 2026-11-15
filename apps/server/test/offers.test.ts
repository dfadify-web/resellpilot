import type { CommandStep, CommandView, OfferPlan } from '@resellpilot/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { DEFAULT_EXTENSION_ID } from '../src/config';
import { openDb, type Db } from '../src/db';
import { advanceCommand, buildPlan, createCommand, getCommand, nextCommand, sentToday } from '../src/offers/service';

const ORIGIN = `chrome-extension://${DEFAULT_EXTENSION_ID}`;

let db: Db;
let app: FastifyInstance;
let itemId: number;
let listingId: number;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await buildApp({ db, dashboard: 'none' });
  itemId = Number(db.prepare("INSERT INTO items (name, cost, stock) VALUES ('Termo', 5, 'en_mano')").run().lastInsertRowid);
  listingId = addListing('7001', 'Termo acero 500 ml', 14, itemId);
});
afterEach(async () => {
  await app.close();
  db.close();
});

function addListing(vintedId: string, title: string, price: number | null, item: number | null, status = 'activo'): number {
  return Number(
    db
      .prepare('INSERT INTO listings (vinted_id, title, price, status, item_id) VALUES (?, ?, ?, ?, ?)')
      .run(vintedId, title, price, status, item).lastInsertRowid,
  );
}
function addFavoriter(listing: number, userId: string, username: string | null = `user${userId}`): number {
  return Number(
    db.prepare('INSERT INTO favoriters (listing_id, vinted_user_id, username) VALUES (?, ?, ?)').run(listing, userId, username)
      .lastInsertRowid,
  );
}
const setSetting = (key: string, value: string) => db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
const goReal = () => setSetting('DRY_RUN', 'false');
const favoriter = (id: number) =>
  db.prepare('SELECT offered_at, has_conversation FROM favoriters WHERE id = ?').get(id) as { offered_at: string | null; has_conversation: number };
const actions = (action: string) =>
  db.prepare('SELECT target, result FROM action_log WHERE action = ? ORDER BY id').all(action) as { target: string; result: string }[];

/** Reloj controlado para las esperas. */
let clock = new Date(2026, 10, 11, 10, 0, 0);
const tick = (seconds: number) => (clock = new Date(clock.getTime() + seconds * 1000));
const step = (id: number, last?: { index: number; ok: boolean; stop?: boolean; error?: string }, random = 0): CommandStep =>
  advanceCommand(db, id, last, { now: clock, random: () => random });

/** Ejecuta un comando hasta el final respondiendo "ok" a cada paso. Devuelve los pasos ejecutados. */
function runAll(id: number): Extract<CommandStep, { action: 'do' }>[] {
  const executed: Extract<CommandStep, { action: 'do' }>[] = [];
  let last: { index: number; ok: boolean } | undefined;
  for (let guard = 0; guard < 200; guard++) {
    const next = step(id, last);
    last = undefined;
    if (next.action === 'finished') return executed;
    if (next.action === 'wait') tick(next.seconds);
    else {
      executed.push(next);
      last = { index: next.index, ok: true };
    }
  }
  throw new Error('el comando no termina');
}

beforeEach(() => {
  clock = new Date(2026, 10, 11, 10, 0, 0);
});

describe('plan de ofertas', () => {
  it('muestra precio actual, precio nuevo, nº de favoriters y el mensaje exacto', () => {
    const ana = addFavoriter(listingId, '501', 'ana_23');
    const luis = addFavoriter(listingId, '502', 'luis');
    db.prepare("UPDATE favoriters SET offered_at = '2026-11-01T00:00:00.000Z' WHERE id = ?").run(luis);
    const eva = addFavoriter(listingId, '503', 'eva');
    db.prepare('UPDATE favoriters SET has_conversation = 1 WHERE id = ?').run(eva);

    const plan = buildPlan(db, clock);
    expect(plan).toMatchObject({ dry_run: true, discount_pct: 10, max_per_day: 15, sent_today: 0, remaining_today: 15, active_command_id: null });
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ title: 'Termo acero 500 ml', price: 14, new_price: 12.6, blocker: null, pending: 1 });
    const byName = Object.fromEntries((plan.rows[0]?.recipients ?? []).map((r) => [r.username, r]));
    expect(byName.ana_23).toMatchObject({
      favoriter_id: ana,
      state: 'pendiente',
      message: 'Hola ana_23, vi que te gustó Termo acero 500 ml. Te lo dejo a 12,60 € (−10 %) y lo envío en 48 h. ¿Te lo reservo?',
    });
    expect(byName.luis).toMatchObject({ state: 'ofertado', message: null });
    expect(byName.eva).toMatchObject({ state: 'con_conversacion', message: null });
  });

  it('bloquea los anuncios sin item «en mano» (regla 8), inactivos o con título no permitido', () => {
    const listado = Number(db.prepare("INSERT INTO items (name, stock) VALUES ('B', 'listado')").run().lastInsertRowid);
    const enMano2 = Number(db.prepare("INSERT INTO items (name, stock) VALUES ('C', 'en_mano')").run().lastInsertRowid);
    const enMano3 = Number(db.prepare("INSERT INTO items (name, stock) VALUES ('D', 'en_mano')").run().lastInsertRowid);
    const cases: [number, RegExp][] = [
      [addListing('8001', 'Sin enlazar', 10, null), /enlaza/],
      [addListing('8002', 'Item listado', 10, listado), /en mano/],
      [addListing('8003', 'Vendido', 10, enMano2, 'vendido'), /activo/],
      [addListing('8004', 'Más info en mitienda.com', 10, enMano3), /enlace/],
    ];
    for (const [id] of cases) addFavoriter(id, '900');
    addFavoriter(listingId, '901');

    const rows = buildPlan(db, clock).rows;
    // Lo ofertable va primero.
    expect(rows[0]).toMatchObject({ listing_id: listingId, blocker: null, pending: 1 });
    for (const [id, reason] of cases) {
      const row = rows.find((r) => r.listing_id === id);
      expect(row?.blocker, String(id)).toMatch(reason);
      expect(row?.recipients.every((r) => r.message === null)).toBe(true);
    }
  });

  it('respeta la plantilla y el descuento de Ajustes; sin nombre no deja huecos', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { settings: { OFFER_DISCOUNT_PCT: 20, SHIP_HOURS: 24 }, offer_template: 'Hola {nombre}, {titulo} a {precio_final} € (−{descuento} %), envío en {horas_envio} h.' },
    });
    addFavoriter(listingId, '501', null);
    expect(buildPlan(db, clock).rows[0]).toMatchObject({ new_price: 11.2 });
    expect(buildPlan(db, clock).rows[0]?.recipients[0]?.message).toBe('Hola, Termo acero 500 ml a 11,20 € (−20 %), envío en 24 h.');
  });

  it('la plantilla se valida al guardarla', async () => {
    const put = (offer_template: string) => app.inject({ method: 'PUT', url: '/api/settings', payload: { offer_template } });
    expect((await put('Hola {nombre}, escríbeme al 612 345 678')).statusCode).toBe(400);
    expect((await put('Hola {nombre}, mira https://tienda.example')).statusCode).toBe(400);
    expect((await put('Hola {nombre}, {titulo} a {precio}')).statusCode).toBe(400);
    expect((await put('')).json()).toMatchObject({ offer_template: expect.stringContaining('¿Te lo reservo?') });
  });
});

describe('crear un comando (tras confirmar)', () => {
  it('solo incluye lo que sigue siendo elegible y no admite dos a la vez', () => {
    const ana = addFavoriter(listingId, '501', 'ana');
    const luis = addFavoriter(listingId, '502', 'luis');
    db.prepare('UPDATE favoriters SET has_conversation = 1 WHERE id = ?').run(luis);
    const blocked = addListing('8001', 'Sin enlazar', 10, null);
    const other = addFavoriter(blocked, '503');

    const command = createCommand(db, { type: 'send_offers', favoriter_ids: [ana, luis, other, 9999, ana] }, clock);
    expect(command).toMatchObject({ type: 'send_offers', status: 'pending', dry_run: true, total: 1, done: 0, progress: 0 });
    expect(command.log[0]?.text).toMatch(/SIMULACIÓN · 1 mensaje/);

    expect(() => createCommand(db, { type: 'send_offers', favoriter_ids: [ana] }, clock)).toThrow(/ya hay un comando/);
    expect(buildPlan(db, clock).active_command_id).toBe(command.id);
  });

  it('rechaza una selección sin nada ofertable y un mensaje con contenido prohibido', () => {
    const blocked = addListing('8001', 'Sin enlazar', 10, null);
    expect(() => createCommand(db, { type: 'send_offers', favoriter_ids: [addFavoriter(blocked, '503')] }, clock)).toThrow(/nada de lo seleccionado/);
    // El nombre de usuario también forma parte del mensaje.
    const spam = addFavoriter(listingId, '504', 'visita.mitienda.com');
    expect(() => createCommand(db, { type: 'send_offers', favoriter_ids: [spam] }, clock)).toThrow(/nada de lo seleccionado/);
    expect(() => createCommand(db, { type: 'price_drop', listing_ids: [blocked] }, clock)).toThrow(/nada de lo seleccionado/);
  });

  it('Modo A: solo anuncios elegibles con favoriters pendientes', () => {
    addFavoriter(listingId, '501');
    const sinFavs = addListing('7002', 'Lámpara', 20, Number(db.prepare("INSERT INTO items (name, stock) VALUES ('L', 'en_mano')").run().lastInsertRowid));
    const command = createCommand(db, { type: 'price_drop', listing_ids: [listingId, sinFavs] }, clock);
    expect(command).toMatchObject({ type: 'price_drop', total: 1 });
  });
});

describe('DRY_RUN (por defecto)', () => {
  it('simula cada envío, lo registra y no cambia nada', () => {
    const ana = addFavoriter(listingId, '501', 'ana');
    const luis = addFavoriter(listingId, '502', 'luis');
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: [ana, luis] }, clock);

    const executed = runAll(command.id);
    expect(executed.map((s) => [s.kind, s.dry_run, s.user_id, s.listing_vinted_id, s.new_price])).toEqual([
      ['message', true, '502', '7001', 12.6],
      ['message', true, '501', '7001', 12.6],
    ].reverse());
    expect(executed[0]?.message).toContain('Hola ana, vi que te gustó Termo acero 500 ml');

    const view = getCommand(db, command.id);
    expect(view).toMatchObject({ status: 'done', done: 2, total: 2, progress: 1, error: null });
    expect(view.log.filter((line) => line.text.startsWith('SIMULACIÓN · mensaje a'))).toHaveLength(2);
    // Nada real: ni ofertados, ni contador diario, ni precio.
    expect(favoriter(ana).offered_at).toBeNull();
    expect(sentToday(db, clock)).toBe(0);
    expect(actions('offer_sent')).toEqual([]);
    expect(actions('offer_dry_run')).toHaveLength(2);
    // Y se puede volver a lanzar.
    expect(buildPlan(db, clock).rows[0]?.pending).toBe(2);
  });

  it('Modo A simulado: muestra el cambio y no toca el precio', () => {
    addFavoriter(listingId, '501');
    const command = createCommand(db, { type: 'price_drop', listing_ids: [listingId] }, clock);
    const [done] = runAll(command.id);
    expect(done).toMatchObject({ kind: 'price', dry_run: true, new_price: 12.6, message: null, user_id: null });
    expect(getCommand(db, command.id).log.some((l) => l.text === 'SIMULACIÓN · bajaría «Termo acero 500 ml»: 14 € → 12,60 €')).toBe(true);
    expect(db.prepare('SELECT price FROM listings WHERE id = ?').get(listingId)).toEqual({ price: 14 });
    expect(actions('price_drop')).toEqual([]);
  });

  it('si la extensión se reinicia a mitad de un paso simulado, lo repite', () => {
    const ana = addFavoriter(listingId, '501', 'ana');
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: [ana] }, clock);
    expect(step(command.id)).toMatchObject({ action: 'do', index: 0 });
    expect(step(command.id)).toMatchObject({ action: 'do', index: 0 });
  });

  it('DRY_RUN no se puede desactivar desde Ajustes mientras la escritura real no esté habilitada', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { settings: { DRY_RUN: false } } });
    expect(res.statusCode).toBe(400);
    expect(buildPlan(db, clock).dry_run).toBe(true);
  });
});

describe('envío real: esperas', () => {
  it('espera entre MSG_DELAY_MIN_S y MSG_DELAY_MAX_S antes del siguiente mensaje', () => {
    goReal();
    const a = addFavoriter(listingId, '501', 'ana');
    const b = addFavoriter(listingId, '502', 'luis');
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: [a, b] }, clock);
    expect(command.dry_run).toBe(false);

    const first = step(command.id);
    expect(first).toMatchObject({ action: 'do', index: 0, dry_run: false });
    // random = 0,5 → 45 + 0,5·75 = 82,5 → 83 s
    expect(step(command.id, { index: 0, ok: true }, 0.5)).toEqual({ action: 'wait', seconds: 83, done: 1, total: 2 });
    tick(60);
    expect(step(command.id)).toEqual({ action: 'wait', seconds: 23, done: 1, total: 2 });
    tick(22);
    expect(step(command.id)).toMatchObject({ action: 'wait', seconds: 1 });
    tick(1);
    expect(step(command.id)).toMatchObject({ action: 'do', index: 1 });
    expect(step(command.id, { index: 1, ok: true })).toEqual({ action: 'finished', status: 'done', error: null });

    expect(actions('offer_sent')).toHaveLength(2);
    expect(favoriter(a).offered_at).not.toBeNull();
    expect(favoriter(b).offered_at).not.toBeNull();
  });

  it('los extremos de la espera son los de Ajustes', () => {
    goReal();
    const ids = [addFavoriter(listingId, '501'), addFavoriter(listingId, '502'), addFavoriter(listingId, '503')];
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: ids }, clock);
    step(command.id);
    expect(step(command.id, { index: 0, ok: true }, 0)).toMatchObject({ action: 'wait', seconds: 45 });
    tick(45);
    step(command.id);
    expect(step(command.id, { index: 1, ok: true }, 0.999999)).toMatchObject({ action: 'wait', seconds: 120 });
  });
});

describe('envío real: límite diario', () => {
  it('para al llegar a MAX_MESSAGES_PER_DAY y el contador persiste entre comandos', () => {
    goReal();
    setSetting('MAX_MESSAGES_PER_DAY', '2');
    const ids = ['501', '502', '503', '504'].map((user) => addFavoriter(listingId, user));

    const first = createCommand(db, { type: 'send_offers', favoriter_ids: ids }, clock);
    expect(runAll(first.id)).toHaveLength(2);
    const view = getCommand(db, first.id);
    expect(view).toMatchObject({ status: 'done', done: 2, total: 4 });
    expect(view.error).toMatch(/Límite diario alcanzado \(2 mensajes el 2026-11-11\)\. Quedan 2 sin enviar/);
    expect(sentToday(db, clock)).toBe(2);
    expect(buildPlan(db, clock)).toMatchObject({ sent_today: 2, remaining_today: 0 });

    // Otro comando el mismo día no envía nada.
    const second = createCommand(db, { type: 'send_offers', favoriter_ids: ids }, clock);
    expect(second.total).toBe(2);
    expect(runAll(second.id)).toHaveLength(0);
    expect(sentToday(db, clock)).toBe(2);

    // Al día siguiente el contador vuelve a cero.
    clock = new Date(2026, 10, 12, 9, 0, 0);
    expect(sentToday(db, clock)).toBe(0);
    const third = createCommand(db, { type: 'send_offers', favoriter_ids: ids }, clock);
    expect(runAll(third.id)).toHaveLength(2);
    expect(actions('offer_sent')).toHaveLength(4);
  });

  it('con el límite a 0 no se envía nada', () => {
    goReal();
    setSetting('MAX_MESSAGES_PER_DAY', '0');
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: [addFavoriter(listingId, '501')] }, clock);
    expect(runAll(command.id)).toHaveLength(0);
    expect(actions('offer_sent')).toEqual([]);
  });
});

describe('envío real: duplicados y conversaciones', () => {
  it('nunca dos veces al mismo usuario por el mismo anuncio', () => {
    goReal();
    const ana = addFavoriter(listingId, '501', 'ana');
    const first = createCommand(db, { type: 'send_offers', favoriter_ids: [ana] }, clock);
    expect(runAll(first.id)).toHaveLength(1);

    expect(buildPlan(db, clock).rows[0]).toMatchObject({ pending: 0 });
    expect(() => createCommand(db, { type: 'send_offers', favoriter_ids: [ana] }, clock)).toThrow(/nada de lo seleccionado/);
    expect(actions('offer_sent')).toEqual([{ target: '7001:501', result: expect.stringContaining('Hola ana') }]);
  });

  it('el mismo usuario sí puede recibir oferta por otro anuncio', () => {
    goReal();
    const item2 = Number(db.prepare("INSERT INTO items (name, stock) VALUES ('L', 'en_mano')").run().lastInsertRowid);
    const listing2 = addListing('7002', 'Lámpara LED', 20, item2);
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: [addFavoriter(listingId, '501'), addFavoriter(listing2, '501')] }, clock);
    expect(runAll(command.id).map((s) => s.listing_vinted_id).sort()).toEqual(['7001', '7002']);
  });

  it('salta a quien ya tiene conversación o ya fue ofertado mientras el comando esperaba', () => {
    goReal();
    const a = addFavoriter(listingId, '501', 'ana');
    const b = addFavoriter(listingId, '502', 'luis');
    const c = addFavoriter(listingId, '503', 'eva');
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: [a, b, c] }, clock);

    // Tras confirmar: una sync detecta conversación con luis, y eva recibe la oferta por otra vía.
    db.prepare('UPDATE favoriters SET has_conversation = 1 WHERE id = ?').run(b);
    db.prepare("UPDATE favoriters SET offered_at = '2026-11-11T09:00:00.000Z' WHERE id = ?").run(c);

    expect(runAll(command.id).map((s) => s.user_id)).toEqual(['501']);
    const log = getCommand(db, command.id).log.map((l) => l.text);
    expect(log).toContain('Omitido · luis · Termo acero 500 ml: ya hay conversación con este usuario.');
    expect(log).toContain('Omitido · eva · Termo acero 500 ml: ya se le hizo una oferta por este anuncio.');
    expect(getCommand(db, command.id)).toMatchObject({ status: 'done', done: 1, total: 3 });
  });

  it('salta los pasos de un anuncio que deja de ser elegible (regla 8)', () => {
    goReal();
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: [addFavoriter(listingId, '501', 'ana')] }, clock);
    db.prepare("UPDATE items SET stock = 'reservado' WHERE id = ?").run(itemId);
    expect(runAll(command.id)).toHaveLength(0);
    expect(getCommand(db, command.id).log.some((l) => /Omitido · ana · .*en mano/.test(l.text))).toBe(true);
  });
});

describe('paradas', () => {
  function started(users: string[]) {
    goReal();
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: users.map((u) => addFavoriter(listingId, u)) }, clock);
    expect(step(command.id)).toMatchObject({ action: 'do', index: 0 });
    return command.id;
  }

  it('captcha, 403, 429, sesión cerrada o DOM inesperado: failed inmediato y sin reintentos', () => {
    for (const reason of ['Vinted pide una verificación o captcha.', 'Vinted respondió 403 (acceso denegado).', 'Vinted respondió 429 (demasiadas peticiones).', 'La sesión de Vinted está cerrada.', 'DOM inesperado: no se encontró el cuadro de mensaje.']) {
      db.prepare('DELETE FROM commands').run();
      db.prepare('DELETE FROM favoriters').run();
      const id = started(['501', '502', '503']);
      expect(step(id, { index: 0, ok: false, stop: true, error: reason })).toEqual({ action: 'finished', status: 'failed', error: `Parada: ${reason}` });
      // No sigue con los demás ni vuelve a intentarlo.
      expect(step(id)).toEqual({ action: 'finished', status: 'failed', error: `Parada: ${reason}` });
      expect(getCommand(db, id)).toMatchObject({ status: 'failed', done: 0 });
    }
    expect(actions('offer_sent')).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM favoriters WHERE offered_at IS NOT NULL').get()).toEqual({ n: 0 });
  });

  it('cualquier otro fallo también detiene el comando', () => {
    const id = started(['501', '502']);
    expect(step(id, { index: 0, ok: false, error: 'Vinted rechazó el mensaje.' })).toMatchObject({ action: 'finished', status: 'failed', error: 'Fallo: Vinted rechazó el mensaje.' });
  });

  it('si no se sabe si un envío real llegó a hacerse, no se repite', () => {
    const id = started(['501']);
    // La extensión vuelve a pedir paso sin informar del anterior.
    const next = step(id);
    expect(next).toMatchObject({ action: 'finished', status: 'failed' });
    expect((next as { error: string }).error).toMatch(/No se sabe si el paso/);
    expect(actions('offer_sent')).toEqual([]);
  });

  it('botón PARAR y cancelación desde el dashboard', async () => {
    const id = started(['501', '502']);
    const stop = await app.inject({ method: 'POST', url: `/api/vinted/commands/${id}/cancel`, headers: { origin: ORIGIN } });
    expect(stop.json()).toMatchObject({ status: 'cancelled', error: 'Parado con el botón PARAR en la pestaña de Vinted.' });
    expect(step(id, { index: 0, ok: true })).toMatchObject({ action: 'finished', status: 'cancelled' });
    expect(actions('offer_sent')).toEqual([]);

    const again = createCommand(db, { type: 'send_offers', favoriter_ids: [1] }, clock);
    const cancel = await app.inject({ method: 'POST', url: `/api/commands/${again.id}/cancel` });
    expect(cancel.json()).toMatchObject({ status: 'cancelled', error: 'Cancelado desde el dashboard.' });
    expect(buildPlan(db, clock).active_command_id).toBeNull();
  });
});

describe('Modo A real (lógica del server)', () => {
  it('actualiza el precio, registra la acción y marca a los favoriters como ofertados', () => {
    goReal();
    const ana = addFavoriter(listingId, '501');
    const command = createCommand(db, { type: 'price_drop', listing_ids: [listingId] }, clock);
    expect(runAll(command.id)).toMatchObject([{ kind: 'price', dry_run: false, listing_vinted_id: '7001', new_price: 12.6 }]);
    expect(db.prepare('SELECT price FROM listings WHERE id = ?').get(listingId)).toEqual({ price: 12.6 });
    expect(actions('price_drop')).toEqual([{ target: '7001', result: '14 € → 12,60 €' }]);
    expect(favoriter(ana).offered_at).not.toBeNull();
    // No cuenta para el límite de mensajes.
    expect(sentToday(db, clock)).toBe(0);
  });

  it('no baja el precio si cambió desde la confirmación', () => {
    goReal();
    addFavoriter(listingId, '501');
    const command = createCommand(db, { type: 'price_drop', listing_ids: [listingId] }, clock);
    db.prepare('UPDATE listings SET price = 11 WHERE id = ?').run(listingId);
    expect(runAll(command.id)).toHaveLength(0);
    expect(getCommand(db, command.id).log.some((l) => /el precio del anuncio ha cambiado/.test(l.text))).toBe(true);
  });
});

describe('API', () => {
  it('el dashboard crea y consulta; solo la extensión ejecuta', async () => {
    const ana = addFavoriter(listingId, '501', 'ana');
    const plan = (await app.inject({ method: 'GET', url: '/api/offers/plan' })).json() as OfferPlan;
    expect(plan.rows[0]?.pending).toBe(1);

    const bad = await app.inject({ method: 'POST', url: '/api/commands', payload: { type: 'send_offers', favoriter_ids: [] } });
    expect(bad.statusCode).toBe(400);
    const created = await app.inject({ method: 'POST', url: '/api/commands', payload: { type: 'send_offers', favoriter_ids: [ana] } });
    expect(created.statusCode).toBe(201);
    const command = created.json() as CommandView;

    // Sin el origen de la extensión no se puede ejecutar.
    expect((await app.inject({ method: 'GET', url: '/api/vinted/commands/next' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/vinted/commands/${command.id}/step`, payload: {}, headers: { origin: 'https://www.vinted.es' } })).statusCode).toBe(403);

    const headers = { origin: ORIGIN };
    const next = (await app.inject({ method: 'GET', url: '/api/vinted/commands/next', headers })).json();
    expect(next).toEqual({ command: { id: command.id, type: 'send_offers', total: 1, dry_run: true } });

    const first = (await app.inject({ method: 'POST', url: `/api/vinted/commands/${command.id}/step`, payload: {}, headers })).json() as CommandStep;
    expect(first).toMatchObject({ action: 'do', index: 0, kind: 'message', dry_run: true, label: 'ana · Termo acero 500 ml' });
    const second = (
      await app.inject({ method: 'POST', url: `/api/vinted/commands/${command.id}/step`, payload: { last: { index: 0, ok: true } }, headers })
    ).json();
    expect(second).toEqual({ action: 'finished', status: 'done', error: null });

    const list = (await app.inject({ method: 'GET', url: '/api/commands' })).json() as CommandView[];
    expect(list[0]).toMatchObject({ id: command.id, status: 'done', done: 1, total: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/vinted/commands/next', headers })).json()).toEqual({ command: null });
    expect((await app.inject({ method: 'POST', url: '/api/commands/9999/cancel' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/vinted/commands/${command.id}/step`, payload: { last: { index: 0, ok: true, cookies: 'x' } }, headers })).statusCode).toBe(400);
  });
});

describe('pausa de la extensión (Regla 5)', () => {
  const pause = () => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('VINTED_PAUSED', 'true')").run();

  it('un comando en marcha se para en cuanto la lectura de Vinted se pausa', () => {
    const ids = [addFavoriter(listingId, '501'), addFavoriter(listingId, '502')];
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: ids }, clock);
    expect(step(command.id)).toMatchObject({ action: 'do', index: 0 });

    pause();
    expect(step(command.id, { index: 0, ok: true })).toMatchObject({ action: 'finished', status: 'failed' });
    const view = getCommand(db, command.id);
    expect(view).toMatchObject({ status: 'failed', done: 1 }); // el paso ya hecho cuenta
    expect(view.error).toMatch(/en pausa/);
  });

  it('con la lectura en pausa no se entregan ni se crean comandos', async () => {
    const command = createCommand(db, { type: 'send_offers', favoriter_ids: [addFavoriter(listingId, '501')] }, clock);
    expect(nextCommand(db)).toMatchObject({ id: command.id });
    pause();
    expect(nextCommand(db)).toBeNull();

    db.prepare('UPDATE commands SET status = ?').run('cancelled');
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'send_offers', favoriter_ids: [addFavoriter(listingId, '502')] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatch(/en pausa/);
  });
});
