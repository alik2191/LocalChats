/**
 * Backfill: перенос історії з Postgres Evolution (таблиця Message) у Supabase.
 * Форма рядків перевірена живим запитом у localchats-db (див. docs/plans/).
 * Дедуп на боці Supabase — UNIQUE external_id; додатково дедуп у межах батча.
 */
import { extractText, isChatIgnored } from './evolution.mjs';

/** Рядки Message Evolution → нормалізовані повідомлення (та сама форма, що webhook). */
export function mapBackfillRows(rows) {
  const out = [];
  const seen = new Set();
  for (const r of rows ?? []) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.sessionId !== 'string' || !r.sessionId) continue;
    const key = r.key;
    if (!key || typeof key.remoteJid !== 'string' || typeof key.id !== 'string' || !key.id) continue;
    if (isChatIgnored(key.remoteJid)) continue;
    const body = extractText(r.message);
    if (!body) continue;
    const externalId = `wa:${r.sessionId}:${key.id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    const ts = Number(r.messageTimestamp);
    out.push({
      instance: r.sessionId,
      chat: key.remoteJid,
      externalId,
      direction: key.fromMe ? 'out' : 'in',
      body,
      tsMs: Number.isFinite(ts) ? ts * 1000 : Date.now(),
      pushName: typeof r.pushName === 'string' && r.pushName ? r.pushName : null,
    });
  }
  return out;
}

/**
 * Прочитати історію інстансів з Postgres Evolution і залити в Supabase.
 * deps: { pgClientFactory, supabase, instances?: string[], logger }
 * pgClientFactory() → клієнт із уже заданим connection string (DATABASE_CONNECTION_URI).
 */
export async function runBackfill(deps) {
  const { pgClientFactory, supabase, logger = () => {}, instances } = deps;
  const client = await pgClientFactory();
  try {
    const instFilter = Array.isArray(instances) && instances.length
      ? instances
      : (await client.query("select name from \"Instance\" where \"connectionStatus\" = 'open'")).rows.map((r) => r.name);
    let ingested = 0;
    for (const instance of instFilter) {
      // Партіями по 500, старі → нові
      for (let offset = 0; ; offset += 500) {
        const { rows } = await client.query(
          'select "id", "sessionId", "key", "message", "messageTimestamp", "pushName" from "Message" where "sessionId" = $1 order by "messageTimestamp" asc limit 500 offset $2',
          [instance, offset],
        );
        if (!rows.length) break;
        const batch = mapBackfillRows(rows);
        for (const m of batch) {
          try {
            await supabase.upsertIncoming(m);
            ingested += 1;
          } catch (e) {
            logger(`backfill: ${m.externalId}: ${e.message}`);
          }
        }
        if (rows.length < 500) break;
      }
      logger(`backfill: ${instance} done`);
    }
    return { ok: true, ingested };
  } finally {
    try { await client.end(); } catch { /* уже закритий */ }
  }
}
