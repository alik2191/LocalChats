import express from 'express';
import helmet from 'helmet';
import { Buffer } from 'node:buffer';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { loadSessionString, saveSessionString } from './store.mjs';

const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.API_KEY;
const TG_API_ID = Number(process.env.TG_API_ID || 0);
const TG_API_HASH = process.env.TG_API_HASH || '';

if (!API_KEY || !TG_API_ID || !TG_API_HASH) {
  console.error('tg-worker: відсутні обовʼязкові env (API_KEY, TG_API_ID, TG_API_HASH)');
  process.exit(1);
}

// ---------- авторизація ----------
function requireBearer(req, res, next) {
  const auth = req.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // timingSafeEqual: захист від timing-атак на порівнянні ключа
  const a = Buffer.from(token);
  const b = Buffer.from(API_KEY);
  if (a.length !== b.length || !timingSafeEq(a, b)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function timingSafeEq(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- простий rate limiter (один інстанс) ----------
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
    if (bucket.count > maxPerMin) {
      return res.status(429).json({ error: 'rate limited' });
    }
    next();
  };
}

// ---------- gramjs ----------
const state = {
  client: null,
  qrToken: null, // Buffer останнього ExportLoginToken
  qrAt: 0,
};

async function getClient() {
  if (state.client) return state.client;
  const session = new StringSession(loadSessionString());
  state.client = new TelegramClient(session, TG_API_ID, TG_API_HASH, {
    connectionRetries: 5,
    useWSS: true,
  });
  await state.client.connect();
  return state.client;
}

async function isAuthorized(client) {
  try {
    await client.getMe();
    return true;
  } catch {
    return false;
  }
}

/** MTProto QR-логін: ExportLoginToken → tg://login?token=... */
async function exportLoginToken(client) {
  const result = await client.invoke(
    new Api.auth.ExportLoginToken({
      apiId: TG_API_ID,
      apiHash: TG_API_HASH,
      exceptIds: [],
    }),
  );
  if (result instanceof Api.auth.LoginTokenSuccess) return { success: true };
  if (result instanceof Api.auth.LoginTokenMigrateTo) {
    // потрібно мігрувати на інший DC — виконуємо ImportLoginToken там
    await client._switchDC(result.dcId);
    await client.invoke(
      new Api.auth.ImportLoginToken({ token: result.token }),
    );
    return { success: true };
  }
  if (result instanceof Api.auth.LoginToken) {
    state.qrToken = Buffer.from(result.token);
    state.qrAt = Date.now();
    return { token: state.qrToken };
  }
  return {};
}

function qrUrl(token) {
  // base64url без паддінгу — саме цей рядок рендерить QR
  return 'tg://login?token=' + token.toString('base64url');
}

// ---------- застосунок ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // за Caddy — один довірений proxy-хоп
app.use(helmet());
app.use(express.json({ limit: '64kb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// GET за контрактом клієнта (src/lib/worker.ts); CSRF не застосовний —
// автентифікація через заголовок Authorization, не cookies
app.get('/tg/qr', requireBearer, rateLimit(10), async (req, res) => {
  try {
    const client = await getClient();
    if (await isAuthorized(client)) {
      return res.json({ authorized: true });
    }
    const r = await exportLoginToken(client);
    if (r.success) return res.json({ authorized: true });
    if (!r.token) return res.status(502).json({ error: 'QR token not returned' });
    return res.json({
      qr_base64: qrUrl(r.token),
      expires_in: 30,
    });
  } catch (e) {
    console.error('tg/qr error:', e?.errorMessage ?? e?.message ?? 'unknown');
    return res.status(500).json({ error: 'qr failed' });
  }
});

app.get('/tg/status', requireBearer, rateLimit(60), async (req, res) => {
  try {
    const client = await getClient();
    if (await isAuthorized(client)) {
      const me = await client.getMe();
      const phone = me?.phone ? `+${me.phone}` : undefined;
      if (client.session.save()) saveSessionString(client.session.save());
      return res.json({ authorized: true, phone });
    }
    if (!state.qrToken) return res.json({ authorized: false });
    const r = await exportLoginToken(client);
    if (r.success) {
      const me = await client.getMe();
      saveSessionString(client.session.save());
      return res.json({ authorized: true, phone: me?.phone ? `+${me.phone}` : undefined });
    }
    // SESSION_PASSWORD_NEEDED тощо припомпиться як помилка викиду — оброблено вище
    return res.json({ authorized: false });
  } catch (e) {
    const msg = String(e?.errorMessage ?? '');
    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
      // Увімкнена 2FA: QR-логін потребує підтвердження паролем — не підтримується тут
      return res.status(400).json({ error: '2fa password required' });
    }
    console.error('tg/status error:', e?.errorMessage ?? e?.message ?? 'unknown');
    return res.status(500).json({ error: 'status failed' });
  }
});

app.post('/tg/send', requireBearer, rateLimit(30), async (req, res) => {
  try {
    const { chat, text } = req.body ?? {};
    if (typeof chat !== 'string' || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'chat і text обовʼязкові' });
    }
    if (text.length > 4096) {
      return res.status(400).json({ error: 'текст понад ліміт Telegram (4096)' });
    }
    // Нормалізація: @handle або цифри (+38… → 38…); все інше відхилено
    const trimmed = chat.trim();
    const peer = trimmed.startsWith('@')
      ? trimmed
      : trimmed.replace(/[^+\d]/g, '').replace(/^\+/, '');
    if (!peer.startsWith('@') && !/^\d{5,15}$/.test(peer)) {
      return res.status(400).json({ error: 'очікується @handle або числовий ID' });
    }
    const client = await getClient();
    if (!(await isAuthorized(client))) {
      return res.status(409).json({ error: 'сесія не авторизована' });
    }
    const entity = await client.getEntity(peer);
    await client.sendMessage(entity, { message: text });
    return res.json({ ok: true });
  } catch (e) {
    console.error('tg/send error:', e?.errorMessage ?? e?.message ?? 'unknown');
    return res.status(502).json({ error: 'send failed' });
  }
});

// 404 і централізований обробник помилок — без стек-трейсів назовні
app.use((req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  console.error('unhandled:', err?.message ?? 'unknown');
  res.status(500).json({ error: 'internal' });
});

const server = app.listen(PORT, () => console.log(`tg-worker on :${PORT}`));
server.headersTimeout = 15000;
server.requestTimeout = 30000;
