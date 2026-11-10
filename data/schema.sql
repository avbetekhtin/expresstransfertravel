PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('client', 'driver', 'dispatcher', 'admin')),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  city TEXT,
  status TEXT NOT NULL DEFAULT 'На проверке',
  car TEXT,
  plate TEXT,
  services_json TEXT NOT NULL DEFAULT '[]',
  tariffs_json TEXT NOT NULL DEFAULT '[]',
  password_hash TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  plate TEXT NOT NULL UNIQUE,
  car_class TEXT,
  year INTEGER,
  color TEXT,
  status TEXT NOT NULL DEFAULT 'На проверке'
);

CREATE TABLE IF NOT EXISTS driver_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'На проверке',
  uploaded_at TEXT NOT NULL,
  UNIQUE(driver_id, document_type)
);

CREATE TABLE IF NOT EXISTS districts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  trip_price_rub INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS directions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tariffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction_id INTEGER NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
  route_key TEXT NOT NULL UNIQUE,
  econom_rub INTEGER,
  standard_rub INTEGER,
  comfort_rub INTEGER
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_email TEXT,
  driver_id TEXT REFERENCES users(id),
  status TEXT NOT NULL,
  payment_status TEXT,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  base_price_rub INTEGER,
  commission_rub INTEGER,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT,
  method TEXT,
  amount_rub INTEGER NOT NULL,
  status TEXT NOT NULL,
  external_id TEXT,
  paid_at TEXT,
  expires_at TEXT,
  payment_url TEXT,
  qr_payload TEXT,
  refunded_at TEXT,
  created_at TEXT NOT NULL
  ,updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  event_type TEXT NOT NULL,
  role TEXT NOT NULL,
  chat_id TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS max_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  event_type TEXT NOT NULL,
  chat_id TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  ip TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_client_email ON orders(client_email);
CREATE INDEX IF NOT EXISTS idx_orders_driver_id ON orders(driver_id);
CREATE INDEX IF NOT EXISTS idx_tariffs_route_key ON tariffs(route_key);
