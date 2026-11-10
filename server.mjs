import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { createDatabase } from './db.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const testAuth = String(process.env.TEST_AUTH_MODE || 'false') === 'true';
const codes = new Map();
const sessionTtlMs = 7 * 24 * 60 * 60_000;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const usersFile = path.join(root, 'data', 'test-users.json');
const ordersFile = path.join(dataDir, 'orders.json');
const platformDbFile = path.join(root, 'data', 'platform-db.json');
const fixedDirectionsFile = path.join(root, 'data', 'fixed-directions.json');
const carClassificationFile = path.join(root, 'data', 'car-classification.json');
const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
const telegramChats = {
  client: process.env.TELEGRAM_CLIENT_CHAT_ID || telegramChatId,
  driver: process.env.TELEGRAM_DRIVER_CHAT_ID || telegramChatId,
  dispatcher: process.env.TELEGRAM_DISPATCHER_CHAT_ID || telegramChatId,
  admin: process.env.TELEGRAM_ADMIN_CHAT_ID || telegramChatId
};
const telegramMaxAttempts = 3;
const maxBotToken = process.env.MAX_BOT_TOKEN || '';
const maxChatId = process.env.MAX_CHAT_ID || '';
const maxChats = { client: process.env.MAX_CLIENT_CHAT_ID || maxChatId, driver: process.env.MAX_DRIVER_CHAT_ID || maxChatId, dispatcher: process.env.MAX_DISPATCHER_CHAT_ID || maxChatId, admin: process.env.MAX_ADMIN_CHAT_ID || maxChatId };
const maxMaxAttempts = 3;
const osrmUrl = (process.env.OSRM_URL || 'http://localhost:5000').replace(/\/$/, '');
const distanceRateRub = 75;
const platformCommissionRate = 0.2;
const osrmTimeoutMs = Number(process.env.OSRM_TIMEOUT_MS || 8000);
const rateWindowMs = 60_000;
const rateLimit = Number(process.env.RATE_LIMIT || 120);
const rateBuckets = new Map();
const uploadDir = path.join(dataDir, 'driver-documents');
const maxDocumentBytes = 5 * 1024 * 1024;
const allowedDocumentTypes = new Set(['passport', 'license', 'vehicle_registration', 'insurance']);
const allowedDocumentMime = new Map([['application/pdf', '.pdf'], ['image/jpeg', '.jpg'], ['image/png', '.png']]);
const paymentWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || '';
const knownPlaces = {
  'Калининград': [54.7104, 20.4522], 'Светлогорск': [54.9438, 20.1514], 'Зеленоградск': [54.9581, 20.4759], 'Советск': [55.0810, 21.8886], 'Черняховск': [54.6311, 21.8156], 'Гурьевск': [54.7717, 20.6032], 'Гусев': [54.5922, 22.1947], 'Балтийск': [54.6514, 19.9142], 'Светлый': [54.6750, 20.1347], 'Янтарный': [54.8710, 19.9380], 'Куршская коса': [55.1700, 20.8500], 'п. Лесной': [55.0200, 20.8700], 'п. Морской': [55.1300, 20.7700], 'п. Рыбачий': [55.1500, 20.8000], 'дюна Эфа': [55.2340, 20.9130], 'Танцующий лес': [55.1740, 20.8530], 'Аэропорт Храброво': [54.8900, 20.5920]
};
const seedUsers = {
  drivers: [
    { id: 'DRV-001', name: 'Иван Петров', city: 'Калининград', car: 'Mercedes-Benz E-Class', plate: 'А123АА39', status: 'Проверен', tariffs: ['Аэропорт', 'Межгород'] },
    { id: 'DRV-002', name: 'Анна Смирнова', city: 'Светлогорск', car: 'Mercedes-Benz V-Class', plate: 'В456ВВ39', status: 'На проверке', tariffs: ['VIP-трансфер', 'Почасовая аренда'] },
    { id: 'DRV-003', name: 'Михаил Волков', city: 'Зеленоградск', car: 'Toyota Camry', plate: 'М789ММ39', status: 'Проверен', tariffs: ['Городские поездки', 'Аэропорт'] }
  ],
  clients: [
    { id: 'CLI-001', name: 'Алексей Морозов', email: 'alexey.test@example.com', phone: '+7 900 000-00-01', status: 'Активен' },
    { id: 'CLI-002', name: 'Елена Орлова', email: 'elena.test@example.com', phone: '+7 900 000-00-02', status: 'Активен' },
    { id: 'CLI-003', name: 'Дмитрий Соколов', email: 'dmitry.test@example.com', phone: '+7 900 000-00-03', status: 'Профиль заполнен' }
  ]
};

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify(seedUsers, null, 2), 'utf8');
if (!fs.existsSync(ordersFile)) fs.writeFileSync(ordersFile, '[]', 'utf8');
if (!fs.existsSync(platformDbFile)) fs.writeFileSync(platformDbFile, JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString().slice(0, 10), drivers: [], clients: [], districts: [{ id: 'central', name: 'Центральный район', tripPriceRub: null }, { id: 'moscow', name: 'Московский район', tripPriceRub: null }, { id: 'leningrad', name: 'Ленинградский район', tripPriceRub: null }, { id: 'october', name: 'Октябрьский район', tripPriceRub: null }], streets: [], orders: [] }, null, 2), 'utf8');
const database = createDatabase({ dataDir, usersFile, ordersFile, platformDbFile, fixedDirectionsFile });
function readUsers() { return database.readUsers(); }
function writeUsers(data) { return database.resetUsers(data); }
function readOrders() { return database.readOrders(); }
function writeOrders(data) { return database.writeOrders(data); }
function readPlatformDb() { return { districts: database.readDistricts(), streets: [] }; }
function writePlatformDb() { throw new Error('platform database is managed by SQLite'); }
function readFixedDirections() { return { directions: database.listDirections(), prices: {} }; }
function readCarClassification() { return JSON.parse(fs.readFileSync(carClassificationFile, 'utf8')); }
function classifyCar(make, model) {
  const text = `${make || ''} ${model || ''}`.toLowerCase();
  return readCarClassification().find(item => item.models.toLowerCase().split(', ').some(brand => text.includes(brand.toLowerCase())))?.category || null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, encoded) {
  const [salt, expected] = String(encoded || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => item.trim().split('=').map(decodeURIComponent)).filter(item => item.length === 2));
}

