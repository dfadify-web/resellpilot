import {
  computeSummary,
  isSold,
  isStockState,
  toDateInputValue,
  withCalc,
  type ItemWithCalc,
} from '@resellpilot/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db';
import { NotFoundError, ValidationError } from '../errors';
import { itemsToCsv, parseItemsCsv } from './csv';
import { deleteItem, getItem, insertItem, insertItems, listItems, updateItem } from './repo';
import { buildItemData, createItemSchema, patchItemSchema } from './schema';

const idSchema = z.coerce.number().int().positive();

function parseId(params: unknown): number {
  const result = idSchema.safeParse((params as { id?: unknown }).id);
  if (!result.success) throw new NotFoundError('El item');
  return result.data;
}

export function registerItemRoutes(app: FastifyInstance, db: Db): void {
  // El CSV se recibe como texto plano.
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });

  app.get('/api/items', async (request): Promise<ItemWithCalc[]> => {
    const { stock } = request.query as { stock?: string };
    if (stock !== undefined && !isStockState(stock)) {
      throw new ValidationError([{ path: 'stock', message: 'estado no válido' }]);
    }
    return listItems(db, stock).map(withCalc);
  });

  app.post('/api/items', async (request, reply) => {
    const input = createItemSchema.parse(request.body ?? {});
    const item = insertItem(db, buildItemData(input, undefined, new Date().toISOString()));
    return reply.code(201).send(withCalc(item));
  });

  app.get('/api/items/export.csv', async (_request, reply) => {
    const csv = itemsToCsv(listItems(db).map(withCalc));
    const filename = `resellpilot-items-${toDateInputValue(new Date())}.csv`;
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(csv);
  });

  app.post('/api/items/import', async (request) => {
    if (typeof request.body !== 'string') {
      throw new ValidationError([{ path: 'csv', message: 'Envía el archivo como text/csv.' }]);
    }
    const { rows, issues } = parseItemsCsv(request.body, new Date().toISOString());
    // Todo o nada: con un solo error no se importa ninguna fila.
    if (issues.length > 0) throw new ValidationError(issues);
    return { imported: insertItems(db, rows) };
  });

  app.get('/api/items/:id', async (request) => {
    const item = getItem(db, parseId(request.params));
    if (!item) throw new NotFoundError('El item');
    return withCalc(item);
  });

  app.patch('/api/items/:id', async (request) => {
    const id = parseId(request.params);
    const existing = getItem(db, id);
    if (!existing) throw new NotFoundError('El item');
    const input = patchItemSchema.parse(request.body ?? {});
    const updated = updateItem(db, id, buildItemData(input, existing, new Date().toISOString()));
    return withCalc(updated ?? existing);
  });

  app.delete('/api/items/:id', async (request, reply) => {
    if (!deleteItem(db, parseId(request.params))) throw new NotFoundError('El item');
    return reply.code(204).send();
  });

  app.get('/api/summary', async () => {
    const items = listItems(db);
    const recentSales = items
      .filter((item) => isSold(item) && item.sold_at !== null)
      .sort((a, b) => Date.parse(b.sold_at as string) - Date.parse(a.sold_at as string))
      .slice(0, 5)
      .map(withCalc);
    return { ...computeSummary(items), recent_sales: recentSales };
  });
}
