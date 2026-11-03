import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const codes = new Map();

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
  if (req.method === 'POST' && (req.url === '/api/auth/register' || req.url === '/api/auth/client/register')) {
    try {
      const data = await body(req);
      const email = String(data.email || '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'invalid_email' });
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.MAIL_FROM) return json(res, 503, { error: 'smtp_not_configured' });
      const code = String(crypto.randomInt(100000, 1000000));
      const requestId = crypto.randomUUID();
      codes.set(requestId, { email, code, expires: Date.now() + 10 * 60_000 });
      await transporter.sendMail({ from: process.env.MAIL_FROM, to: email, subject: 'Код подтверждения — Экспресс Трансфер Трэвел', text: `Ваш код подтверждения: ${code}. Код действует 10 минут.` });
      return json(res, 200, { requestId });
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
