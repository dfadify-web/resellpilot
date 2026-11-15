import cron from 'node-cron';
import { buildApp } from './app';
import { BLOCKLIST_PATH, HOST, PRIVATE_FEED_PATH, SOURCES_PATH, loadConfig } from './config';
import { openDb } from './db';
import { Ingestor } from './deals/ingest';
import { scoringContext } from './deals/service';
import { httpFetcher } from './http';
import { openBrowserOnce } from './open-browser';
import { sendDailySummaryIfDue } from './reports/service';
import { createTelegramNotifier } from './telegram';

const isProd = process.argv.includes('--prod');
const config = loadConfig();
const db = openDb(config.dbPath);

const notifier = createTelegramNotifier({
  token: config.telegramToken,
  chatId: config.telegramChatId,
  db,
});
const ingestor = new Ingestor({
  db,
  fetcher: httpFetcher,
  notifier,
  sourcesPath: SOURCES_PATH,
  blocklistPath: BLOCKLIST_PATH,
  privateFeedPath: PRIVATE_FEED_PATH,
});

const app = await buildApp({
  db,
  dashboard: isProd ? 'static' : 'vite',
  deals: { ingestor, notifier, blocklistPath: BLOCKLIST_PATH },
  extensionId: config.extensionId,
});

/** Ingesta de oportunidades. Un fallo nunca tumba el server. */
const ingest = () => {
  ingestor.runAll().catch((error: unknown) => {
    console.error('[ingesta]', error instanceof Error ? error.message : error);
  });
};

/** Resumen diario por Telegram (08:30, o al arrancar si el equipo estaba apagado a esa hora). */
const dailySummary = () => {
  sendDailySummaryIfDue(db, notifier, scoringContext(db, BLOCKLIST_PATH)).catch((error: unknown) => {
    console.error('[resumen diario]', error instanceof Error ? error.message : error);
  });
};

let closing = false;
const timers: {
  job?: ReturnType<typeof cron.schedule>;
  daily?: ReturnType<typeof cron.schedule>;
  firstRun?: NodeJS.Timeout;
  firstSummary?: NodeJS.Timeout;
} = {};

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  clearTimeout(timers.firstRun);
  clearTimeout(timers.firstSummary);
  void timers.job?.stop();
  void timers.daily?.stop();
  try {
    await app.close();
  } finally {
    db.close();
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ host: HOST, port: config.port });
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') {
    console.error(`El puerto ${config.port} ya está en uso. Cierra el otro proceso o cambia PORT en .env.`);
  } else {
    console.error(err);
  }
  db.close();
  process.exit(1);
}

// Fuentes de oportunidades: al arrancar y después cada 10 minutos.
timers.job = cron.schedule('*/10 * * * *', ingest);
timers.firstRun = setTimeout(ingest, 5000);
timers.daily = cron.schedule('30 8 * * *', dailySummary);
timers.firstSummary = setTimeout(dailySummary, 20_000);

const url = `http://localhost:${config.port}`;
console.log(`\n  ResellPilot  →  ${url}  (${isProd ? 'build' : 'dev'}, solo ${HOST})\n`);
if (!isProd && config.openBrowser) openBrowserOnce(url);
