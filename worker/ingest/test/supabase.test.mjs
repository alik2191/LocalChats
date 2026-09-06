// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { createSupabase } from '../src/supabase.mjs';

const URL_BASE = 'https://supabase.example/p/testref';
const KEY = 'service-role-key';

function fetchMock(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return { calls, impl };
}

const incoming = {
  instance: 'lc_wa_mtovgqj5',
  chat: '110600407498928@s.whatsapp.net',
  externalId: 'wa:lc_wa_mtovgqj5:3EB0TEST1',
  direction: 'in',
  body: 'Привіт',
  tsMs: 1709550600000,
  pushName: 'Оксана',
};

describe('supabase REST client (ingest)', () => {
  test('upsertIncoming → POST /rest/v1/rpc/upsert_incoming_message з apikey і Bearer', async () => {
    const { calls, impl } = fetchMock(() => new Response(JSON.stringify('cv-uuid-1'), { status: 200 }));
    const sb = createSupabase({ url: URL_BASE, key: KEY, fetchImpl: impl });
    const id = await sb.upsertIncoming(incoming);
    expect(id).toBe('cv-uuid-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/rpc/upsert_incoming_message`);
    expect(calls[0].init.headers.apikey).toBe(KEY);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(calls[0].init.body);
    expect(body).toEqual({
      p_instance: 'lc_wa_mtovgqj5',
      p_external_chat_id: '110600407498928@s.whatsapp.net',
      p_contact_name: 'Оксана',
      p_external_id: 'wa:lc_wa_mtovgqj5:3EB0TEST1',
      p_direction: 'in',
      p_body: 'Привіт',
      p_ts: '2024-03-04T11:10:00.000Z',
    });
  });

  test('pushName null → p_contact_name null', async () => {
    const { calls, impl } = fetchMock(() => new Response('null', { status: 200 }));
    const sb = createSupabase({ url: URL_BASE, key: KEY, fetchImpl: impl });
    await sb.upsertIncoming({ ...incoming, pushName: null });
    expect(JSON.parse(calls[0].init.body).p_contact_name).toBeNull();
  });

  test('помилка REST → throw зі статусом (сервіс відповість 500, Evolution зробить retry)', async () => {
    const { impl } = fetchMock(() => new Response('{"message":"permission denied"}', { status: 401 }));
    const sb = createSupabase({ url: URL_BASE, key: KEY, fetchImpl: impl });
    await expect(sb.upsertIncoming(incoming)).rejects.toThrow('401');
  });
});
