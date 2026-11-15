import type { FastifyInstance } from 'fastify';
import { parseDateInput } from '@resellpilot/shared';
import type { Db } from '../db';
import { scoringContext } from '../deals/service';
import { ValidationError } from '../errors';
import type { Notifier } from '../telegram';
import {
  dailySummarySent,
  dailySummaryText,
  listRepricing,
  sendDailySummary,
  weeklyReportCsv,
  weeklyReportFor,
} from './service';

export interface ReportsDeps {
  notifier: Notifier;
  blocklistPath: string;
}

/** Fecha de la semana pedida (`?week=AAAA-MM-DD`, cualquier día de esa semana). Sin ella, hoy. */
function weekDate(query: unknown): Date {
  const { week } = query as { week?: string };
  if (week === undefined || week === '') return new Date();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(week) ? parseDateInput(week) : null;
  if (iso === null) throw new ValidationError([{ path: 'week', message: 'usa el formato AAAA-MM-DD' }]);
  return new Date(iso);
}

export function registerReportRoutes(app: FastifyInstance, db: Db, deps: ReportsDeps): void {
  const context = () => scoringContext(db, deps.blocklistPath);

  app.get('/api/repricing', async () => listRepricing(db));

  /** Totales de esta semana y de la anterior, para Resumen. */
  app.get('/api/reports/weekly', async () => {
    const now = new Date();
    return { current: weeklyReportFor(db, now), previous: weeklyReportFor(db, now, -1) };
  });

  app.get('/api/reports/weekly.csv', async (request, reply) => {
    const report = weeklyReportFor(db, weekDate(request.query));
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="resellpilot-beneficios-${report.monday}.csv"`)
      .send(weeklyReportCsv(report));
  });

  /** Vista previa del resumen diario tal como llegaría a Telegram. */
  app.get('/api/reports/daily', async () => ({
    text: dailySummaryText(db, context()),
    telegram: deps.notifier.configured(),
    sent_today: dailySummarySent(db),
  }));

  app.post('/api/reports/daily/send', async () => sendDailySummary(db, deps.notifier, context()));
}
