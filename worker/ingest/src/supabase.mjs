/**
 * Мінімальний REST-клієнт Supabase (PostgREST) для ingest-сервісу.
 * Без залежностей: node 20+ fetch. Секретний ключ (service role) приходить
 * тільки через env воркера — у код не потрапляє.
 */

function isoFromMs(tsMs) {
  return new Date(tsMs).toISOString();
}

export function createSupabase({ url, key, fetchImpl = fetch }) {
  async function rpc(name, params) {
    const res = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`rpc ${name}: HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    return res.json();
  }

  /**
   * RPC upsert_incoming_message (supabase/schema.sql): знаходить канал за instance,
   * апсертить діалог, вставляє повідомлення з дедупом за external_id.
   * Повертає conversation_id (uuid) або null — канал не знайдено.
   */
  async function upsertIncoming(m) {
    const conversationId = await rpc('upsert_incoming_message', {
      p_instance: m.instance,
      p_external_chat_id: m.chat,
      p_contact_name: m.pushName,
      p_external_id: m.externalId,
      p_direction: m.direction,
      p_body: m.body,
      p_ts: isoFromMs(m.tsMs),
    });
    return typeof conversationId === 'string' ? conversationId : null;
  }

  return { rpc, upsertIncoming };
}
