import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { BLOCKLIST_PATH, DASHBOARD_DIR, SOURCES_PATH } from './config';
import type { Db } from './db';
import { Ingestor } from './deals/ingest';
import { registerDealRoutes, type DealsDeps } from './deals/routes';
import { NotFoundError, ValidationError, zodIssues } from './errors';
import { httpFetcher } from './http';
import { registerItemRoutes } from './items/routes';
import { nullNotifier } from './telegram';

/** Dependencias de oportunidades por defecto: red real, archivos de la raíz y sin Telegram. */
export function defaultDealsDeps(db: Db): DealsDeps {
  return {
    notifier: nullNotifier,
    blocklistPath: BLOCKLIST_PATH,
    ingestor: new Ingestor({
      db,
      fetcher: httpFetcher,
      notifier: nullNotifier,
      sourcesPath: SOURCES_PATH,
      blocklistPath: BLOCKLIST_PATH,
    }),
  };
}

export interface AppOptions {
  db: Db;
  /** Ingesta, notificador y lista de marcas. Por defecto, `defaultDealsDeps`. */
  deals?: DealsDeps;
  /**
   * Cómo servir el dashboard:
   * - `vite`: dev server de Vite embebido (HMR).
   * - `static`: build de `apps/dashboard/dist`.
   * - `none`: solo API (tests).
   */
  dashboard: 'vite' | 'static' | 'none';
}

const isApi = (url: string) => url === '/api' || url.startsWith('/api/');

/** Solo se atienden peticiones dirigidas a este equipo (frena el DNS rebinding). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export async function buildApp({ db, dashboard, deals }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'warn' } });

  app.addHook('onRequest', async (request, reply) => {
    const host = (request.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (!LOCAL_HOSTS.has(host)) {
      return reply.code(403).send({ error: 'forbidden_host' });
    }
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', issues: zodIssues(error) });
    }
    if (error instanceof ValidationError) {
      return reply.code(400).send({ error: 'validation', issues: error.issues });
    }
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: 'not_found', message: error.message });
    }
    const status = 'statusCode' in error && error.statusCode ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: 'internal', message: 'Error interno del server.' });
    }
    return reply.code(status).send({ error: 'bad_request', message: error.message });
  });

  app.get('/api/health', async () => {
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number };
    const migrations = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number };
    return {
      status: 'ok',
      db: row.ok === 1,
      migrations: migrations.n,
      time: new Date().toISOString(),
    };
  });

  registerItemRoutes(app, db);
  registerDealRoutes(app, db, deals ?? defaultDealsDeps(db));

  if (dashboard === 'vite') {
    const { default: middie } = await import('@fastify/middie');
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: DASHBOARD_DIR,
      configFile: join(DASHBOARD_DIR, 'vite.config.ts'),
      appType: 'spa',
      server: { middlewareMode: true, hmr: { server: app.server } },
    });
    await app.register(middie);
    // Vite atiende todo menos la API (su fallback SPA se comería /api/*).
    app.use((req, res, next) => {
      if (isApi(req.url ?? '')) return next();
      vite.middlewares(req, res, next);
    });
    app.addHook('onClose', async () => {
      await vite.close();
    });
  }

  if (dashboard === 'static') {
    const dist = join(DASHBOARD_DIR, 'dist');
    if (!existsSync(join(dist, 'index.html'))) {
      throw new Error(`No existe ${dist}. Ejecuta antes: pnpm --filter @resellpilot/dashboard build`);
    }
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: dist });
  }

  app.setNotFoundHandler((request, reply) => {
    // Fallback SPA: cualquier ruta del dashboard devuelve index.html.
    if (dashboard === 'static' && request.method === 'GET' && !isApi(request.url)) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', path: request.url });
  });

  return app;
}
