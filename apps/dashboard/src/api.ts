import type { ItemInput, ItemWithCalc, Summary, ValidationIssue } from '@resellpilot/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  message?: string;
  issues?: ValidationIssue[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('No se pudo conectar con el server. ¿Está `pnpm dev` en marcha?', 0);
  }
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    // Respuesta no JSON: se trata abajo como error genérico.
  }

  if (!response.ok) {
    const error = (body ?? {}) as ErrorBody;
    const issues = error.issues ?? [];
    const message =
      issues.length > 0
        ? 'Revisa los datos.'
        : (error.message ?? `Error ${response.status} del server.`);
    throw new ApiError(message, response.status, issues);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

export type SummaryResponse = Summary & { recent_sales: ItemWithCalc[] };

export const api = {
  listItems: () => request<ItemWithCalc[]>('/api/items'),
  createItem: (input: ItemInput) => request<ItemWithCalc>('/api/items', json('POST', input)),
  updateItem: (id: number, input: ItemInput) =>
    request<ItemWithCalc>(`/api/items/${id}`, json('PATCH', input)),
  deleteItem: (id: number) => request<void>(`/api/items/${id}`, { method: 'DELETE' }),
  importCsv: (csv: string) =>
    request<{ imported: number }>('/api/items/import', {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: csv,
    }),
  summary: () => request<SummaryResponse>('/api/summary'),
};

export const EXPORT_CSV_URL = '/api/items/export.csv';

/** Mensaje y lista de problemas de cualquier error, para mostrarlo en la UI. */
export function describeError(error: unknown): { message: string; issues: ValidationIssue[] } {
  if (error instanceof ApiError) return { message: error.message, issues: error.issues };
  return { message: error instanceof Error ? error.message : 'Error desconocido.', issues: [] };
}
