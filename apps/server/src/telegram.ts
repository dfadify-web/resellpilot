import type { Db } from './db';
import { getRawSetting, setRawSetting } from './settings';

export interface NotifyResult {
  ok: boolean;
  error?: string;
}

/** Envía avisos al usuario. Inyectable para los tests. */
export interface Notifier {
  /** `true` si hay token de bot. */
  configured(): boolean;
  send(text: string): Promise<NotifyResult>;
}

/** Notificador que no hace nada (sin token, o en tests). */
export const nullNotifier: Notifier = {
  configured: () => false,
  send: async () => ({ ok: false, error: 'Telegram no está configurado.' }),
};

const CHAT_SETTING = 'TELEGRAM_CHAT_ID';
const TIMEOUT_MS = 15_000;

interface TelegramReply {
  ok: boolean;
  description?: string;
  result?: unknown;
}

interface TelegramOptions {
  token: string;
  /** Chat fijado en `.env`. Si falta, se detecta con el primer `/start` que reciba el bot. */
  chatId: string;
  db: Db;
  fetchImpl?: typeof fetch;
}

/**
 * Notificador por la Bot API de Telegram (bot propio, gratis).
 * El token solo sale hacia api.telegram.org y nunca aparece en mensajes de error.
 */
export function createTelegramNotifier({ token, chatId, db, fetchImpl = fetch }: TelegramOptions): Notifier {
  if (token === '') return nullNotifier;

  async function call(method: string, body: Record<string, unknown>): Promise<TelegramReply> {
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return (await response.json()) as TelegramReply;
    } catch {
      return { ok: false, description: 'No se pudo conectar con Telegram.' };
    }
  }

  /** Chat de destino: `.env` → guardado en ajustes → último chat privado que escribió al bot. */
  async function resolveChat(): Promise<string | null> {
    if (chatId !== '') return chatId;
    const saved = getRawSetting(db, CHAT_SETTING);
    if (saved) return saved;

    const reply = await call('getUpdates', { limit: 50, allowed_updates: ['message'] });
    if (!reply.ok || !Array.isArray(reply.result)) return null;
    const chats = (reply.result as { message?: { chat?: { id?: number; type?: string } } }[])
      .map((update) => update.message?.chat)
      .filter((chat) => chat?.type === 'private' && typeof chat.id === 'number');
    const last = chats.at(-1);
    if (!last) return null;

    const found = String(last.id);
    setRawSetting(db, CHAT_SETTING, found);
    return found;
  }

  return {
    configured: () => true,
    async send(text) {
      const chat = await resolveChat();
      if (!chat) {
        return { ok: false, error: 'El bot aún no conoce tu chat: abre el bot en Telegram y envíale /start.' };
      }
      const reply = await call('sendMessage', { chat_id: chat, text: text.slice(0, 4000) });
      return reply.ok ? { ok: true } : { ok: false, error: reply.description ?? 'Telegram rechazó el mensaje.' };
    },
  };
}
