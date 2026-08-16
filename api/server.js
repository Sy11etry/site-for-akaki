const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb, HOURS, isValidDate, isValidHour } = require('./db');

// No dotenv dependency installed here; load api/.env manually if present.
try {
  const envPath = path.join(__dirname, '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

const PORT = process.env.PORT || 8912;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ALLOWED_ORIGINS = new Set([
  'https://akisirbildze.online',
  'http://akisirbildze.online',
  'https://www.akisirbildze.online',
  'http://www.akisirbildze.online',
]);

const db = openDb();

async function notifyAdmin(text) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text }),
    });
  } catch (err) {
    console.error('Failed to notify admin:', err);
  }
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Public view: only free/busy, never the client's name.
function getPublicSlots(dateStr) {
  const rows = db.prepare('select hour, status from schedule where date = ?').all(dateStr);
  const byHour = new Map(rows.map((r) => [r.hour, r.status]));
  return HOURS.map((hour) => ({
    hour,
    // Slots default to busy: Akaki opens them from the bot.
    free: byHour.get(hour) === 'free',
  }));
}

function book(dateStr, hour, name, contact) {
  const existing = db.prepare('select status, client_name from schedule where date = ? and hour = ?').get(dateStr, hour);
  // A retried request (the client timed out on a request that did land)
  // must not read as a conflict.
  if (existing && existing.status === 'booked' && existing.client_name === name) return true;
  if (!existing || existing.status !== 'free') return false;
  const changed = db
    .prepare("update schedule set status = 'booked', client_name = ?, client_contact = ?, updated_at = ? where date = ? and hour = ? and status = 'free'")
    .run(name, contact || null, new Date().toISOString(), dateStr, hour);
  return changed.changes === 1;
}

const server = http.createServer(async (req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/slots') {
    const date = url.searchParams.get('date');
    if (!isValidDate(date)) return json(res, 400, { error: 'bad date' });
    return json(res, 200, { date, slots: getPublicSlots(date) });
  }

  if (req.method === 'POST' && url.pathname === '/api/book') {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: 'bad json' });
    }

    const { date, hour } = payload;
    const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 50) : '';
    const contact = typeof payload.contact === 'string' ? payload.contact.trim().slice(0, 50) : '';

    if (!isValidDate(date) || !isValidHour(hour) || !name || !contact) {
      return json(res, 400, { error: 'bad request' });
    }

    if (!book(date, hour, name, contact)) {
      return json(res, 409, { error: 'slot taken' });
    }

    console.log(`booked ${date} ${hour}:00 — ${name} (${contact})`);
    notifyAdmin(
      `📅 Новая запись!\n\nИмя: ${name}\nTG/Instagram: ${contact}\nДата: ${date}\nВремя: ${hour}:00`
    );
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`API listening on ${PORT}`));
const http = require('node:http');
const { openDb, HOURS, isValidDate, isValidHour } = require('./db');

const PORT = process.env.PORT || 8912;
const ALLOWED_ORIGINS = new Set([
  'https://akisirbildze.online',
  'http://akisirbildze.online',
  'https://www.akisirbildze.online',
  'http://www.akisirbildze.online',
]);

const db = openDb();

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Public view: only free/busy, never the client's name.
function getPublicSlots(dateStr) {
  const rows = db.prepare('select hour, status from schedule where date = ?').all(dateStr);
  const byHour = new Map(rows.map((r) => [r.hour, r.status]));
  return HOURS.map((hour) => ({
    hour,
    // Slots default to busy: Akaki opens them from the bot.
    free: byHour.get(hour) === 'free',
  }));
}

function book(dateStr, hour, name) {
  const existing = db.prepare('select status, client_name from schedule where date = ? and hour = ?').get(dateStr, hour);
  // A retried request (the client timed out on a request that did land)
  // must not read as a conflict.
  if (existing && existing.status === 'booked' && existing.client_name === name) return true;
  if (!existing || existing.status !== 'free') return false;
  const changed = db
    .prepare("update schedule set status = 'booked', client_name = ?, updated_at = ? where date = ? and hour = ? and status = 'free'")
    .run(name, new Date().toISOString(), dateStr, hour);
  return changed.changes === 1;
}

const server = http.createServer(async (req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/slots') {
    const date = url.searchParams.get('date');
    if (!isValidDate(date)) return json(res, 400, { error: 'bad date' });
    return json(res, 200, { date, slots: getPublicSlots(date) });
  }

  if (req.method === 'POST' && url.pathname === '/api/book') {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: 'bad json' });
    }

    const { date, hour } = payload;
    const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 50) : '';

    if (!isValidDate(date) || !isValidHour(hour) || !name) {
      return json(res, 400, { error: 'bad request' });
    }

    if (!book(date, hour, name)) {
      return json(res, 409, { error: 'slot taken' });
    }

    console.log(`booked ${date} ${hour}:00 — ${name}`);
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`API listening on ${PORT}`));
