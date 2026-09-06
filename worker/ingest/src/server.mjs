/**
 * Ingest-сервіс воркера LocalChats (порт 8082).
 * Приймає вебхуки Evolution API (messages.upsert) і пише повідомлення
 * в спільні таблиці Supabase (channels/conversations/messages).
 * Секрет: заголовок x-webhook-secret (або Bearer) = env MESSENGER_WEBHOOK_SECRET.
 * Помилки 5xx → Evolution зробить retry; дедуп на боці БД (UNIQUE external_id).
 */
import http from 'node:http';
import { mapUpsertPayload } from './evolution.mjs';
import { runBackfill } from './backfill.mjs';

const MAX_BODY = 5 * 1024 * 1024;

function sendJson(res, status, json) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(json));
}

function authorized(req, secret) {
  const header = req.headers['x-webhook-secret'];
  if (typeof header === 'string' && header === secret) return true;
  const auth = req.headers.authorization;
  return typeof auth === 'string' && auth === `Bearer ${secret}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * deps: { secret, supabase: { upsertIncoming }, logger?, backfill?: { run } }
 * backfill передається окремо, бо потребує pg (є тільки в контейнері Evolution).
 */
export function createHandler(deps) {
  const { secret, supabase, logger = () => {}, backfill } = deps;

  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://internal');

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true, service: 'ingest' });
    }

    if (!authorized(req, secret)) {
      logger(`ingest: unauthorized ${url.pathname}`);
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    if (req.method === 'POST' && url.pathname === '/ingest/evolution') {
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: 'invalid json' });
      }
      const events = mapUpsertPayload(payload);
      if (!events.length) {
        return sendJson(res, 200, { ok: true, skipped: true });
      }
      try {
        let ingested = 0;
        for (const m of events) {
          const conversationId = await supabase.upsertIncoming(m);
          if (conversationId) ingested += 1;
          else logger(`ingest: канал не знайдено для ${m.instance} — повідомлення пропущено`);
        }
        return sendJson(res, 200, { ok: true, ingested, received: events.length });
      } catch (e) {
        logger(`ingest: supabase error: ${e.message}`);
        return sendJson(res, 500, { error: 'supabase unavailable' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/ingest/backfill') {
      if (!backfill) return sendJson(res, 503, { error: 'backfill недоступний (pg не налаштований)' });
      let body = {};
      try {
        body = JSON.parse(await readBody(req));
      } catch { /* пустий body — бекфіл для всіх відкритих інстансів */ }
      try {
        const result = await backfill.run({ instances: body.instances });
        return sendJson(res, 200, result);
      } catch (e) {
        logger(`backfill: error: ${e.message}`);
        return sendJson(res, 500, { error: 'backfill failed', detail: e.message.slice(0, 200) });
      }
    }

    return sendJson(res, 404, { error: 'not found' });
  };
}

export function start(deps, port) {
  const logger = deps.logger ?? ((...a) => console.log('[ingest]', ...a));
  const server = http.createServer(createHandler({ ...deps, logger }));
  server.listen(port, () => logger(`on :${port}`));
  return server;
}

// Точка входу при прямому запуску (у тестах імпортується createHandler)
if (process.argv[1] && process.argv[1].endsWith('server.mjs') && !process.env.VITEST) {
  const secret = process.env.MESSENGER_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!secret || !supabaseUrl || !supabaseKey) {
    // Не падаємо: контейнер підніметься, вебхуки відповідатимуть 503,
    // доки секрети не налаштовані (Evolution зробить retry пізніше)
    logger('env неповний: MESSENGER_WEBHOOK_SECRET / SUPABASE_URL / SUPABASE_SECRET_KEY — ingest відключений');
  }
  const { createSupabase } = await import('./supabase.mjs');
  const supabase = supabaseUrl && supabaseKey
    ? createSupabase({ url: supabaseUrl, key: supabaseKey })
    : {
        upsertIncoming: async () => {
          throw new Error('ingest не налаштований: відсутні SUPABASE_URL / SUPABASE_SECRET_KEY');
        },
      };

  // pg живе в node_modules Evolution (/evolution) — у північних тестах його нема
  let backfill;
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire('/evolution/package.json');
    const { Client } = require('pg');
    backfill = {
      run: ({ instances }) => runBackfill({
        supabase,
        instances,
        logger,
        pgClientFactory: async () => {
          const c = new Client({ connectionString: process.env.DATABASE_CONNECTION_URI });
          await c.connect();
          return c;
        },
      }),
    };
  } catch (e) {
    logger(`backfill недоступний: ${e.message}`);
  }

  start({ secret: secret ?? '', supabase, backfill, logger }, Number(process.env.PORT || 8082));
}