function currentUser(req) {
  const token = parseCookies(req).ett_session;
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const session = database.findSession(hash);
  if (!session || Date.parse(session.expiresAt) < Date.now()) { database.deleteSession(hash); return null; }
  return database.findUserByEmail(session.email);
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, role: user.role, email: user.email, name: user.name, phone: user.phone, city: user.city, status: user.status, car: user.car, plate: user.plate };
}

function setSession(req, token) { return { 'Set-Cookie': `ett_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` }; }

function requireRole(req, res, roles) {
  const user = currentUser(req);
  if (!user) { json(res, 401, { error: 'authentication_required' }); return null; }
  if (!roles.includes(user.role)) { json(res, 403, { error: 'insufficient_role' }); return null; }
  return user;
}

function clientIp(req) { return process.env.TRUST_PROXY === 'true' ? String(req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown') : String(req.socket.remoteAddress || 'unknown'); }
function audit(req, actor, action, resourceType, resourceId, metadata = {}) { database.createAudit({ actorId: actor?.id, action, resourceType, resourceId, ip: clientIp(req), metadata }); }
function checkRateLimit(req, res) {
  const now = Date.now(); const key = clientIp(req); const bucket = rateBuckets.get(key) || { startedAt: now, count: 0 };
  if (now - bucket.startedAt >= rateWindowMs) { bucket.startedAt = now; bucket.count = 0; }
  bucket.count += 1; rateBuckets.set(key, bucket);
  for (const [ip, entry] of rateBuckets) if (now - entry.startedAt > rateWindowMs) rateBuckets.delete(ip);
  if (bucket.count > rateLimit) { json(res, 429, { error: 'rate_limit_exceeded' }, { 'Retry-After': '60' }); return false; }
  return true;
}
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`).origin; } catch { return false; }
}

function normalizePlace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function geocodePlace(value) {
  const normalized = normalizePlace(value);
  const entry = Object.entries(knownPlaces).find(([name]) => normalizePlace(name) === normalized);
  return entry ? { name: entry[0], lat: entry[1][0], lon: entry[1][1], source: 'local-known-places' } : null;
}

function validateCoordinates(point) {
  if (!Array.isArray(point) || point.length !== 2) return false;
  const [lat, lon] = point.map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

async function deliverTelegramEvent(event) {
  if (!telegramToken || !event.chatId) return database.updateTelegramEvent(event.id, { status: 'skipped', lastError: 'telegram_not_configured' });
  let lastError = null;
  for (let attempt = event.attempts; attempt < telegramMaxAttempts; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: event.chatId, text: String(event.payload.text || '').slice(0, 4096), protect_content: true }), signal: AbortSignal.timeout(8000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(`telegram_delivery_${response.status}`);
      return database.updateTelegramEvent(event.id, { status: 'sent', attempts: attempt + 1, sentAt: new Date().toISOString(), lastError: null });
    } catch (error) { lastError = String(error.message).slice(0, 120); database.updateTelegramEvent(event.id, { attempts: attempt + 1, lastError }); }
  }
  return database.updateTelegramEvent(event.id, { status: 'failed', lastError });
}

async function notifyTelegramRoles(order, eventType, text, roles) {
  const results = [];
  for (const role of roles) {
    const event = database.createTelegramEvent({ orderId: order.id, eventType, role, chatId: telegramChats[role] || null, payload: { text } });
    results.push(await deliverTelegramEvent(event));
  }
  return { sent: results.some(item => item.status === 'sent'), events: results.map(item => ({ id: item.id, role: item.role, status: item.status, attempts: item.attempts, reason: item.lastError || undefined })) };
}

async function notifyAssignment(order) {
  const text = ['🚘 Назначен автомобиль', `Заказ: ${order.id}`, `Маршрут: ${order.from} → ${order.to}`, `Дата и время: ${order.date || 'не указано'} ${order.time || ''}`, `Клиент: ${order.clientName || order.clientEmail || 'не указан'}`, `Автомобиль: ${order.vehicle}`, `Гос. номер: ${order.vehiclePlate}`, `Водитель: ${order.driverName || order.driverId || 'не указан'}`].join('\n');
  return notifyTelegramRoles(order, 'vehicle_assigned', text, ['client', 'driver', 'dispatcher']);
}

async function notifyTripReport(order) {
  const text = ['✅ Поездка завершена', `Заказ: ${order.id}`, `Маршрут: ${order.from} → ${order.to}`, `Клиент: ${order.clientName || order.clientEmail}`, `Автомобиль: ${order.vehicle}`, `Гос. номер: ${order.vehiclePlate}`, `Водитель: ${order.driverName || order.driverId}`, `Начало: ${order.tripStartedAt}`, `Завершение: ${order.tripCompletedAt}`, `Отчёт: ${order.report || 'без комментария'}`].join('\n');
  return notifyTelegramRoles(order, 'trip_completed', text, ['client', 'dispatcher', 'admin']);
}

async function deliverMaxEvent(event, text) {
  if (!maxBotToken || !event.chatId) return database.updateMaxEvent(event.id, { status: 'skipped', lastError: 'max_not_configured' });
  let lastError = null;
  for (let attempt = event.attempts; attempt < maxMaxAttempts; attempt += 1) {
    try {
      const url = `https://platform-api.max.ru/messages?chat_id=${encodeURIComponent(event.chatId)}`;
      const response = await fetch(url, { method: 'POST', headers: { Authorization: maxBotToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: String(text).slice(0, 4000) }), signal: AbortSignal.timeout(8000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`max_delivery_${response.status}_${payload.code || 'error'}`);
      return database.updateMaxEvent(event.id, { status: 'sent', attempts: attempt + 1, sentAt: new Date().toISOString(), lastError: null });
    } catch (error) { lastError = String(error.message).slice(0, 160); database.updateMaxEvent(event.id, { attempts: attempt + 1, lastError }); }
  }
  return database.updateMaxEvent(event.id, { status: 'failed', lastError });
}

