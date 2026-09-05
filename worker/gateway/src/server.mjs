import express from 'express';
import helmet from 'helmet';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';

const PORT = Number(process.env.PORT || 8788);
const API_KEY = process.env.API_KEY;
const CLICK_HASH_SALT = process.env.CLICK_HASH_SALT;

if (!API_KEY || !CLICK_HASH_SALT) {
  console.error('gateway: відсутні обовʼязкові env (API_KEY, CLICK_HASH_SALT)');
  process.exit(1);
}

const DATA_DIR = process.env.GW_DATA_DIR || '/home/node/data';
mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(`${DATA_DIR}/clicks.db`);
db.pragma('journal_mode = WAL');
db.exec(`
  create table if not exists clicks (
    click_id text primary key,
    target text not null,
    channel_kind text not null,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    gclid text,
    ip_hash text,
    ua_hash text,
    created_at integer not null
  )
`);

// ---------- безпека ----------
const ALLOWED_HOSTS = new Set(['t.me', 'telegram.me', 'wa.me', 'api.whatsapp.com', 'chat.whatsapp.com', 'www.viber.com']);
const ALLOWED_SCHEMES = new Set(['https:', 'viber:']);

/** Тільки дозволені месенджер-цілі; усе інше відхиляється (анти open-redirect) */
function isSafeTarget(raw) {
  try {
    const u = new URL(raw);
    if (!ALLOWED_SCHEMES.has(u.protocol)) return false;
    if (u.protocol === 'https:' && !ALLOWED_HOSTS.has(u.hostname)) return false;
    // viber:// —— перевіряємо префікс path на play/forward (публічні маршрути PA)
    if (u.protocol === 'viber:' && !/^\/(chat|forward|pa)/.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

const CLICK_ID_RE = /^[0-9A-HJ-NP-Z]{8}$/; // Crockford base32, без I/L/O/U

function sha256Hex(value) {
  return createHash('sha256').update(`${CLICK_HASH_SALT}:${value}`).digest('hex');
}

function timingSafeEq(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function requireBearer(req, res, next) {
  const auth = req.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(API_KEY);
  if (a.length !== b.length || !timingSafeEq(a, b)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

const buckets = new Map();
function rateLimit(maxPerMin) {
  return (req, res, next) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const bucket = buckets.get(key) ?? { count: 0, resetAt: now + 60000 };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + 60000;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > maxPerMin) return res.status(429).json({ error: 'rate limited' });
    next();
  };
}

// ---------- застосунок ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // один довірений хоп — Caddy
app.use(helmet());
app.use(express.json({ limit: '16kb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

/** Створення кліку: викликається лендингом/адмініструванням (Bearer) */
app.post('/clicks', requireBearer, rateLimit(60), (req, res) => {
  const b = req.body ?? {};
  const clickId = typeof b.clickId === 'string' ? b.clickId.toUpperCase() : randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
  if (!CLICK_ID_RE.test(clickId)) {
    return res.status(400).json({ error: 'clickId: 8 символів Crockford base32' });
  }
  if (typeof b.target !== 'string' || !isSafeTarget(b.target)) {
    return res.status(400).json({ error: 'target не в дозволеному списку месенджер-цілей' });
  }
  const str = (v) => (typeof v === 'string' && v.length <= 200 ? v : undefined);
  try {
    // better-sqlite3 кидає помилку на undefined-bind → нормалізуємо в null
    db.prepare(
      `insert or replace into clicks
        (click_id, target, channel_kind, utm_source, utm_medium, utm_campaign, gclid, ip_hash, ua_hash, created_at)
       values (?, ?, ?, ?, ?, ?, ?, '', '', ?)`,
    ).run(
      clickId,
      b.target,
      str(b.channelKind) ?? 'wa',
      str(b.utmSource) ?? null,
      str(b.utmMedium) ?? null,
      str(b.utmCampaign) ?? null,
      str(b.gclid) ?? null,
      Date.now(),
    );
  } catch {
    return res.status(500).json({ error: 'insert failed' });
  }
  return res.status(201).json({ clickId, url: `/c/${clickId}` });
});

/** Публічний редирект: /c/:click_id → збережена ціль */
app.get('/c/:clickId', rateLimit(120), (req, res) => {
  const clickId = String(req.params.clickId ?? '').toUpperCase();
  if (!CLICK_ID_RE.test(clickId)) {
    return res.status(400).send('bad link');
  }
  const row = db.prepare('select target, ip_hash, ua_hash from clicks where click_id = ?').get(clickId);
  if (!row) {
    return res.status(404).send('link not found');
  }
  if (!isSafeTarget(row.target)) {
    // Ціль у БД могла потрапити туди до увімкнення allowlist — не редиректимо
    return res.status(400).send('unsafe target');
  }
  // Приватність: зберігаємо лише хеші IP/UA, не сирі значення
  const ip = req.ip ?? '';
  const ua = String(req.get('user-agent') ?? '');
  db.prepare('update clicks set ip_hash = ?, ua_hash = ? where click_id = ?')
    .run(sha256Hex(ip), sha256Hex(ua), clickId);
  // no-referrer: реферер не «протікає» у месенджер
  res.set('Referrer-Policy', 'no-referrer');
  return res.redirect(302, row.target);
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  console.error('gateway unhandled:', err?.message ?? 'unknown');
  res.status(500).json({ error: 'internal' });
});

const server = app.listen(PORT, () => console.log(`gateway on :${PORT}`));
server.headersTimeout = 15000;
server.requestTimeout = 30000;
