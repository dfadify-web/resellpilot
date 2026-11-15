#!/usr/bin/env python3
"""Puente opcional de Telethon para grupos PRIVADOS de Telegram (PRD, Fase 6).

El server de ResellPilot no puede leer grupos privados: solo canales públicos (t.me/s/...).
Este script entra en Telegram con TU cuenta (sesión local en data/telethon.session), lee los
últimos mensajes de las fuentes `telegram_private` de sources.json y los deja en
data/telegram-private.json. El server recoge ese archivo en su ingesta de cada 10 minutos.

Solo lee: no envía mensajes, no se une a grupos y no sale nada de este equipo salvo hacia Telegram.

Uso:
    pip install -r tools/requirements.txt
    python tools/telethon_bridge.py            # se queda en marcha, lee cada 10 min
    python tools/telethon_bridge.py --once     # una sola lectura

Necesita TELEGRAM_API_ID y TELEGRAM_API_HASH en .env (gratis, en https://my.telegram.org → API
development tools). La primera vez pide tu teléfono y el código que te llega por Telegram.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
SOURCES_PATH = ROOT / "sources.json"
DATA_DIR = ROOT / "data"
FEED_PATH = DATA_DIR / "telegram-private.json"
SESSION_PATH = DATA_DIR / "telethon"  # Telethon añade ".session"

DEFAULT_LIMIT = 50
DEFAULT_INTERVAL_S = 600


def read_env(path: Path) -> dict[str, str]:
    """Lee un .env sencillo (CLAVE=valor, sin interpolación)."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def private_sources(path: Path) -> list[dict]:
    """Fuentes `telegram_private` de sources.json."""
    if not path.exists():
        return []
    sources = json.loads(path.read_text(encoding="utf-8"))
    return [s for s in sources if isinstance(s, dict) and s.get("type") == "telegram_private" and s.get("url")]


def parse_target(url: str) -> tuple[str, str]:
    """Clasifica la URL de un grupo o canal.

    Devuelve (tipo, valor):
      ("channel_id", "123456789")  https://t.me/c/123456789[/42]   (enlace interno de un grupo privado)
      ("invite", "AbCdEf")         https://t.me/+AbCdEf  o  https://t.me/joinchat/AbCdEf
      ("username", "nombre")       https://t.me/nombre
    """
    parsed = urlparse(url)
    if parsed.netloc.lower() not in ("t.me", "telegram.me", "www.t.me"):
        raise ValueError(f"no es un enlace de Telegram: {url}")
    parts = [part for part in parsed.path.split("/") if part]
    if not parts:
        raise ValueError(f"al enlace le falta el grupo: {url}")
    if parts[0] == "c" and len(parts) >= 2 and parts[1].isdigit():
        return ("channel_id", parts[1])
    if parts[0].startswith("+") and len(parts[0]) > 1:
        return ("invite", parts[0][1:])
    if parts[0] == "joinchat" and len(parts) >= 2:
        return ("invite", parts[1])
    if parts[0] == "s" and len(parts) >= 2:
        return ("username", parts[1])
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{3,}", parts[0]):
        return ("username", parts[0])
    raise ValueError(f"no entiendo este enlace de Telegram: {url}")


def write_feed(path: Path, sources: dict[str, list[dict]]) -> None:
    """Escribe el archivo de una vez (temporal + renombrado) para que el server nunca lo lea a medias."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "sources": sources}
    handle, temp = tempfile.mkstemp(dir=str(path.parent), prefix=".telegram-private-", suffix=".tmp")
    with os.fdopen(handle, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False)
    os.replace(temp, path)


async def resolve(client, url: str):
    """Entidad de Telethon del grupo. Nunca se une a nada: si no eres miembro, falla."""
    from telethon.tl.functions.messages import CheckChatInviteRequest
    from telethon.tl.types import ChatInviteAlready, PeerChannel

    kind, value = parse_target(url)
    if kind == "channel_id":
        return await client.get_entity(PeerChannel(int(value)))
    if kind == "invite":
        invite = await client(CheckChatInviteRequest(value))
        if isinstance(invite, ChatInviteAlready):
            return invite.chat
        raise RuntimeError("aún no eres miembro de ese grupo: únete tú desde Telegram")
    return await client.get_entity(value)


async def read_once(client, sources: list[dict], limit: int) -> dict[str, list[dict]]:
    feed: dict[str, list[dict]] = {}
    # Carga los chats de la cuenta: sin esto Telethon no conoce los grupos privados por su id.
    await client.get_dialogs()
    for source in sources:
        url = source["url"]
        try:
            entity = await resolve(client, url)
            messages = []
            async for message in client.iter_messages(entity, limit=limit):
                text = message.raw_text or ""
                if text.strip():
                    messages.append({"text": text[:4000], "date": message.date.isoformat() if message.date else None})
            feed[url] = messages
            print(f"  {source.get('name') or url}: {len(messages)} mensajes")
        except Exception as error:  # noqa: BLE001 - un grupo que falla no debe parar los demás
            print(f"  {source.get('name') or url}: ERROR {error}", file=sys.stderr)
    return feed


async def run(once: bool, limit: int, interval: int) -> int:
    env = {**read_env(ENV_PATH), **os.environ}
    api_id, api_hash = env.get("TELEGRAM_API_ID", ""), env.get("TELEGRAM_API_HASH", "")
    if not api_id.isdigit() or not api_hash:
        print("Faltan TELEGRAM_API_ID y TELEGRAM_API_HASH en .env (https://my.telegram.org).", file=sys.stderr)
        return 2
    if not private_sources(SOURCES_PATH):
        print('No hay fuentes "telegram_private" en sources.json: no hay nada que leer.', file=sys.stderr)
        return 2
    try:
        from telethon import TelegramClient
    except ImportError:
        print("Falta Telethon: pip install -r tools/requirements.txt", file=sys.stderr)
        return 2

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    client = TelegramClient(str(SESSION_PATH), int(api_id), api_hash)
    await client.start()  # la primera vez pide teléfono y código; después usa la sesión local
    try:
        while True:
            sources = private_sources(SOURCES_PATH)  # se relee: sources.json es editable
            print(f"[{datetime.now():%H:%M:%S}] Leyendo {len(sources)} grupo(s) privado(s)…")
            write_feed(FEED_PATH, await read_once(client, sources, limit))
            if once:
                return 0
            await asyncio.sleep(interval)
    finally:
        await client.disconnect()


def main() -> int:
    parser = argparse.ArgumentParser(description="Lee grupos privados de Telegram para ResellPilot (solo lectura).")
    parser.add_argument("--once", action="store_true", help="una sola lectura y salir")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="mensajes recientes por grupo (por defecto 50)")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_S, help="segundos entre lecturas (por defecto 600)")
    args = parser.parse_args()
    try:
        return asyncio.run(run(args.once, max(1, min(args.limit, 200)), max(60, args.interval)))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