async function notifyMaxRoles(order, eventType, text, roles) {
  const results = [];
  for (const role of roles) { const event = database.createMaxEvent({ orderId: order.id, eventType, chatId: maxChats[role] || null }); results.push(await deliverMaxEvent(event, text)); }
  return { sent: results.some(item => item.status === 'sent'), events: results.map(item => ({ id: item.id, status: item.status, attempts: item.attempts, reason: item.lastError || undefined })) };
}

async function notifyMaxAssignment(order) {
  return notifyMaxRoles(order, 'vehicle_assigned', ['🚘 Назначен автомобиль', `Заказ: ${order.id}`, `Маршрут: ${order.from} → ${order.to}`, `Автомобиль: ${order.vehicle}`, `Гос. номер: ${order.vehiclePlate}`, `Водитель: ${order.driverName || order.driverId}`].join('\n'), ['client', 'driver', 'dispatcher']);
}

async function notifyMaxTripReport(order) {
  return notifyMaxRoles(order, 'trip_completed', ['✅ Поездка завершена', `Заказ: ${order.id}`, `Маршрут: ${order.from} → ${order.to}`, `Отчёт: ${order.report || 'без комментария'}`].join('\n'), ['client', 'dispatcher', 'admin']);
}

async function calculateOsrmRoute(from, to) {
  const fixed = readFixedDirections();
  const fromPlace = geocodePlace(from);
  const toPlace = geocodePlace(to);
  const fixedKey = `${normalizePlace(from)}→${normalizePlace(to)}`;
  const fixedPrice = database.findTariff(fixedKey);
  if (fixedPrice) return { available: true, provider: 'fixed-table', pricing: 'fixed', from: fromPlace?.name || String(from).trim(), to: toPlace?.name || String(to).trim(), basePriceRub: fixedPrice.standard, commissionRub: Math.round(fixedPrice.standard * platformCommissionRate), clientTotalRub: fixedPrice.standard + Math.round(fixedPrice.standard * platformCommissionRate), prices: fixedPrice, pricingRule: 'fixed price from Excel + 20% platform commission' };
  if (fixed.directions.some(direction => normalizePlace(direction) === normalizePlace(to))) return { available: false, reason: 'fixed_price_not_set', pricing: 'fixed', from, to };
  if (!fromPlace || !toPlace) return { available: false, reason: 'place_not_in_directory', from, to };
  return calculateOsrmCoordinates([fromPlace.lat, fromPlace.lon], [toPlace.lat, toPlace.lon], fromPlace.name, toPlace.name);
}

async function calculateOsrmCoordinates(a, b, from, to) {
  if (!validateCoordinates(a) || !validateCoordinates(b)) throw new Error('invalid_coordinates');
  const url = `${osrmUrl}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=false&steps=false`;
  const response = await fetch(url, { signal: AbortSignal.timeout(osrmTimeoutMs) }); if (!response.ok) throw new Error(`osrm_${response.status}`);
  const data = await response.json(); const route = data.routes?.[0];
  if (!route || !Number.isFinite(Number(route.distance)) || !Number.isFinite(Number(route.duration))) throw new Error('osrm_route_not_found');
  const distanceKm = Math.round(route.distance / 100) / 10;
  const basePriceRub = Math.round(distanceKm * distanceRateRub);
  const commissionRub = Math.round(basePriceRub * platformCommissionRate);
  return { available: true, provider: 'osrm', distanceKm, durationMin: Math.round(route.duration / 60), basePriceRub, commissionRub, clientTotalRub: basePriceRub + commissionRub, pricingRule: 'distance_km * 75 RUB + 20% platform commission', from, to };
}

const transporter = process.env.SMTP_JSON_TRANSPORT === 'true'
  ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000
  });

const mailConfigured = process.env.SMTP_JSON_TRANSPORT === 'true' || Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM);

