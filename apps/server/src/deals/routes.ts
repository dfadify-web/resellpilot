import { DEAL_STATUSES, withCalc, type DealStatus, type DealView } from '@resellpilot/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { NotFoundError, ValidationError } from '../errors';
import type { Notifier } from '../telegram';
import type { Ingestor } from './ingest';
import { listDeals } from './repo';
import { buyDeal, notifyIfRecommended, patchDeal, scoringContext, toView } from './service';

export interface DealsDeps {
  ingestor: Ingestor;
  notifier: Notifier;
  blocklistPath: string;
}

const money = z
  .number({ invalid_type_error: 'debe ser un número' })
  .finite('debe ser un número')
  .min(0, 'no puede ser negativo')
  .max(100_000, 'es demasiado alto');

const patchSchema = z.object({
  title: z.string().trim().min(1, 'no puede estar vacío').max(300).optional(),
  price: money.nullable().optional(),
  est_price: money.nullable().optional(),
  status: z.enum(['nuevo', 'descartado'], { errorMap: () => ({ message: 'debe ser nuevo o descartado' }) }).optional(),
});

const idSchema = z.coerce.number().int().positive();

function parseId(params: unknown): number {
  const result = idSchema.safeParse((params as { id?: unknown }).id);
  if (!result.success) throw new NotFoundError('La oportunidad');
  return result.data;
}

export function registerDealRoutes(app: FastifyInstance, db: Db, deps: DealsDeps): void {
  const context = () => scoringContext(db, deps.blocklistPath);

  app.get('/api/deals', async (request): Promise<DealView[]> => {
    const { status } = request.query as { status?: string };
    if (status !== undefined && !(DEAL_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationError([{ path: 'status', message: 'estado no válido' }]);
    }
    const { settings } = context();
    return listDeals(db, status as DealStatus | undefined).map((deal) => toView(deal, settings));
  });

  app.patch('/api/deals/:id', async (request) => {
    const patch = patchSchema.parse(request.body ?? {});
    const deal = patchDeal(db, parseId(request.params), patch, context());
    await notifyIfRecommended(db, deps.notifier, deal);
    return deal;
  });

  app.post('/api/deals/:id/buy', async (request, reply) => {
    const { deal, item } = buyDeal(db, parseId(request.params), context());
    return reply.code(201).send({ deal, item: withCalc(item) });
  });

  app.get('/api/sources', async () => ({
    telegram: deps.notifier.configured(),
    sources: deps.ingestor.status(),
  }));

  app.post('/api/ingest/run', async () => ({
    telegram: deps.notifier.configured(),
    sources: await deps.ingestor.runAll(),
  }));

  app.post('/api/telegram/test', async () =>
    deps.notifier.send('✅ ResellPilot: los avisos de Telegram funcionan.'),
  );
}
