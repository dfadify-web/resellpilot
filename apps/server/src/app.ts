import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { DASHBOARD_DIR } from './config';
import type { Db } from './db';

export interface AppOptions {
  db: Db;
  /**
   * Cómo servir el dashboard:
   * - `vite`: dev server de Vite embebido (HMR).
   * - `static`: build de `apps/dashboard/dist`.
   * - `none`: solo API (tests).
   */
  dashboard: 'vite' | 'static' | 'none';
}

const isApi = (url: string) => url === '/api' || url.startsWith('/api/');

export async function buildApp({ db, dashboard }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'warn' } });

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