async function notifyAssignmentEmail(order, recipient, audience) {
  if (!recipient) return { sent: false, reason: 'recipient_not_configured' };
  if (!mailConfigured) return { sent: false, reason: 'smtp_not_configured' };
  const subject = audience === 'driver' ? `Новый заказ ${order.id} — автомобиль назначен` : `Заказ ${order.id} — автомобиль назначен`;
  const text = [
    audience === 'driver' ? 'Вам назначен заказ.' : 'Ваш заказ подтверждён назначением автомобиля.',
    `Заказ: ${order.id}`,
    `Маршрут: ${order.from} → ${order.to}`,
    `Дата и время: ${order.date || 'не указано'} ${order.time || ''}`,
    `Автомобиль: ${order.vehicle}`,
    `Гос. номер: ${order.vehiclePlate}`,
    `Водитель: ${order.driverName || order.driverId || 'не указан'}`,
    audience === 'client' ? `Оплатить комиссию необходимо до: ${order.paymentDeadline}` : ''
  ].filter(Boolean).join('\n');
  try {
    await transporter.sendMail({ from: process.env.MAIL_FROM, to: recipient, subject, text });
    return { sent: process.env.SMTP_JSON_TRANSPORT !== 'true', generated: true, transport: process.env.SMTP_JSON_TRANSPORT === 'true' ? 'json' : 'smtp', recipient: recipient.replace(/(.{2}).+(@.*)/, '$1***$2') };
  } catch (error) {
    console.error('assignment_email_delivery_failed', String(error.message).slice(0, 120));
    return { sent: false, reason: 'email_delivery_failed' };
  }
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function body(req, maxBytes = 32_000) {
  return new Promise((resolve, reject) => {
    let value = '';
    req.on('data', chunk => { value += chunk; if (value.length > maxBytes) reject(new Error('payload too large')); });
    req.on('end', () => { try { resolve(JSON.parse(value || '{}')); } catch { reject(new Error('invalid json')); } });
    req.on('error', reject);
  });
}

function rawBody(req) {
  return new Promise((resolve, reject) => {
    let value = '';
    req.on('data', chunk => { value += chunk; if (value.length > 32_000) reject(new Error('payload too large')); });
    req.on('end', () => resolve(value)); req.on('error', reject);
  });
}

function paymentResponse(payment) {
  if (!payment) return null;
  return { id: payment.id, orderId: payment.orderId, provider: payment.provider, method: payment.method, amountRub: payment.amountRub, status: payment.status, expiresAt: payment.expiresAt, paymentUrl: payment.paymentUrl, qrPayload: payment.qrPayload, paidAt: payment.paidAt, refundedAt: payment.refundedAt };
}

function paymentSignature(payload) {
  return crypto.createHmac('sha256', paymentWebhookSecret).update(payload).digest('hex');
}

async function handleRequest(req, res) {
  if (!checkRateLimit(req, res)) return;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error: 'origin_not_allowed' });
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && req.url === '/api/test-users') return testAuth ? json(res, 200, readUsers()) : json(res, 404, { error: 'not_found' });
  if (req.method === 'GET' && req.url === '/api/users') {
    if (!requireRole(req, res, ['admin', 'dispatcher'])) return;
    return json(res, 200, { users: database.listUsers() });
  }
  if (req.method === 'GET' && req.url === '/api/audit') {
    if (!requireRole(req, res, ['admin'])) return;
    return json(res, 200, { events: database.listAudit() });
  }
  if (req.method === 'GET' && req.url.startsWith('/api/driver/documents')) {
    const actor = requireRole(req, res, ['driver', 'dispatcher', 'admin']); if (!actor) return;
    const query = new URL(req.url, `http://${req.headers.host}`); const driverId = actor.role === 'driver' ? actor.id : query.searchParams.get('driverId');
    if (!driverId) return json(res, 400, { error: 'driver_id_required' });
    return json(res, 200, { documents: database.listDocuments(driverId) });
  }
  if (req.method === 'POST' && req.url === '/api/driver/documents') {
    const actor = requireRole(req, res, ['driver']); if (!actor) return;
    try {
      const data = await body(req, Math.ceil(maxDocumentBytes * 1.4) + 1000); const documentType = String(data.documentType || ''); const mimeType = String(data.mimeType || '').toLowerCase();
      if (!allowedDocumentTypes.has(documentType) || !allowedDocumentMime.has(mimeType)) return json(res, 400, { error: 'unsupported_document' });
      const encoded = String(data.contentBase64 || ''); if (!encoded || encoded.length > Math.ceil(maxDocumentBytes * 1.4)) return json(res, 413, { error: 'document_too_large' });
      const content = Buffer.from(encoded, 'base64'); if (!content.length || content.length > maxDocumentBytes) return json(res, 413, { error: 'document_too_large' });
      const valid = mimeType === 'application/pdf' ? content.subarray(0, 5).toString() === '%PDF-' : mimeType === 'image/png' ? content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a','hex')) : content.subarray(0, 3).equals(Buffer.from('ffd8ff','hex'));
      if (!valid) return json(res, 422, { error: 'document_signature_mismatch' });
      const id = crypto.randomUUID(); const storageKey = `${id}${allowedDocumentMime.get(mimeType)}`; fs.writeFileSync(path.join(uploadDir, storageKey), content, { flag: 'wx' });
      database.createDocument({ driverId: actor.id, documentType, storageKey }); audit(req, actor, 'driver.document.upload', 'driver_document', storageKey, { documentType, mimeType, bytes: content.length });
      return json(res, 201, { uploaded: true, documentType, status: 'На проверке' });
    } catch { return json(res, 400, { error: 'invalid_document' }); }
  }
  if (req.method === 'GET' && req.url === '/api/tariffs') return json(res, 200, { tariffs: database.listTariffs(), directions: database.listDirections() });
  if (req.method === 'GET' && req.url.startsWith('/api/telegram/events')) {
    if (!requireRole(req, res, ['dispatcher', 'admin'])) return;
    const query = new URL(req.url, `http://${req.headers.host}`); return json(res, 200, { events: database.listTelegramEvents(query.searchParams.get('orderId') || null) });
  }
  if (req.method === 'GET' && req.url.startsWith('/api/max/events')) {
    if (!requireRole(req, res, ['dispatcher', 'admin'])) return;
    const query = new URL(req.url, `http://${req.headers.host}`); return json(res, 200, { events: database.listMaxEvents(query.searchParams.get('orderId') || null) });
  }
  if (req.method === 'POST' && req.url.startsWith('/api/telegram/events/') && req.url.endsWith('/retry')) {
    if (!requireRole(req, res, ['dispatcher', 'admin'])) return;
    const eventId = Number(req.url.split('/')[4]); const event = database.findTelegramEvent(eventId);
    if (!event) return json(res, 404, { error: 'telegram_event_not_found' });
    if (event.status === 'sent') return json(res, 409, { error: 'telegram_event_already_sent' });
    const retried = await deliverTelegramEvent(database.updateTelegramEvent(eventId, { status: 'pending', lastError: null }));
    return json(res, 200, { event: retried });
  }
  if (req.method === 'GET' && req.url.startsWith('/api/geocode?')) {
    const query = new URL(req.url, `http://${req.headers.host}`); const place = geocodePlace(query.searchParams.get('q'));
    return place ? json(res, 200, { available: true, result: place }) : json(res, 404, { available: false, error: 'place_not_found' });
  }
  if (req.method === 'GET' && req.url === '/api/route/health') {
    try {
      const response = await fetch(`${osrmUrl}/route/v1/driving/20.4522,54.7104;20.4759,54.9581?overview=false&steps=false`, { signal: AbortSignal.timeout(osrmTimeoutMs) });
      return json(res, response.ok ? 200 : 503, { available: response.ok, provider: 'osrm', status: response.status });
    } catch { return json(res, 503, { available: false, provider: 'osrm', error: 'osrm_unreachable' }); }
  }
  if (req.method === 'POST' && req.url === '/api/admin/tariffs/import') {
    if (!requireRole(req, res, ['admin', 'dispatcher'])) return;
    try {
      const data = await body(req);
      if (!Array.isArray(data.rows) || data.rows.length === 0 || data.rows.length > 5000) return json(res, 400, { error: 'rows_array_required' });
      const result = database.importTariffs(data.rows);
      return json(res, result.errors.length ? 422 : 200, result);
    } catch { return json(res, 400, { error: 'invalid_request' }); }
  }
  if (req.method === 'GET' && req.url === '/api/orders') {
    const actor = requireRole(req, res, ['client', 'driver', 'dispatcher', 'admin']); if (!actor) return;
    const orders = readOrders();
    if (actor.role === 'client') return json(res, 200, orders.filter(order => order.clientEmail === actor.email));
    if (actor.role === 'driver') return json(res, 200, orders.filter(order => !order.driverId || order.driverId === actor.id));
    return json(res, 200, orders);
  }
  if (req.method === 'GET' && req.url === '/api/car-classification') return json(res, 200, readCarClassification());
  if (req.method === 'GET' && req.url === '/api/districts') return json(res, 200, readPlatformDb().districts);
  if (req.method === 'GET' && req.url === '/api/streets') return json(res, 200, readPlatformDb().streets);
  if (req.method === 'POST' && req.url === '/api/quote') {
    const data = await body(req); const db = readPlatformDb(); const district = db.districts.find(item => item.id === data.districtId || item.name === data.district);
    if (!district) return json(res, 404, { error: 'district_not_found' });
    if (district.tripPriceRub == null) return json(res, 200, { available: false, reason: 'district_price_not_set', district: district.name });
    const commission = Math.round(district.tripPriceRub * 0.2); return json(res, 200, { available: true, district: district.name, basePriceRub: district.tripPriceRub, commissionRub: commission, clientTotalRub: district.tripPriceRub + commission });
  }
  if (req.method === 'GET' && req.url.startsWith('/api/route?')) {
    try { const query = new URL(req.url, `http://${req.headers.host}`); const from = query.searchParams.get('from'); const to = query.searchParams.get('to'); if (!from || !to) return json(res, 400, { error: 'missing_route_points' }); return json(res, 200, await calculateOsrmRoute(from, to)); } catch (error) { console.error(error); return json(res, 502, { error: 'route_calculation_failed' }); }
  }
  if (req.method === 'POST' && req.url === '/api/orders') {
    try {
      const actor = requireRole(req, res, ['client']); if (!actor) return;
      const data = await body(req);
      if (!data.from || !data.to || !data.clientEmail) return json(res, 400, { error: 'missing_order_fields' });
      let route = null;
      try {
        route = data.fromLat != null && data.fromLon != null && data.toLat != null && data.toLon != null
          ? await calculateOsrmCoordinates([Number(data.fromLat), Number(data.fromLon)], [Number(data.toLat), Number(data.toLon)], String(data.from).trim(), String(data.to).trim())
          : await calculateOsrmRoute(data.from, data.to);
      } catch { route = null; }
      const fields = Object.fromEntries(['from','to','date','time','passengers','carClass','clientPhone'].filter(key => data[key] != null).map(key => [key, String(data[key]).slice(0, 300)]));
      const order = { ...fields, clientEmail: actor.email, clientName: actor.name, id: `ORD-${crypto.randomUUID()}`, status: 'Новый', paymentStatus: 'Ожидает оплаты комиссии', commissionRate: platformCommissionRate, paymentDeadlineMinutes: 10, createdAt: new Date().toISOString(), ...(route?.available ? { routeDistanceKm: route.distanceKm, routeDurationMin: route.durationMin, basePriceRub: route.basePriceRub, commissionRub: route.commissionRub, clientTotalRub: route.clientTotalRub, pricingRule: route.pricingRule } : {}) };
      const orders = readOrders(); orders.push(order); writeOrders(orders); audit(req, actor, 'order.create', 'order', order.id, { from: order.from, to: order.to });
      return json(res, 201, order);
    } catch { return json(res, 400, { error: 'invalid_request' }); }
  }
  if (req.method === 'POST' && req.url.startsWith('/api/orders/') && req.url.endsWith('/accept')) {
    const actor = requireRole(req, res, ['driver']); if (!actor) return;
    const orderId = req.url.split('/')[3]; const data = await body(req); const orders = readOrders(); const order = orders.find(item => item.id === orderId);
    if (!order || order.status !== 'Новый') return json(res, 409, { error: 'order_not_available' });
    Object.assign(order, { status: 'Принят водителем', acceptedAt: new Date().toISOString(), driverId: actor.id, driverName: actor.name }); writeOrders(orders); audit(req, actor, 'order.accept', 'order', order.id); return json(res, 200, order);
  }
  if (req.method === 'GET' && req.url.startsWith('/api/orders/') && req.url.endsWith('/payment')) {
    const actor = requireRole(req, res, ['client', 'dispatcher', 'admin']); if (!actor) return;
    const orderId = req.url.split('/')[3]; const order = readOrders().find(item => item.id === orderId);
    if (!order || (actor.role === 'client' && order.clientEmail !== actor.email)) return json(res, 403, { error: 'order_owner_required' });
    const payment = database.findPaymentByOrder(orderId); if (!payment) return json(res, 404, { error: 'payment_not_created' });
    if (payment.status === 'pending' && Date.parse(payment.expiresAt) <= Date.now()) database.updatePayment(payment.id, { status: 'expired' });
    return json(res, 200, { payment: paymentResponse(database.findPayment(payment.id)) });
  }
  if (req.method === 'POST' && req.url.startsWith('/api/payments/') && req.url.endsWith('/cancel')) {
    const actor = requireRole(req, res, ['client', 'dispatcher', 'admin']); if (!actor) return;
    const paymentId = req.url.split('/')[3]; const payment = database.findPayment(paymentId);
    if (!payment) return json(res, 404, { error: 'payment_not_found' });
    const order = readOrders().find(item => item.id === payment.orderId);
    if (actor.role === 'client' && (!order || order.clientEmail !== actor.email)) return json(res, 403, { error: 'order_owner_required' });
    if (['paid', 'refunded'].includes(payment.status)) return json(res, 409, { error: 'payment_already_final' });
    const updated = database.updatePayment(paymentId, { status: 'cancelled' });
    if (order && ['Новый', 'Машина назначена'].includes(order.status)) { order.paymentStatus = 'Платёж отменён'; order.status = 'Аннулирован: платёж отменён'; writeOrders(readOrders().map(item => item.id === order.id ? order : item)); }
    return json(res, 200, { payment: paymentResponse(updated), order });
  }
  if (req.method === 'POST' && req.url.startsWith('/api/payments/') && req.url.endsWith('/refund')) {
    const actor = requireRole(req, res, ['dispatcher', 'admin']); if (!actor) return;
    const paymentId = req.url.split('/')[3]; const payment = database.findPayment(paymentId);
    if (!payment) return json(res, 404, { error: 'payment_not_found' });
    if (payment.status !== 'paid') return json(res, 409, { error: 'payment_not_refundable' });
    const updated = database.updatePayment(paymentId, { status: 'refunded', refundedAt: new Date().toISOString() });
    const orders = readOrders(); const order = orders.find(item => item.id === payment.orderId);
    if (order) { order.paymentStatus = 'Комиссия возвращена'; order.status = 'Аннулирован: комиссия возвращена'; writeOrders(orders); }
    return json(res, 200, { payment: paymentResponse(updated), order });
  }
  if (req.method === 'POST' && req.url === '/api/payments/webhook') {
    if (!paymentWebhookSecret) return json(res, 503, { error: 'payment_webhook_secret_not_configured' });
    try {
      const payload = await rawBody(req); const signature = String(req.headers['x-payment-signature'] || '');
      const expected = paymentSignature(payload);
      if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return json(res, 401, { error: 'invalid_payment_signature' });
      const data = JSON.parse(payload); const payment = database.findPayment(String(data.paymentId || ''));
      if (!payment) return json(res, 404, { error: 'payment_not_found' });
      if (payment.status === 'paid') return json(res, 200, { ok: true, idempotent: true, payment: paymentResponse(payment) });
      if (payment.status !== 'pending' || Date.parse(payment.expiresAt) <= Date.now()) return json(res, 409, { error: 'payment_expired_or_closed' });
      const updated = database.updatePayment(payment.id, { status: 'paid', externalId: String(data.externalId || ''), paidAt: new Date().toISOString(), method: data.method === 'qr' ? 'QR-код' : 'Карта' });
      const orders = readOrders(); const order = orders.find(item => item.id === payment.orderId);
      if (order) { order.paymentStatus = 'Комиссия оплачена'; order.paymentMethod = updated.method; order.commissionPaidAt = updated.paidAt; order.status = 'Подтверждён клиентом'; writeOrders(orders); }
      audit(req, null, 'payment.webhook.paid', 'payment', payment.id, { orderId: payment.orderId });
      return json(res, 200, { ok: true, payment: paymentResponse(updated), order });
    } catch { return json(res, 400, { error: 'invalid_webhook' }); }
  }
  if (req.method === 'POST' && req.url.startsWith('/api/orders/') && req.url.endsWith('/pay-commission')) {
    if (!testAuth || process.env.NODE_ENV === 'production') return json(res, 503, { error: 'mock_payment_disabled' });
    const actor = requireRole(req, res, ['client']); if (!actor) return;
    const orderId = req.url.split('/')[3]; const data = await body(req); const orders = readOrders(); const order = orders.find(item => item.id === orderId);
    if (!order || order.clientEmail !== actor.email) return json(res, 403, { error: 'order_owner_required' });
    if (order.status !== 'Машина назначена' || Date.now() > Date.parse(order.paymentDeadline)) return json(res, 409, { error: 'payment_window_expired' });
    const payment = database.findPaymentByOrder(order.id);
    if (!payment || payment.status !== 'pending') return json(res, 409, { error: 'payment_not_pending' });
    if (Date.parse(payment.expiresAt) <= Date.now()) { database.updatePayment(payment.id, { status: 'expired' }); return json(res, 409, { error: 'payment_window_expired' }); }
    const updated = database.updatePayment(payment.id, { status: 'paid', externalId: `mock-${crypto.randomBytes(5).toString('hex')}`, paidAt: new Date().toISOString(), method: data.method === 'qr' ? 'QR-код' : 'Карта' });
    Object.assign(order, { paymentStatus: 'Комиссия оплачена', paymentMethod: updated.method, commissionPaidAt: updated.paidAt, status: 'Подтверждён клиентом' }); writeOrders(orders); audit(req, actor, 'payment.paid', 'payment', payment.id, { orderId: order.id, method: updated.method }); return json(res, 200, { ...order, payment: paymentResponse(updated) });
  }
  if (req.method === 'POST' && req.url.startsWith('/api/orders/') && req.url.endsWith('/start')) {
    const actor = requireRole(req, res, ['driver']); if (!actor) return;
    const orderId = req.url.split('/')[3]; const orders = readOrders(); const order = orders.find(item => item.id === orderId);
    if (!order || order.driverId !== actor.id) return json(res, 403, { error: 'assigned_driver_required' });
    if (order.status !== 'Подтверждён клиентом' || order.paymentStatus !== 'Комиссия оплачена') return json(res, 409, { error: 'order_not_ready_to_start' });
    Object.assign(order, { status: 'В поездке', tripStartedAt: new Date().toISOString() }); writeOrders(orders); audit(req, actor, 'trip.start', 'order', order.id); return json(res, 200, order);
  }
  if (req.method === 'POST' && req.url.startsWith('/api/orders/') && req.url.endsWith('/complete')) {
    const actor = requireRole(req, res, ['driver']); if (!actor) return;
    const orderId = req.url.split('/')[3]; const data = await body(req); const orders = readOrders(); const order = orders.find(item => item.id === orderId);
    if (!order || order.driverId !== actor.id) return json(res, 403, { error: 'assigned_driver_required' });
    if (order.status !== 'В поездке') return json(res, 409, { error: 'order_not_in_trip' });
    Object.assign(order, { status: 'Завершён', tripCompletedAt: new Date().toISOString(), report: String(data.report || 'Поездка завершена без замечаний') });
    try { order.telegramReport = await notifyTripReport(order); } catch { order.telegramReport = { sent: false, reason: 'telegram_delivery_failed' }; }
    try { order.maxReport = await notifyMaxTripReport(order); } catch { order.maxReport = { sent: false, reason: 'max_delivery_failed' }; }
    writeOrders(orders); audit(req, actor, 'trip.complete', 'order', order.id, { report: order.report }); return json(res, 200, order);
  }
  if (req.method === 'POST' && req.url.startsWith('/api/orders/') && req.url.endsWith('/assign')) {
    try {
      const actor = requireRole(req, res, ['dispatcher', 'admin']); if (!actor) return;
      const orderId = req.url.split('/')[3]; const data = await body(req); const orders = readOrders();
      const order = orders.find(item => item.id === orderId);
      if (!order || !data.vehicle || !data.vehiclePlate) return json(res, 400, { error: 'order_or_vehicle_plate_not_found' });
      if (!['Новый', 'Принят водителем'].includes(order.status)) return json(res, 409, { error: 'order_not_assignable' });
      const driverId = String(data.driverId || '').trim(); const vehiclePlate = String(data.vehiclePlate).trim().toUpperCase();
      const vehicle = database.findDriverVehicle(driverId, vehiclePlate);
      if (!vehicle || `${vehicle.make} ${vehicle.model}`.trim().toLowerCase() !== String(data.vehicle).trim().toLowerCase()) return json(res, 422, { error: 'driver_vehicle_plate_mismatch' });
      const amountRub = Number(order.commissionRub || 0);
      if (!Number.isSafeInteger(amountRub) || amountRub <= 0) return json(res, 422, { error: 'commission_amount_unavailable' });
      Object.assign(order, { status: 'Машина назначена', paymentStatus: 'Ожидает оплаты комиссии', paymentMethods: ['Карта', 'QR-код'], paymentDeadline: new Date(Date.now() + 10 * 60_000).toISOString(), vehicle: `${vehicle.make} ${vehicle.model}`, vehiclePlate, driverId: vehicle.id, driverName: vehicle.name, assignedAt: new Date().toISOString() });
      const payment = database.findPaymentByOrder(order.id);
      if (!payment || ['expired', 'cancelled', 'refunded'].includes(payment.status)) {
        const paymentId = `PAY-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
        const expiresAt = order.paymentDeadline;
        database.createPayment({ id: paymentId, orderId: order.id, provider: process.env.PAYMENT_PROVIDER || 'mock', method: null, amountRub, expiresAt, paymentUrl: `/api/payments/${paymentId}/checkout`, qrPayload: `ETT:${paymentId}:${amountRub}` });
      }
      let telegram = { sent: false, reason: 'telegram_not_configured' };
      try { telegram = await notifyAssignment(order); } catch (error) { console.error(error); telegram = { sent: false, reason: 'telegram_delivery_failed' }; }
      let max = { sent: false, reason: 'max_not_configured' };
      try { max = await notifyMaxAssignment(order); } catch (error) { console.error(error); max = { sent: false, reason: 'max_delivery_failed' }; }
      const clientEmail = await notifyAssignmentEmail(order, order.clientEmail, 'client');
      const driverEmail = await notifyAssignmentEmail(order, vehicle.email, 'driver');
      order.telegram = telegram; order.max = max; order.emailNotifications = { client: clientEmail, driver: driverEmail };
      writeOrders(orders); audit(req, actor, 'order.assign', 'order', order.id, { driverId: order.driverId, vehiclePlate: order.vehiclePlate, emailClientSent: clientEmail.sent, emailDriverSent: driverEmail.sent }); return json(res, 200, order);
    } catch { return json(res, 400, { error: 'invalid_request' }); }
  }
  if (req.method === 'POST' && req.url === '/api/test-users/reset') {
    if (!testAuth) return json(res, 404, { error: 'not_found' });
    const actor = currentUser(req); writeUsers(seedUsers); audit(req, actor, 'test.reset', 'users', null); return json(res, 200, readUsers());
  }
  if (req.method === 'POST' && (req.url === '/api/auth/register' || req.url === '/api/auth/client/register')) {
    try {
      const data = await body(req);
      const email = String(data.email || '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'invalid_email' });
      const requestedRole = String(data.role || 'client');
      const staffBootstrap = ['admin', 'dispatcher'].includes(requestedRole) && process.env.STAFF_BOOTSTRAP_TOKEN && data.bootstrapToken === process.env.STAFF_BOOTSTRAP_TOKEN;
      const role = req.url.includes('/client/') ? 'client' : (['client', 'driver'].includes(requestedRole) || staffBootstrap ? requestedRole : 'client');
      if (['admin', 'dispatcher'].includes(requestedRole) && !staffBootstrap) return json(res, 403, { error: 'staff_bootstrap_required' });
      if (data.password != null && String(data.password).length < 8) return json(res, 400, { error: 'weak_password' });
      const existing = database.findUserByEmail(email);
      if (existing && existing.verified_at) return json(res, 409, { error: 'email_already_registered' });
      const localDemo = testAuth && email.endsWith('@example.com');
      if (!localDemo && (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.MAIL_FROM)) return json(res, 503, { error: 'smtp_not_configured' });
      const code = localDemo ? '000000' : String(crypto.randomInt(100000, 1000000));
      const requestId = crypto.randomUUID();
      codes.set(requestId, { email, code, role, name: String(data.name || '').trim(), phone: String(data.phone || '').trim(), car: String(data.car || '').trim(), plate: String(data.plate || '').trim(), passwordHash: hashPassword(String(data.password || (localDemo ? 'demo1234' : crypto.randomBytes(18).toString('base64url')))), expires: Date.now() + 10 * 60_000 });
      if (!localDemo) await transporter.sendMail({ from: process.env.MAIL_FROM, to: email, subject: 'Код подтверждения — Экспресс Трансфер Трэвел', text: `Ваш код подтверждения: ${code}. Код действует 10 минут.` });
      return json(res, 200, { requestId, testMode: localDemo, ...(localDemo ? { testCode: code } : {}) });
    } catch (error) {
      console.error(error);
      return json(res, 502, { error: 'mail_delivery_failed' });
    }
  }
  if (req.method === 'POST' && (req.url === '/api/auth/register/confirm' || req.url === '/api/auth/client/register/confirm')) {
    try {
      const data = await body(req);
      const record = codes.get(String(data.requestId || ''));
      if (!record || record.expires < Date.now() || record.email !== String(data.email || '').trim().toLowerCase() || record.code !== String(data.code || '')) return json(res, 400, { error: 'invalid_or_expired_code' });
      codes.delete(String(data.requestId));
      const existing = database.findUserByEmail(record.email);
      const user = existing
        ? database.setUserCredentials(record.email, { passwordHash: record.passwordHash, verifiedAt: new Date().toISOString(), role: record.role, name: record.name, phone: record.phone })
        : database.createUser({ id: `${record.role === 'driver' ? 'DRV' : 'CLI'}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, role: record.role, email: record.email, name: record.name || record.email.split('@')[0], phone: record.phone, passwordHash: record.passwordHash, verifiedAt: new Date().toISOString(), car: record.car, plate: record.plate });
      const token = crypto.randomBytes(32).toString('base64url'); database.createSession({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId: user.id, expiresAt: new Date(Date.now() + sessionTtlMs).toISOString() }); audit(req, user, 'auth.register.confirm', 'user', user.id);
      return json(res, 200, { verified: true, user: publicUser(user) }, setSession(req, token));
    } catch { return json(res, 400, { error: 'invalid_request' }); }
  }
  if (req.method === 'POST' && req.url === '/api/auth/login') {
    try {
      const data = await body(req); const email = String(data.email || '').trim().toLowerCase(); const password = String(data.password || '');
      const user = database.findUserByEmail(email);
      if (!user || !user.verified_at || !verifyPassword(password, user.password_hash)) return json(res, 401, { error: 'invalid_credentials' });
      if (data.role && data.role !== user.role) return json(res, 403, { error: 'role_mismatch' });
      const token = crypto.randomBytes(32).toString('base64url'); database.createSession({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId: user.id, expiresAt: new Date(Date.now() + sessionTtlMs).toISOString() }); audit(req, user, 'auth.login', 'user', user.id);
      return json(res, 200, { user: publicUser(user) }, setSession(req, token));
    } catch { return json(res, 400, { error: 'invalid_request' }); }
  }
  if (req.method === 'GET' && req.url === '/api/auth/me') return json(res, 200, { user: publicUser(currentUser(req)) });
  if (req.method === 'POST' && req.url === '/api/auth/logout') {
    const actor = currentUser(req); const token = parseCookies(req).ett_session; if (token) database.deleteSession(crypto.createHash('sha256').update(token).digest('hex')); audit(req, actor, 'auth.logout', 'user', actor?.id);
    return json(res, 200, { loggedOut: true }, { 'Set-Cookie': 'ett_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (req.method === 'GET') {
    const file = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = file === '/' ? 'index.html' : file.slice(1);
    const allowed = ['index.html','dispatcher.html','test-admin.html','logo.png','kaliningrad-region-map.png'].includes(relative) || relative.startsWith('assets/') || relative.startsWith('css/');
    const filePath = path.resolve(root, relative);
    if (allowed && filePath.startsWith(root + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' }[path.extname(filePath)] || 'application/octet-stream';
      res.setHeader('Content-Type', mime); fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res); return;
    }
  }
  json(res, 404, { error: 'not_found' });
}

if (process.env.NODE_ENV === 'production' && testAuth) throw new Error('test_auth_forbidden_in_production');
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self' https: data:; script-src 'self' https: 'unsafe-inline'; style-src 'self' https: 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  handleRequest(req, res).catch(() => { if (!res.headersSent) json(res, 400, { error: 'invalid_request' }); else res.destroy(); });
});

server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Express Transfer Travel server: http://localhost:${port}`));
