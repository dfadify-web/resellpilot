import type {
  CommandView,
  OfferPlan,
  DealPatch,
  DealView,
  ItemInput,
  ListingView,
  NotificationView,
  VintedStatus,
  ItemWithCalc,
  RepricingRow,
  Settings,
  SourceStatus,
  TrendView,
  Summary,
  ValidationIssue,
  WeeklyReport,
} from '@resellpilot/shared';

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

export interface SourcesResponse {
  /** `true` si hay token de bot de Telegram en `.env`. */
  telegram: boolean;
  sources: SourceStatus[];
}

export interface TrendsResponse {
  trends: TrendView[];
  /** Consultas que se medirán en la próxima sync de la extensión. */
  due: number;
  calibrated_at: string | null;
  hacoo_search_url: string;
}

export interface SettingsResponse {
  settings: Settings;
  defaults: Settings;
  trend_seeds: string[];
  hacoo_search_url: string;
  offer_template: string;
  default_offer_template: string;
}

export interface SettingsInput {
  settings?: Partial<Settings>;
  trend_seeds?: string[];
  hacoo_search_url?: string;
  offer_template?: string;
}

export interface WeeklyReportsResponse {
  current: WeeklyReport;
  previous: WeeklyReport;
}

export interface DailyReportResponse {
  /** Texto del resumen tal como llegaría a Telegram. */
  text: string;
  telegram: boolean;
  sent_today: boolean;
}

export type CommandInput =
  | { type: 'send_offers'; favoriter_ids: number[] }
  | { type: 'price_drop'; listing_ids: number[] };

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

  listDeals: () => request<DealView[]>('/api/deals'),
  updateDeal: (id: number, patch: DealPatch) => request<DealView>(`/api/deals/${id}`, json('PATCH', patch)),
  buyDeal: (id: number) =>
    request<{ deal: DealView; item: ItemWithCalc }>(`/api/deals/${id}/buy`, { method: 'POST' }),
  sources: () => request<SourcesResponse>('/api/sources'),
  runIngest: () => request<SourcesResponse>('/api/ingest/run', { method: 'POST' }),
  vintedStatus: () => request<VintedStatus>('/api/vinted/status'),
  forgetVintedAccount: () => request<VintedStatus>('/api/vinted/forget-account', { method: 'POST' }),
  listListings: () => request<ListingView[]>('/api/listings'),
  linkListing: (id: number, itemId: number | null) =>
    request<ListingView>(`/api/listings/${id}`, json('PATCH', { item_id: itemId })),
  listNotifications: () => request<NotificationView[]>('/api/notifications'),
  markNotificationsRead: (ids?: number[]) =>
    request<{ updated: number }>('/api/notifications/read', json('POST', ids ? { ids } : {})),
  trends: () => request<TrendsResponse>('/api/trends'),
  settings: () => request<SettingsResponse>('/api/settings'),
  saveSettings: (input: SettingsInput) => request<SettingsResponse>('/api/settings', json('PUT', input)),
  offersPlan: () => request<OfferPlan>('/api/offers/plan'),
  listCommands: () => request<CommandView[]>('/api/commands'),
  createCommand: (input: CommandInput) => request<CommandView>('/api/commands', json('POST', input)),
  cancelCommand: (id: number) => request<CommandView>(`/api/commands/${id}/cancel`, { method: 'POST' }),
  repricing: () => request<RepricingRow[]>('/api/repricing'),
  weeklyReports: () => request<WeeklyReportsResponse>('/api/reports/weekly'),
  dailyReport: () => request<DailyReportResponse>('/api/reports/daily'),
  sendDailyReport: () => request<{ ok: boolean; error?: string }>('/api/reports/daily/send', { method: 'POST' }),
  testTelegram: () => request<{ ok: boolean; error?: string }>('/api/telegram/test', { method: 'POST' }),
};

export const EXPORT_CSV_URL = '/api/items/export.csv';
/** CSV del informe semanal de la semana que empieza ese lunes (`AAAA-MM-DD`). */
export const weeklyCsvUrl = (monday: string): string => `/api/reports/weekly.csv?week=${monday}`;

/** Mensaje y lista de problemas de cualquier error, para mostrarlo en la UI. */
export function describeError(error: unknown): { message: string; issues: ValidationIssue[] } {
  if (error instanceof ApiError) return { message: error.message, issues: error.issues };
  return { message: error instanceof Error ? error.message : 'Error desconocido.', issues: [] };
}
