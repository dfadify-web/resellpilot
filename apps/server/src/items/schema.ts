import { STOCK_STATES, parseDateInput, type Item } from '@resellpilot/shared';
import { z } from 'zod';
import { ValidationError } from '../errors';

/** Datos de un item listos para guardar (todo menos el id). */
export type ItemData = Omit<Item, 'id'>;

const money = z
  .number({ invalid_type_error: 'debe ser un número' })
  .finite('debe ser un número')
  .min(0, 'no puede ser negativo')
  .max(1_000_000, 'es demasiado alto');

const optionalText = (max: number) =>
  z
    .string({ invalid_type_error: 'debe ser un texto' })
    .trim()
    .max(max, `máximo ${max} caracteres`)
    .nullish()
    .transform((value) => (value === '' ? null : value));

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const date = z.string({ invalid_type_error: 'debe ser una fecha' }).transform((value, ctx) => {
  const iso = parseDateInput(value);
  if (iso === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'fecha no válida (usa AAAA-MM-DD o DD/MM/AAAA)',
    });
    return z.NEVER;
  }
  return iso;
});

const fields = {
  name: z
    .string({ invalid_type_error: 'debe ser un texto' })
    .trim()
    .min(1, 'obligatorio')
    .max(200, 'máximo 200 caracteres'),
  brand: optionalText(100),
  source_url: optionalText(2000).refine((value) => value == null || isHttpUrl(value), {
    message: 'debe ser una URL http:// o https://',
  }),
  cost: money.optional(),
  shipping_cost: money.optional(),
  extra_costs: money.optional(),
  stock: z
    .enum(STOCK_STATES, {
      errorMap: () => ({ message: `debe ser uno de: ${STOCK_STATES.join(', ')}` }),
    })
    .optional(),
  sold_price: money.nullish(),
  sold_at: z.preprocess((value) => (value === '' ? null : value), date.nullish()),
  created_at: z.preprocess((value) => (value === '' ? undefined : value), date.optional()),
};

export const createItemSchema = z.object(fields);
export const patchItemSchema = z.object(fields).partial();

export type ItemPatch = z.infer<typeof patchItemSchema>;

/**
 * Combina la entrada con el item existente (si lo hay) y aplica las reglas de venta:
 * - `vendido` exige precio de venta; la fecha de venta por defecto es ahora.
 * - Cualquier otro estado borra precio y fecha de venta.
 */
export function buildItemData(input: ItemPatch, existing: Item | undefined, nowIso: string): ItemData {
  const name = input.name ?? existing?.name;
  if (name === undefined) throw new ValidationError([{ path: 'name', message: 'obligatorio' }]);

  const data: ItemData = {
    name,
    brand: input.brand !== undefined ? input.brand : (existing?.brand ?? null),
    source_url: input.source_url !== undefined ? input.source_url : (existing?.source_url ?? null),
    cost: input.cost ?? existing?.cost ?? 0,
    shipping_cost: input.shipping_cost ?? existing?.shipping_cost ?? 0,
    extra_costs: input.extra_costs ?? existing?.extra_costs ?? 0,
    stock: input.stock ?? existing?.stock ?? 'idea',
    sold_price: input.sold_price !== undefined ? input.sold_price : (existing?.sold_price ?? null),
    sold_at: input.sold_at !== undefined ? input.sold_at : (existing?.sold_at ?? null),
    created_at: input.created_at ?? existing?.created_at ?? nowIso,
  };

  if (data.stock === 'vendido') {
    if (data.sold_price === null) {
      throw new ValidationError([
        { path: 'sold_price', message: 'obligatorio cuando el estado es vendido' },
      ]);
    }
    data.sold_at ??= nowIso;
  } else {
    data.sold_price = null;
    data.sold_at = null;
  }
  return data;
}
