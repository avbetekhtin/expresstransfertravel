import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createDatabase({ dataDir, usersFile, ordersFile, platformDbFile, fixedDirectionsFile }) {
  const file = path.join(dataDir, 'platform.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, role TEXT NOT NULL, email TEXT UNIQUE, full_name TEXT NOT NULL,
      phone TEXT, city TEXT, status TEXT, car TEXT, plate TEXT, services_json TEXT,
      tariffs_json TEXT, password_hash TEXT, verified_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      make TEXT NOT NULL, model TEXT NOT NULL, plate TEXT NOT NULL UNIQUE,
      car_class TEXT, year INTEGER, color TEXT, status TEXT NOT NULL DEFAULT 'На проверке'
    );
    CREATE TABLE IF NOT EXISTS driver_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL, storage_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'На проверке',
      uploaded_at TEXT NOT NULL, UNIQUE(driver_id, document_type)
    );
    CREATE TABLE IF NOT EXISTS districts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, trip_price_rub INTEGER, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS directions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS tariffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, direction_id INTEGER NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
      route_key TEXT NOT NULL UNIQUE, econom_rub INTEGER, standard_rub INTEGER, comfort_rub INTEGER
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, client_email TEXT, driver_id TEXT REFERENCES users(id), status TEXT NOT NULL,
      payment_status TEXT, from_address TEXT NOT NULL, to_address TEXT NOT NULL,
      base_price_rub INTEGER, commission_rub INTEGER, created_at TEXT NOT NULL, payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT, method TEXT, amount_rub INTEGER NOT NULL, status TEXT NOT NULL,
      external_id TEXT, paid_at TEXT, expires_at TEXT, payment_url TEXT, qr_payload TEXT,
      refunded_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_client_email ON orders(client_email);
    CREATE INDEX IF NOT EXISTS idx_orders_driver_id ON orders(driver_id);
    CREATE INDEX IF NOT EXISTS idx_tariffs_route_key ON tariffs(route_key);
  `);
  for (const statement of [
    'ALTER TABLE users ADD COLUMN password_hash TEXT',
    'ALTER TABLE users ADD COLUMN verified_at TEXT'
  ]) {
    try { db.exec(statement); } catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; }
  }
  for (const statement of [
    'ALTER TABLE payments ADD COLUMN expires_at TEXT',
    'ALTER TABLE payments ADD COLUMN payment_url TEXT',
    'ALTER TABLE payments ADD COLUMN qr_payload TEXT',
    'ALTER TABLE payments ADD COLUMN refunded_at TEXT',
    'ALTER TABLE payments ADD COLUMN updated_at TEXT'
  ]) {
    try { db.exec(statement); } catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; }
  }

  const parse = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };
  const count = table => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  if (count('users') === 0) {
    const source = parse(usersFile, { drivers: [], clients: [] });
    const insert = db.prepare(`INSERT OR IGNORE INTO users
      (id, role, email, full_name, phone, city, status, car, plate, services_json, tariffs_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    for (const driver of source.drivers || []) insert.run(driver.id, 'driver', driver.email || null, driver.name || '', driver.phone || null, driver.city || null, driver.status || null, driver.car || null, driver.plate || null, JSON.stringify(driver.services || []), JSON.stringify(driver.tariffs || []), now);
    for (const client of source.clients || []) insert.run(client.id, 'client', client.email || null, client.name || '', client.phone || null, client.city || null, client.status || null, null, null, '[]', '[]', now);
  }
  if (count('vehicles') === 0) {
    const source = parse(usersFile, { drivers: [] });
    const vehicle = db.prepare('INSERT OR IGNORE INTO vehicles(id,driver_id,make,model,plate,car_class,status) VALUES (?,?,?,?,?,?,?)');
    for (const driver of source.drivers || []) {
      const parts = String(driver.car || '').trim().split(/\s+/);
      if (driver.car && driver.plate) vehicle.run(`VEH-${driver.id}`, driver.id, parts.shift() || driver.car, parts.join(' ') || 'автомобиль', driver.plate, driver.carClass || null, driver.status || 'На проверке');
    }
  }
  if (count('districts') === 0) {
    const source = parse(platformDbFile, { districts: [] });
    const insert = db.prepare('INSERT OR IGNORE INTO districts(id,name,trip_price_rub) VALUES (?,?,?)');
    for (const district of source.districts || []) insert.run(district.id, district.name, district.tripPriceRub ?? null);
  }
  if (count('directions') === 0) {
    const source = parse(fixedDirectionsFile, { directions: [], prices: {} });
    const insertDirection = db.prepare('INSERT OR IGNORE INTO directions(name) VALUES (?)');
    const directionId = name => db.prepare('SELECT id FROM directions WHERE name = ?').get(name).id;
    const insertTariff = db.prepare('INSERT OR IGNORE INTO tariffs(direction_id,route_key,econom_rub,standard_rub,comfort_rub) VALUES (?,?,?,?,?)');
    for (const name of source.directions || []) insertDirection.run(name);
    for (const [routeKey, price] of Object.entries(source.prices || {})) {
      const direction = String(price.to || '').trim();
      if (direction) insertTariff.run(directionId(direction), routeKey, price.econom ?? null, price.standard ?? null, price.comfort ?? null);
    }
  }
  if (count('orders') === 0) {
    const source = parse(ordersFile, []);
    const insert = db.prepare(`INSERT OR IGNORE INTO orders
      (id,client_email,driver_id,status,payment_status,from_address,to_address,base_price_rub,commission_rub,created_at,payload_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const order of source) insert.run(order.id, order.clientEmail || null, order.driverId || null, order.status || 'Новый', order.paymentStatus || null, order.from || '', order.to || '', order.basePriceRub ?? null, order.commissionRub ?? null, order.createdAt || new Date().toISOString(), JSON.stringify(order));
  }
  const rowsToUsers = rows => rows.map(row => ({ ...row, name: row.full_name, services: JSON.parse(row.services_json || '[]'), tariffs: JSON.parse(row.tariffs_json || '[]') }));
  return {
    findUserByEmail(email) {
      const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      return row ? { ...row, name: row.full_name, services: JSON.parse(row.services_json || '[]'), tariffs: JSON.parse(row.tariffs_json || '[]') } : null;
    },
    createSession({ tokenHash, userId, expiresAt }) {
      const now = new Date().toISOString(); db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)').run(tokenHash, userId, expiresAt, now, now);
    },
    findSession(tokenHash) {
      const row = db.prepare(`SELECT s.token_hash AS tokenHash,s.user_id AS userId,s.expires_at AS expiresAt,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(tokenHash);
      if (!row) return null; db.prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').run(new Date().toISOString(), tokenHash); return row;
    },
    deleteSession(tokenHash) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash); },
    deleteExpiredSessions() { db.prepare('DELETE FROM sessions WHERE expires_at<?').run(new Date().toISOString()); },
    createAudit({ actorId, action, resourceType, resourceId, ip, metadata = {} }) {
      db.prepare('INSERT INTO audit_log(actor_id,action,resource_type,resource_id,ip,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)').run(actorId || null, action, resourceType || null, resourceId || null, ip || null, JSON.stringify(metadata), new Date().toISOString());
    },
    listAudit(limit = 200) { return db.prepare('SELECT id,actor_id AS actorId,action,resource_type AS resourceType,resource_id AS resourceId,ip,metadata_json AS metadataJson,created_at AS createdAt FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(Number(limit) || 200, 1), 500)).map(row => ({ ...row, metadata: JSON.parse(row.metadataJson) })); },
    createDocument({ driverId, documentType, storageKey }) {
      const now = new Date().toISOString(); db.prepare(`INSERT INTO driver_documents(driver_id,document_type,storage_key,status,uploaded_at) VALUES (?,?,?,?,?) ON CONFLICT(driver_id,document_type) DO UPDATE SET storage_key=excluded.storage_key,status='На проверке',uploaded_at=excluded.uploaded_at`).run(driverId, documentType, storageKey, 'На проверке', now);
    },
    listDocuments(driverId) { return db.prepare('SELECT id,driver_id AS driverId,document_type AS documentType,status,uploaded_at AS uploadedAt FROM driver_documents WHERE driver_id=? ORDER BY uploaded_at DESC').all(driverId); },
    listUsers() {
      return db.prepare(`SELECT id,role,email,full_name AS name,phone,city,status,car,plate,verified_at AS verifiedAt,created_at AS createdAt
        FROM users ORDER BY role, name`).all();
    },
    findDriverVehicle(driverId, plate) {
      return db.prepare(`SELECT u.id, u.full_name AS name, u.email, u.status, v.id AS vehicleId, v.make, v.model,
        v.plate, v.car_class AS carClass, v.status AS vehicleStatus
        FROM users u JOIN vehicles v ON v.driver_id=u.id
        WHERE u.id=? AND u.role='driver' AND upper(v.plate)=upper(?)`).get(driverId, plate);
    },
    createPayment({ id, orderId, provider, method, amountRub, expiresAt, paymentUrl, qrPayload }) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO payments (id,order_id,provider,method,amount_rub,status,expires_at,payment_url,qr_payload,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, orderId, provider, method || null, amountRub, 'pending', expiresAt, paymentUrl, qrPayload, now, now);
      return this.findPayment(id);
    },
    findPayment(id) {
      return db.prepare(`SELECT id,order_id AS orderId,provider,method,amount_rub AS amountRub,status,external_id AS externalId,
        paid_at AS paidAt,expires_at AS expiresAt,payment_url AS paymentUrl,qr_payload AS qrPayload,refunded_at AS refundedAt,
        created_at AS createdAt,updated_at AS updatedAt FROM payments WHERE id=?`).get(id);
    },
    findPaymentByOrder(orderId) { return db.prepare(`SELECT id,order_id AS orderId,provider,method,amount_rub AS amountRub,status,external_id AS externalId,paid_at AS paidAt,expires_at AS expiresAt,payment_url AS paymentUrl,qr_payload AS qrPayload,refunded_at AS refundedAt,created_at AS createdAt,updated_at AS updatedAt FROM payments WHERE order_id=? ORDER BY created_at DESC LIMIT 1`).get(orderId); },
    updatePayment(id, patch) {
      const payment = this.findPayment(id); if (!payment) return null;
      const next = { ...payment, ...patch, updatedAt: new Date().toISOString() };
      db.prepare(`UPDATE payments SET method=?,status=?,external_id=?,paid_at=?,expires_at=?,payment_url=?,qr_payload=?,refunded_at=?,updated_at=? WHERE id=?`)
        .run(next.method || null, next.status, next.externalId || null, next.paidAt || null, next.expiresAt || null, next.paymentUrl || null, next.qrPayload || null, next.refundedAt || null, next.updatedAt, id);
      return this.findPayment(id);
    },
    createTelegramEvent({ orderId, eventType, role, chatId, payload, status = 'pending', attempts = 0, lastError = null, sentAt = null }) {
      const now = new Date().toISOString();
      const result = db.prepare(`INSERT INTO telegram_events (order_id,event_type,role,chat_id,payload_json,status,attempts,last_error,sent_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(orderId || null, eventType, role, chatId || null, JSON.stringify(payload), status, attempts, lastError, sentAt, now, now);
      return this.findTelegramEvent(Number(result.lastInsertRowid));
    },
    updateTelegramEvent(id, patch) {
      const current = this.findTelegramEvent(id); if (!current) return null;
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      db.prepare(`UPDATE telegram_events SET status=?,attempts=?,last_error=?,sent_at=?,updated_at=? WHERE id=?`)
        .run(next.status, next.attempts, next.lastError || null, next.sentAt || null, next.updatedAt, id);
      return this.findTelegramEvent(id);
    },
    findTelegramEvent(id) {
      const row = db.prepare(`SELECT id,order_id AS orderId,event_type AS eventType,role,chat_id AS chatId,payload_json AS payloadJson,status,attempts,last_error AS lastError,sent_at AS sentAt,created_at AS createdAt,updated_at AS updatedAt FROM telegram_events WHERE id=?`).get(id);
      return row ? { ...row, payload: JSON.parse(row.payloadJson) } : null;
    },
    listTelegramEvents(orderId) {
      const rows = orderId
        ? db.prepare(`SELECT id,order_id AS orderId,event_type AS eventType,role,chat_id AS chatId,status,attempts,last_error AS lastError,sent_at AS sentAt,created_at AS createdAt,updated_at AS updatedAt FROM telegram_events WHERE order_id=? ORDER BY created_at`).all(orderId)
        : db.prepare(`SELECT id,order_id AS orderId,event_type AS eventType,role,chat_id AS chatId,status,attempts,last_error AS lastError,sent_at AS sentAt,created_at AS createdAt,updated_at AS updatedAt FROM telegram_events ORDER BY created_at DESC LIMIT 200`).all();
      return rows;
    },
    createUser({ id, role, email, name, phone, passwordHash, verifiedAt, car, plate }) {
      db.prepare(`INSERT INTO users (id,role,email,full_name,phone,status,services_json,tariffs_json,password_hash,verified_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, role, email, name, phone || null, 'Активен', '[]', '[]', passwordHash, verifiedAt || null, new Date().toISOString());
      if (role === 'driver' && car && plate) {
        const parts = String(car).trim().split(/\s+/);
        db.prepare('INSERT OR REPLACE INTO vehicles(id,driver_id,make,model,plate,status) VALUES (?,?,?,?,?,?)').run(`VEH-${id}`, id, parts.shift() || car, parts.join(' ') || 'автомобиль', String(plate).trim().toUpperCase(), 'На проверке');
        db.prepare('UPDATE users SET car=?,plate=? WHERE id=?').run(car, String(plate).trim().toUpperCase(), id);
      }
      return this.findUserByEmail(email);
    },
    setUserCredentials(email, { passwordHash, verifiedAt, role, name, phone }) {
      db.prepare(`UPDATE users SET password_hash=?, verified_at=?, role=COALESCE(?,role), full_name=COALESCE(?,full_name), phone=COALESCE(?,phone), status='Активен' WHERE email=?`)
        .run(passwordHash, verifiedAt || null, role || null, name || null, phone || null, email);
      return this.findUserByEmail(email);
    },
    readUsers() {
      const rows = rowsToUsers(db.prepare('SELECT * FROM users ORDER BY id').all());
      return { drivers: rows.filter(row => row.role === 'driver').map(({ role, full_name, services_json, tariffs_json, password_hash, verified_at, created_at, ...row }) => row), clients: rows.filter(row => row.role === 'client').map(({ role, full_name, services_json, tariffs_json, password_hash, verified_at, created_at, ...row }) => row) };
    },
    resetUsers(seed) {
      db.exec('BEGIN');
      const insert = db.prepare(`INSERT INTO users (id,role,email,full_name,phone,city,status,car,plate,services_json,tariffs_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      const now = new Date().toISOString();
      try {
        db.exec('DELETE FROM telegram_events; DELETE FROM payments; DELETE FROM orders; DELETE FROM driver_documents; DELETE FROM vehicles; DELETE FROM users;');
        for (const d of seed.drivers || []) insert.run(d.id, 'driver', d.email || null, d.name || '', d.phone || null, d.city || null, d.status || null, d.car || null, d.plate || null, JSON.stringify(d.services || []), JSON.stringify(d.tariffs || []), now);
        for (const c of seed.clients || []) insert.run(c.id, 'client', c.email || null, c.name || '', c.phone || null, c.city || null, c.status || null, null, null, '[]', '[]', now);
        const vehicle = db.prepare('INSERT OR IGNORE INTO vehicles(id,driver_id,make,model,plate,car_class,status) VALUES (?,?,?,?,?,?,?)');
        for (const d of seed.drivers || []) { const parts = String(d.car || '').trim().split(/\s+/); if (d.car && d.plate) vehicle.run(`VEH-${d.id}`, d.id, parts.shift() || d.car, parts.join(' ') || 'автомобиль', d.plate, d.carClass || null, d.status || 'На проверке'); }
        db.exec('COMMIT');
        return this.readUsers();
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    readOrders() {
      const rows = db.prepare('SELECT * FROM orders ORDER BY created_at').all();
      let changed = false;
      const result = rows.map(row => {
        const order = JSON.parse(row.payload_json);
        if (order.status === 'Машина назначена' && order.paymentStatus === 'Ожидает оплаты комиссии' && order.paymentDeadline && Date.now() > Date.parse(order.paymentDeadline)) {
          order.status = 'Аннулирован: комиссия не оплачена'; order.cancelledAt = new Date().toISOString(); changed = true;
        }
        return order;
      });
      if (changed) this.writeOrders(result);
      return result;
    },
    writeOrders(orders) {
      const update = db.prepare(`INSERT INTO orders (id,client_email,driver_id,status,payment_status,from_address,to_address,base_price_rub,commission_rub,created_at,payload_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET client_email=excluded.client_email,driver_id=excluded.driver_id,status=excluded.status,payment_status=excluded.payment_status,from_address=excluded.from_address,to_address=excluded.to_address,base_price_rub=excluded.base_price_rub,commission_rub=excluded.commission_rub,created_at=excluded.created_at,payload_json=excluded.payload_json`);
      const tx = db.createSession();
      db.exec('BEGIN');
      try { for (const order of orders) update.run(order.id, order.clientEmail || null, order.driverId || null, order.status || 'Новый', order.paymentStatus || null, order.from || '', order.to || '', order.basePriceRub ?? null, order.commissionRub ?? null, order.createdAt || new Date().toISOString(), JSON.stringify(order)); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } finally { tx.close(); }
    },
    readDistricts() { return db.prepare('SELECT id,name,trip_price_rub AS tripPriceRub FROM districts WHERE active=1 ORDER BY name').all(); },
    findDistrict(value) { return db.prepare('SELECT id,name,trip_price_rub AS tripPriceRub FROM districts WHERE active=1 AND (id=? OR name=?)').get(value, value); },
    readStreets() { return []; },
    findTariff(routeKey) { return db.prepare('SELECT econom_rub AS econom,standard_rub AS standard,comfort_rub AS comfort FROM tariffs WHERE route_key=?').get(routeKey); },
    listDirections() { return db.prepare('SELECT name FROM directions WHERE active=1 ORDER BY name').all().map(row => row.name); },
    listTariffs() {
      return db.prepare(`SELECT t.route_key AS routeKey, d.name AS toName, t.econom_rub AS econom,
        t.standard_rub AS standard, t.comfort_rub AS comfort
        FROM tariffs t JOIN directions d ON d.id=t.direction_id ORDER BY t.route_key`).all();
    },
    importTariffs(rows) {
      const normalized = rows.map(row => {
        const from = String(row.from || '').trim(); const to = String(row.to || '').trim();
        const routeKey = `${from.toLowerCase()}→${to.toLowerCase()}`;
        return { from, to, routeKey, econom: Number(row.econom), standard: Number(row.standard), comfort: Number(row.comfort) };
      });
      const seen = new Set(); const errors = [];
      for (const [index, row] of normalized.entries()) {
        if (!row.from || !row.to) errors.push({ row: index + 1, error: 'from_to_required' });
        if (seen.has(row.routeKey)) errors.push({ row: index + 1, error: 'duplicate_route_in_import', routeKey: row.routeKey });
        seen.add(row.routeKey);
        for (const field of ['econom', 'standard', 'comfort']) if (!Number.isSafeInteger(row[field]) || row[field] <= 0) errors.push({ row: index + 1, field, error: 'positive_integer_price_required' });
      }
      if (errors.length) return { imported: 0, errors };
      const addDirection = db.prepare('INSERT OR IGNORE INTO directions(name) VALUES (?)');
      const getDirection = db.prepare('SELECT id FROM directions WHERE name=?');
      const upsert = db.prepare(`INSERT INTO tariffs(direction_id,route_key,econom_rub,standard_rub,comfort_rub)
        VALUES (?,?,?,?,?) ON CONFLICT(route_key) DO UPDATE SET direction_id=excluded.direction_id,
        econom_rub=excluded.econom_rub,standard_rub=excluded.standard_rub,comfort_rub=excluded.comfort_rub`);
      db.exec('BEGIN');
      try {
        for (const row of normalized) { addDirection.run(row.to); upsert.run(getDirection.get(row.to).id, row.routeKey, row.econom, row.standard, row.comfort); }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { imported: normalized.length, errors: [], tariffs: this.listTariffs() };
    }
  };
}
