PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  legal_name TEXT,
  inn TEXT,
  ogrn TEXT,
  address TEXT,
  car_make TEXT,
  car_model TEXT,
  car_year INTEGER,
  car_color TEXT,
  plate TEXT NOT NULL,
  car_class TEXT,
  status TEXT NOT NULL DEFAULT 'На проверке',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS districts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  trip_price_rub INTEGER NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS streets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT,
  district_id TEXT REFERENCES districts(id),
  source_url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(name, kind)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id),
  driver_id TEXT REFERENCES drivers(id),
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  district_id TEXT REFERENCES districts(id),
  base_price_rub INTEGER NULL,
  commission_rub INTEGER NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO districts(id,name) VALUES
 ('central','Центральный район'),('moscow','Московский район'),('leningrad','Ленинградский район'),('october','Октябрьский район');
