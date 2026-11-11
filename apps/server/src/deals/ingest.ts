import type { SourceStatus } from '@resellpilot/shared';
import type { Db } from '../db';
import { fetchFollow, type Fetcher } from '../http';
import type { Notifier } from '../telegram';
import { extractLinks, parseProductPage, parseTelegramChannel, type LinkCandidate } from './parsers';
import { getDealByUrl, hasSeenLink, insertDeal, markLinkSeen } from './repo';
import {
  applyTrends,
  dealTitle,
  notifyIfRecommended,
  rescore,
  rescoreAll,
  scoringContext,
  toView,
  type ScoringContext,
} from './service';
import { loadSources, type Source } from './sources';
import { normalizeUrl } from './url';

export interface IngestOptions {
  db: Db;
  fetcher: Fetcher;
  notifier: Notifier;
  sourcesPath: string;
  blocklistPath: string;
  /** Pausa entre peticiones de producto, para no cargar las webs de origen. */
  delayMs?: number;
  /** Máximo de enlaces nuevos procesados por fuente y ejecución. */
  maxNewPerRun?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (error: unknown): string => (error instanceof Error ? error.message : 'Error desconocido');

/** Ingesta de oportunidades: lee cada fuente, saca enlaces, los resuelve y crea deals. */
export class Ingestor {
  private readonly statuses = new Map<string, SourceStatus>();
  private running: Promise<SourceStatus[]> | null = null;
  private readonly delayMs: number;
  private readonly maxNewPerRun: number;

  constructor(private readonly options: IngestOptions) {
    this.delayMs = options.delayMs ?? 1000;
    this.maxNewPerRun = options.maxNewPerRun ?? 10;
  }

  /** Fuentes de `sources.json` con el resultado de su última ejecución. */
  status(): SourceStatus[] {
    return this.sources().map((source) => this.statusOf(source));
  }

  /** Ejecuta todas las fuentes. Si ya hay una ejecución en curso, espera a esa. */
  runAll(): Promise<SourceStatus[]> {
    this.running ??= this.execute().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private sources(): Source[] {
    return loadSources(this.options.sourcesPath);
  }

  private statusOf(source: Source): SourceStatus {
    const key = `${source.type}|${source.url}`;
    let status = this.statuses.get(key);
    if (!status) {
      status = { name: source.name, type: source.type, url: source.url, last_run_at: null, ok: null, found: 0, added: 0, error: null };
      this.statuses.set(key, status);
    }
    status.name = source.name;
    return status;
  }

  private async execute(): Promise<SourceStatus[]> {
    const { db, blocklistPath } = this.options;
    const sources = this.sources();
    const context = scoringContext(db, blocklistPath);
    // La lista de marcas y los ajustes son editables: se reaplican en cada ejecución.
    rescoreAll(db, context);

    for (const source of sources) {
      const status = this.statusOf(source);
      status.last_run_at = new Date().toISOString();
      status.found = 0;
      status.added = 0;
      try {
        await this.runSource(source, status, context);
        status.ok = true;
        status.error = null;
      } catch (error) {
        status.ok = false;
        status.error = errorText(error);
      }
    }
    // Los deals nuevos reciben precio estimado, demanda y competencia de las tendencias ya medidas.
    await applyTrends(db, context, this.options.notifier);
    return sources.map((source) => this.statusOf(source));
  }

  private async runSource(source: Source, status: SourceStatus, context: ScoringContext): Promise<void> {
    const { db, fetcher } = this.options;
    if (source.type === 'telegram_private') {
      throw new Error('Los grupos privados necesitan Telethon (opcional, Fase 6).');
    }

    const page = await fetchFollow(fetcher, source.url);
    if (page.status !== 200) throw new Error(`La fuente respondió ${page.status}.`);

    const candidates: LinkCandidate[] =
      source.type === 'telegram_public'
        ? parseTelegramChannel(page.text, source.link_regex, page.url)
        : extractLinks(page.text, source.link_regex, page.url).map((link) => ({ link, title: null, image: null }));
    status.found = candidates.length;

    const fresh = candidates.filter((candidate) => !hasSeenLink(db, candidate.link)).slice(0, this.maxNewPerRun);
    let failures = 0;

    for (const [index, candidate] of fresh.entries()) {
      if (index > 0 && this.delayMs > 0) await sleep(this.delayMs);
      try {
        if (await this.ingestLink(source, candidate, context)) status.added += 1;
      } catch {
        // Fallo de red: no se marca como visto, se reintenta en la siguiente ejecución.
        failures += 1;
      }
    }
    if (failures > 0) throw new Error(`${failures} enlace(s) no se pudieron abrir; se reintentarán.`);
  }

  /** Devuelve `true` si creó un deal nuevo. */
  private async ingestLink(source: Source, candidate: LinkCandidate, context: ScoringContext): Promise<boolean> {
    const { db, fetcher, notifier } = this.options;

    const page = await fetchFollow(fetcher, candidate.link);
    if (page.status === 404 || page.status === 410) {
      markLinkSeen(db, candidate.link, null);
      return false;
    }

    const url = normalizeUrl(page.url);
    const existing = getDealByUrl(db, url);
    if (existing) {
      markLinkSeen(db, candidate.link, existing.id);
      return false;
    }

    // Si la página no se deja leer, el deal se guarda igual con price = null (precio manual en la UI).
    const product = parseProductPage(page.status === 200 ? page.text : '');
    const created = db.transaction(() => {
      const deal = insertDeal(db, {
        url,
        source: source.name,
        title: dealTitle(product.title ?? candidate.title ?? product.fallbackTitle, product.brand),
        price: product.price,
        image: product.image ?? candidate.image,
        found_at: new Date().toISOString(),
      });
      markLinkSeen(db, candidate.link, deal.id);
      return rescore(db, deal, context);
    })();

    await notifyIfRecommended(db, notifier, toView(created, context.settings));
    return true;
  }
}
