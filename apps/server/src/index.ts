import { buildApp } from './app';
import { HOST, loadConfig } from './config';
import { openDb } from './db';
import { openBrowserOnce } from './open-browser';

const isProd = process.argv.includes('--prod');
const config = loadConfig();
const db = openDb(config.dbPath);
const app = await buildApp({ db, dashboard: isProd ? 'static' : 'vite' });

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
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

const url = `http://localhost:${config.port}`;
console.log(`\n  ResellPilot  →  ${url}  (${isProd ? 'build' : 'dev'}, solo ${HOST})\n`);
if (!isProd && config.openBrowser) openBrowserOnce(url);
