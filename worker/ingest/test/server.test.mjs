// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createServer } from 'node:http';
import { createHandler } from '../src/server.mjs';

const SECRET = 'test-webhook-secret';
const SUPABASE_URL = 'https://supabase.example/p/testref';

/**
 * Фейковий Supabase-клієнт: рахує виклики upsertIncoming, помилки керується тестом.
 */
function makeSupabase({ fail = false, conversationId = 'cv-uuid-1' } = {}) {
  const calls = [];
  return {
    calls,
    async upsertIncoming(m) {
      calls.push(m);
      if (fail) throw new Error('supabase 500');
      return conversationId;
    },
  };
}

function makeDeps(supabase) {
  return { secret: SECRET, supabase, logger: () => {} };
}

const WA_OK = '110600407498928@s.whatsapp.net';
const validBody = {
  event: 'messages.upsert',
  instance: 'lc_wa_mtovgqj5',
  data: {
    key: { remoteJid: WA_OK, fromMe: false, id: '3EB0TEST1' },
    message: { conversation: 'Привіт' },
    messageTimestamp: 1709550600,
    pushName: 'Оксана',
  },
};

describe('ingest server', () => {
  let server;
  let base;

  beforeAll(async () => {
    server = createServer(createHandler(makeDeps(makeSupabase())));
    await new Promise((r) => server.listen(0, r));
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  async function post(path, body, headers = {}) {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  test('GET /healthz → 200', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect((await res.json()).service).toBe('ingest');
  });

  test('без секрета / з неправильним секретом → 401 і без викликів Supabase', async () => {
    const sb = makeSupabase();
    const srv = createServer(createHandler(makeDeps(sb)));
    await new Promise((r) => srv.listen(0, r));
    const b = `http://127.0.0.1:${srv.address().port}`;
    const noSecret = await post('/ingest/evolution', validBody, {});
    const badSecret = await post('/ingest/evolution', validBody, { 'x-webhook-secret': 'wrong' });
    await new Promise((r) => srv.close(r));
    expect(noSecret.status).toBe(401);
    expect(badSecret.status).toBe(401);
    expect(sb.calls).toHaveLength(0);
  });

  test('валідний messages.upsert → 200, upsertIncoming викликаний з нормалізованим повідомленням', async () => {
    const sb = makeSupabase();
    const srv = createServer(createHandler(makeDeps(sb)));
    await new Promise((r) => srv.listen(0, r));
    const b = `http://127.0.0.1:${srv.address().port}`;
    const res = await fetch(`${b}/ingest/evolution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: JSON.stringify(validBody),
    });
    const json = await res.json();
    await new Promise((r) => srv.close(r));
    expect(res.status).toBe(200);
    expect(json.ingested).toBe(1);
    expect(sb.calls[0]).toMatchObject({
      instance: 'lc_wa_mtovgqj5',
      chat: WA_OK,
      externalId: 'wa:lc_wa_mtovgqj5:3EB0TEST1',
      direction: 'in',
      body: 'Привіт',
      pushName: 'Оксана',
    });
  });

  test('інші події → 200 skipped, без викликів', async () => {
    const sb = makeSupabase();
    const srv = createServer(createHandler(makeDeps(sb)));
    await new Promise((r) => srv.listen(0, r));
    const b = `http://127.0.0.1:${srv.address().port}`;
    const res = await post('/ingest/evolution', { event: 'messages.update', instance: 'x', data: {} }, { 'x-webhook-secret': SECRET });
    const json = await res.json();
    await new Promise((r) => srv.close(r));
    expect(res.status).toBe(200);
    expect(json.skipped).toBe(true);
    expect(sb.calls).toHaveLength(0);
  });

  test('битий JSON → 400', async () => {
    const res = await post('/ingest/evolution', '{not json', { 'x-webhook-secret': SECRET });
    expect(res.status).toBe(400);
  });

  test('помилка Supabase → 500 (Evolution зробить retry)', async () => {
    const sb = makeSupabase({ fail: true });
    const srv = createServer(createHandler(makeDeps(sb)));
    await new Promise((r) => srv.listen(0, r));
    const b = `http://127.0.0.1:${srv.address().port}`;
    const res = await fetch(`${b}/ingest/evolution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: JSON.stringify(validBody),
    });
    await new Promise((r) => srv.close(r));
    expect(res.status).toBe(500);
  });
});
