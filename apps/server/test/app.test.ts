import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { HOST, loadConfig } from '../src/config';
import { openDb, type Db } from '../src/db';

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await buildApp({ db, dashboard: 'none' });
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe('app', () => {
  it('GET /api/health responde ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe(true);
    expect(body.migrations).toBeGreaterThanOrEqual(1);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it('rutas de API desconocidas devuelven 404 JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', path: '/api/no-existe' });
  });
});

describe('config', () => {
  it('valores por defecto: loopback y puerto 4317', () => {
    const config = loadConfig({});
    expect(HOST).toBe('127.0.0.1');
    expect(config.port).toBe(4317);
    expect(config.openBrowser).toBe(true);
    expect(config.dbPath.replaceAll('\\', '/')).toMatch(/\/data\/resellpilot\.db$/);
  });

  it('ignora variables vacías y valida el puerto', () => {
    expect(loadConfig({ PORT: '', OPEN_BROWSER: 'false' })).toMatchObject({
      port: 4317,
      openBrowser: false,
    });
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
  });
});
