-- Enlaces ya procesados por la ingesta (Fase 2).
-- Evita volver a resolver cada 10 minutos el mismo enlace corto de una fuente.
-- `deal_id` es NULL si el enlace no dio lugar a un deal (p. ej. 404).

CREATE TABLE seen_links (
  link          TEXT PRIMARY KEY,
  deal_id       INTEGER REFERENCES deals (id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
