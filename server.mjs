import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const testAuth = String(process.env.TEST_AUTH_MODE || 'false') === 'true';
const codes = new Map();
const dataDir = path.join(root, 'data');
const usersFile = path.join(dataDir, 'test-users.json');
const ordersFile = path.join(dataDir, 'orders.json');
const platformDbFile = path.join(dataDir, 'platform-db.json');
const fixedDirectionsFile = path.join(dataDir, 'fixed-directions.json');
const carClassificationFile = path.join(dataDir, 'car-classification.json');
const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
const osrmUrl = (process.env.OSRM_URL || 'http://localhost:5000').replace(/\/$/, '');
const distanceRateRub = 75;
const platformCommissionRate = 0.2;
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
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify(seedUsers, null, 2), 'utf8');
if (!fs.existsSync(ordersFile)) fs.writeFileSync(ordersFile, '[]', 'utf8');
if (!fs.existsSync(platformDbFile)) fs.writeFileSync(platformDbFile, JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString().slice(0, 10), drivers: [], clients: [], districts: [{ id: 'central', name: 'Центральный район', tripPriceRub: null }, { id: 'moscow', name: 'Московский район', tripPriceRub: null }, { id: 'leningrad', name: 'Ленинградский район', tripPriceRub: null }, { id: 'october', name: 'Октябрьский район', tripPriceRub: null }], streets: [], orders: [] }, null, 2), 'utf8');
function readUsers() { return JSON.parse(fs.readFileSync(usersFile, 'utf8')); }
function writeUsers(data) { fs.writeFileSync(usersFile, JSON.stringify(data, null, 2), 'utf8'); }
function readOrders() {
  const orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
  let changed = false;
  for (const order of orders) {
    if (order.status === 'Машина назначена' && order.paymentStatus === 'Ожидает оплаты комиссии' && order.paymentDeadline && Date.now() > Date.parse(order.paymentDeadline)) {
      order.status = 'Аннулирован: комиссия не оплачена';
      order.cancelledAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) writeOrders(orders);
  return orders;
}
function writeOrders(data) { fs.writeFileSync(ordersFile, JSON.stringify(data, null, 2), 'utf8'); }
function readPlatformDb() { return JSON.parse(fs.readFileSync(platformDbFile, 'utf8')); }
function writePlatformDb(data) { fs.writeFileSync(platformDbFile, JSON.stringify(data, null, 2), 'utf8'); }
function readFixedDirections() { return JSON.parse(fs.readFileSync(fixedDirectionsFile, 'utf8')); }
function readCarClassification() { return JSON.parse(fs.readFileSync(carClassificationFile, 'utf8')); }
function classifyCar(make, model) {
  const text = `${make || ''} ${model || ''}`.toLowerCase();
  return readCarClassification().find(item => item.models.toLowerCase().split(', ').some(brand => text.includes(brand.toLowerCase())))?.category || null;
}

async function notifyTelegram(order) {
  if (!telegramToken || !telegramChatId) return { sent: false, reason: 'telegram_not_configured' };
  const text = [
    '🚘 Вам назначен автомобиль:',
    `Заказ: ${order.id}`,
    `Маршрут: ${order.from} → ${order.to}`,
    `Дата и время: ${order.date || 'не указано'} ${order.time || ''}`,
    `Клиент: ${order.clientName || order.clientEmail || 'не указан'}`,
    `Автомобиль: ${order.vehicle}`,
    `Гос. номер: ${order.vehiclePlate}`,
    `Водитель: ${order.driverName || order.driverId || 'не указан'}`
  ].join('\n');
  const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: telegramChatId, text })
  });
  if (!response.ok) throw new Error(`telegram_http_${response.status}`);
  const payload = await response.json();
  if (!payload.ok) throw new Error('telegram_api_error');
  return { sent: true };
}

async function notifyTripReport(order) {
  if (!telegramToken || !telegramChatId) return { sent: false, reason: 'telegram_not_configured' };
  const text = ['✅ Поездка завершена', `Заказ: ${order.id}`, `Маршрут: ${order.from} → ${order.to}`, `Клиент: ${order.clientName || order.clientEmail}`, `Автомобиль: ${order.vehicle}`, `Гос. номер: ${order.vehiclePlate}`, `Водитель: ${order.driverName || order.driverId}`, `Начало: ${order.tripStartedAt}`, `Завершение: ${order.tripCompletedAt}`, `Отчёт: ${order.report || 'без комментария'}`].join('\n');
  const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: telegramChatId, text }) });
  if (!response.ok || !(await response.json()).ok) throw new Error('telegram_report_failed');
  return { sent: true };
}

