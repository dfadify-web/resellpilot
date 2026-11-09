-- ResellPilot: schema inicial (PRD, "Modelo de datos").
-- Importes en euros (REAL). Fechas en ISO 8601 UTC (TEXT). Booleanos como 0/1.

CREATE TABLE items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  brand         TEXT,
  source_url    TEXT,
  cost          REAL NOT NULL DEFAULT 0,
  shipping_cost REAL NOT NULL DEFAULT 0,
  extra_costs   REAL NOT NULL DEFAULT 0,
  stock         TEXT NOT NULL DEFAULT 'idea'
                CHECK (stock IN ('idea','pedido','en_camino','en_mano','listado','reservado','vendido','devuelto')),
  sold_price    REAL,
  sold_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_items_stock ON items (stock);

CREATE TABLE listings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vinted_id    TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  price        REAL,
  status       TEXT,
  favs         INTEGER NOT NULL DEFAULT 0,
  views        INTEGER NOT NULL DEFAULT 0,
  listed_at    TEXT,
  last_seen_at TEXT,
  item_id      INTEGER REFERENCES items (id) ON DELETE SET NULL
);
CREATE INDEX idx_listings_item ON listings (item_id);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vinted_id  TEXT UNIQUE,
  type       TEXT NOT NULL,
  text       TEXT,
  listing_id INTEGER REFERENCES listings (id) ON DELETE SET NULL,
  read       INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_notifications_created ON notifications (created_at);

CREATE TABLE favoriters (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id       INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  vinted_user_id   TEXT NOT NULL,
  username         TEXT,
  seen_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  offered_at       TEXT,
  has_conversation INTEGER NOT NULL DEFAULT 0 CHECK (has_conversation IN (0, 1)),
  UNIQUE (listing_id, vinted_user_id)
);

CREATE TABLE deals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL UNIQUE,
  source      TEXT,
  title       TEXT,
  price       REAL,
  image       TEXT,
  found_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  est_price   REAL,
  est_profit  REAL,
  roi         REAL,
  demand      REAL,
  competition REAL,
  score       REAL NOT NULL DEFAULT 0,
  risk_flags  TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN ('nuevo','descartado','comprado'))
);
CREATE INDEX idx_deals_status_score ON deals (status, score);

CREATE TABLE trends (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  query          TEXT NOT NULL,
  median_price   REAL,
  p25_price      REAL,
  listings_count INTEGER,
  avg_favs       REAL,
  favs_per_day   REAL,
  computed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_trends_query_computed ON trends (query, computed_at);

CREATE TABLE commands (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','running','done','failed','cancelled')),
  progress   REAL NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_commands_status ON commands (status);

CREATE TABLE action_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  action TEXT NOT NULL,
  target TEXT,
  result TEXT
);
CREATE INDEX idx_action_log_ts ON action_log (ts);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
