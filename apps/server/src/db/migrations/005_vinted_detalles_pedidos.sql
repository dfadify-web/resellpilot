-- Más datos de cada anuncio y notificación, y los pedidos vendidos (GET /api/v2/my_orders?type=sold).

ALTER TABLE listings ADD COLUMN photo TEXT;
ALTER TABLE listings ADD COLUMN brand TEXT;
ALTER TABLE listings ADD COLUMN size TEXT;
ALTER TABLE listings ADD COLUMN condition TEXT;
ALTER TABLE listings ADD COLUMN url TEXT;

ALTER TABLE notifications ADD COLUMN photo TEXT;
ALTER TABLE notifications ADD COLUMN link TEXT;

CREATE TABLE orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vinted_id       TEXT NOT NULL UNIQUE,
  conversation_id TEXT,
  title           TEXT NOT NULL,
  price           REAL,
  status_text     TEXT,
  state           TEXT NOT NULL DEFAULT 'en_curso'
                  CHECK (state IN ('enviar', 'en_curso', 'completado', 'cancelado')),
  at              TEXT,
  photo           TEXT,
  listing_id      INTEGER REFERENCES listings (id) ON DELETE SET NULL,
  first_seen_at   TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_orders_state ON orders (state);