async function calculateOsrmRoute(from, to) {
  const fixed = readFixedDirections();
  const fixedKey = `${String(from).trim().toLowerCase()}→${String(to).trim().toLowerCase()}`;
  const fixedPrice = fixed.prices?.[fixedKey];
  if (fixedPrice) return { available: true, provider: 'fixed-table', pricing: 'fixed', from, to, basePriceRub: fixedPrice.standard, commissionRub: Math.round(fixedPrice.standard * platformCommissionRate), clientTotalRub: fixedPrice.standard + Math.round(fixedPrice.standard * platformCommissionRate), prices: fixedPrice, pricingRule: 'fixed price from Excel + 20% platform commission' };
  if (fixed.directions.includes(to)) return { available: false, reason: 'fixed_price_not_set', pricing: 'fixed', from, to };
  const a = knownPlaces[from]; const b = knownPlaces[to];
  if (!a || !b) return { available: false, reason: 'place_not_in_directory', from, to };
  return calculateOsrmCoordinates(a, b, from, to);
}

async function calculateOsrmCoordinates(a, b, from, to) {
  const url = `${osrmUrl}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=false&steps=false`;
  const response = await fetch(url); if (!response.ok) throw new Error(`osrm_${response.status}`);
  const data = await response.json(); const route = data.routes?.[0];
  if (!route) throw new Error('osrm_route_not_found');
  const distanceKm = Math.round(route.distance / 100) / 10;
  const basePriceRub = Math.round(distanceKm * distanceRateRub);
  const commissionRub = Math.round(basePriceRub * platformCommissionRate);
  return { available: true, provider: 'osrm', distanceKm, durationMin: Math.round(route.duration / 60), basePriceRub, commissionRub, clientTotalRub: basePriceRub + commissionRub, pricingRule: 'distance_km * 75 RUB + 20% platform commission', from, to };
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let value = '';
    req.on('data', chunk => { value += chunk; if (value.length > 32_000) reject(new Error('payload too large')); });
    req.on('end', () => { try { resolve(JSON.parse(value || '{}')); } catch { reject(new Error('invalid json')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && req.url === '/api/test-users') return json(res, 200, readUsers());
  if (req.method === 'GET' && req.url === '/api/orders') return json(res, 200, readOrders());
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
      const data = await body(req);
      if (!data.from || !data.to || !data.clientEmail) return json(res, 400, { error: 'missing_order_fields' });
      let route = null;
      try {
        route = data.fromLat != null && data.fromLon != null && data.toLat != null && data.toLon != null
          ? await calculateOsrmCoordinates([Number(data.fromLat), Number(data.fromLon)], [Number(data.toLat), Number(data.toLon)], data.from, data.to)
          : await calculateOsrmRoute(data.from, data.to);
      } catch { route = null; }
      const order = { id: `ORD-${Date.now().toString(36).toUpperCase()}`, status: 'Новый', paymentStatus: 'Ожидает оплаты комиссии', commissionRate: platformCommissionRate, paymentDeadlineMinutes: 10, createdAt: new Date().toISOString(), ...(route?.available ? { routeDistanceKm: route.distanceKm, routeDurationMin: route.durationMin, basePriceRub: route.basePriceRub, commissionRub: route.commissionRub, clientTotalRub: route.clientTotalRub, pricingRule: route.pricingRule } : {}), ...data };
      const orders = readOrders(); orders.push(order); writeOrders(orders);
      return json(res, 201, order);
    } catch { return json(res, 400, { error: 'invalid_request' }); }
  }
  if (req.method === 'POST' && req.url.startsWith('/api/orders/') && req.url.endsWith('/accept')) {
    const orderId = req.url.split('/')[3]; const data = await body(req); const orders = readOrders(); const order = orders.find(item => item.id === orderId);
    if (!order || order.status !== 'Новый') return json(res, 409, { error: 'order_not_available' });
    Object.assign(order, { status: 'Принят водителем', acceptedAt: new Date().toISOString(), driverId: data.driverId || '', driverName: data.driverName || '' }); writeOrders(orders); return json(res, 200, order);
  }
  if (req.method === 'POST' && req.url.startsWith('/api/orders/') && req.url.endsWith('/pay-commission')) {
    const orderId = req.url.split('/')[3]; const data = await body(req); const orders = readOrders(); const order = orders.find(item => item.id === orderId);
    if (!order || order.status !== 'Машина назначена' || Date.now() > Date.parse(order.paymentDeadline)) return json(res, 409, { error: 'payment_window_expired' });
    Object.assign(order, { paymentStatus: 'Комиссия оплачена', paymentMethod: data.method === 'qr' ? 'QR-код' : 'Карта', commissionPaidAt: new Date().toISOString(), status: 'Подтверждён клиентом' }); writeOrders(orders); return json(res, 200, order);
  }
  if (req.method === 'POST' && req.url.startsWith('/api/orders/') && req.url.endsWith('/start')) {
    const orderId = req.url.split('/')[3]; const orders = readOrders(); const order = orders.find(item => item.id === orderId);
    if (!order || order.status !== 'Подтверждён клиентом' || order.paymentStatus !== 'Комиссия оплачена') return json(res, 409, { error: 'order_not_ready_to_start' });
    Object.assign(order, { status: 'В поездке', tripStartedAt: new Date().toISOString() }); writeOrders(orders); return json(res, 200, order);
  }
  if (req.method === 'POST' && req.url.startsWith('/api/orders/') && req.url.endsWith('/complete')) {
    const orderId = req.url.split('/')[3]; const data = await body(req); const orders = readOrders(); const order = orders.find(item => item.id === orderId);
    if (!order || order.status !== 'В поездке') return json(res, 409, { error: 'order_not_in_trip' });
    Object.assign(order, { status: 'Завершён', tripCompletedAt: new Date().toISOString(), report: String(data.report || 'Поездка завершена без замечаний') });
    try { order.telegramReport = await notifyTripReport(order); } catch { order.telegramReport = { sent: false, reason: 'telegram_delivery_failed' }; }
    writeOrders(orders); return json(res, 200, order);
  }
  if (req.method === 'POST' && req.url.startsWith('/api/orders/') && req.url.endsWith('/assign')) {
    try {
      const orderId = req.url.split('/')[3]; const data = await body(req); const orders = readOrders();
      const order = orders.find(item => item.id === orderId);
      if (!order || !data.vehicle || !data.vehiclePlate) return json(res, 400, { error: 'order_or_vehicle_plate_not_found' });
      Object.assign(order, { status: 'Машина назначена', paymentStatus: 'Ожидает оплаты комиссии', paymentMethods: ['Карта', 'QR-код'], paymentDeadline: new Date(Date.now() + 10 * 60_000).toISOString(), vehicle: String(data.vehicle), vehiclePlate: String(data.vehiclePlate).trim().toUpperCase(), driverId: data.driverId || '', driverName: data.driverName || '', assignedAt: new Date().toISOString() });
      let telegram = { sent: false, reason: 'telegram_not_configured' };
      try { telegram = await notifyTelegram(order); } catch (error) { console.error(error); telegram = { sent: false, reason: 'telegram_delivery_failed' }; }
      order.telegram = telegram; writeOrders(orders); return json(res, 200, order);
    } catch { return json(res, 400, { error: 'invalid_request' }); }
  }
  if (req.method === 'POST' && req.url === '/api/test-users/reset') { writeUsers(seedUsers); return json(res, 200, readUsers()); }
  if (req.method === 'POST' && (req.url === '/api/auth/register' || req.url === '/api/auth/client/register')) {
    try {
      const data = await body(req);
      const email = String(data.email || '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'invalid_email' });
      const localDemo = testAuth && email.endsWith('@example.com');
      if (!localDemo && (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.MAIL_FROM)) return json(res, 503, { error: 'smtp_not_configured' });
      const code = localDemo ? '000000' : String(crypto.randomInt(100000, 1000000));
      const requestId = crypto.randomUUID();
      codes.set(requestId, { email, code, expires: Date.now() + 10 * 60_000 });
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
      return json(res, 200, { verified: true });
    } catch { return json(res, 400, { error: 'invalid_request' }); }
  }
  if (req.method === 'GET') {
    const file = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(root, file);
    if (filePath.startsWith(root) && fs.existsSync(filePath)) return fs.createReadStream(filePath).pipe(res);
  }
  json(res, 404, { error: 'not_found' });
});

server.listen(port, () => console.log(`Express Transfer Travel server: http://localhost:${port}`));
