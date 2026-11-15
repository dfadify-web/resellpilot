import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { NotFoundError } from '../errors';
import { extensionGuard } from '../extension-guard';
import { advanceCommand, buildPlan, cancelCommand, createCommand, getCommand, listCommands, nextCommand } from './service';

const idParam = z.coerce.number().int().positive();
const ids = z.array(z.number().int().positive()).min(1).max(500);

const createSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send_offers'), favoriter_ids: ids }).strict(),
  z.object({ type: z.literal('price_drop'), listing_ids: ids }).strict(),
]);

const stepSchema = z
  .object({
    last: z
      .object({
        index: z.number().int().min(0),
        ok: z.boolean(),
        stop: z.boolean().optional(),
        error: z.string().max(300).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function commandId(request: FastifyRequest): number {
  const parsed = idParam.safeParse((request.params as { id?: unknown }).id);
  if (!parsed.success) throw new NotFoundError('El comando');
  return parsed.data;
}

export function registerOfferRoutes(app: FastifyInstance, db: Db, extensionOrigin: string): void {
  const extension = { onRequest: extensionGuard(extensionOrigin) };

  // ── Dashboard: plan, confirmación y seguimiento ──

  app.get('/api/offers/plan', async () => buildPlan(db));

  /** Solo se crea tras la confirmación explícita del usuario en el dashboard (Regla 6). */
  app.post('/api/commands', async (request, reply) => {
    const input = createSchema.parse(request.body);
    return reply.code(201).send(createCommand(db, input));
  });

  app.get('/api/commands', async () => listCommands(db));

  app.post('/api/commands/:id/cancel', async (request) =>
    cancelCommand(db, commandId(request), 'Cancelado desde el dashboard.'),
  );

  // ── Extensión: ejecución paso a paso ──

  app.get('/api/vinted/commands/next', extension, async () => ({ command: nextCommand(db) }));

  app.post('/api/vinted/commands/:id/step', extension, async (request) => {
    const { last } = stepSchema.parse(request.body ?? {});
    return advanceCommand(db, commandId(request), last);
  });

  app.post('/api/vinted/commands/:id/cancel', extension, async (request) => {
    cancelCommand(db, commandId(request), 'Parado con el botón PARAR en la pestaña de Vinted.');
    return getCommand(db, commandId(request));
  });
}
