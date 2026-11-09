import cron from 'node-cron';
import { buildApp } from './app';
import { BLOCKLIST_PATH, HOST, SOURCES_PATH, loadConfig } from './config';
import { openDb } from './db';
import { Ingestor } from './deals/ingest';
import { httpFetcher } from './http';
import { openBrowserOnce } from './open-browser';
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
});

const app = await buildApp({
  db,
  dashboard: isProd ? 'static' : 'vite',
  deals: { ingestor, notifier, blocklistPath: BLOCKLIST_PATH },
});

/** Ingesta de oportunidades. Un fallo nunca tumba el server. */
const ingest = () => {
  ingestor.runAll().catch((error: unknown) => {
    console.error('[ingesta]', error instanceof Error ? error.message : error);
  });
};

let closing = false;
const timers: { job?: ReturnType<typeof cron.schedule>; firstRun?: NodeJS.Timeout } = {};

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  clearTimeout(timers.firstRun);
  void timers.job?.stop();
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

const url = `http://localhost:${config.port}`;
console.log(`\n  ResellPilot  →  ${url}  (${isProd ? 'build' : 'dev'}, solo ${HOST})\n`);
if (!isProd && config.openBrowser) openBrowserOnce(url);
