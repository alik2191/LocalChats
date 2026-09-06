/**
 * Маппинг вебхука Evolution API (messages.upsert) → нормалізовані повідомлення.
 * Форми payload зафіксовані в docs/plans/phase3-persistent-messages.md
 * (перевірені по офіційних документах v2.x і issues evolution-foundation#1340).
 */

const IGNORED_SUFFIXES = ['@g.us', '@broadcast', '@newsletter'];

export function isChatIgnored(remoteJid) {
  if (typeof remoteJid !== 'string' || !remoteJid) return true;
  const lower = remoteJid.toLowerCase();
  if (lower === 'status@broadcast') return true;
  return IGNORED_SUFFIXES.some((s) => lower.endsWith(s));
}

/** Витягти текст із Baileys message-контейнера (v2.3.7). */
export function extractText(message) {
  if (!message || typeof message !== 'object') return '';
  const m = message;
  if (typeof m.conversation === 'string') return m.conversation;
  const nested = m.extendedTextMessage ?? m.imageMessage ?? m.videoMessage ?? m.documentMessage;
  if (nested && typeof nested === 'object') {
    const text = nested.text ?? nested.caption;
    if (typeof text === 'string') return text;
  }
  return '';
}

/**
 * payload.messages.upsert → [{instance, chat, externalId, direction, body, tsMs, pushName}].
 * `data` може бути об'єктом або масивом (батч). Свої повідомлення теж приходять
 * як messages.upsert із fromMe:true (evolution-foundation#1340) → direction 'out'.
 * Групи/статуси/порожні тіла/записи без key.id пропускаються.
 */
export function mapUpsertPayload(payload) {
  if (!payload || payload.event !== 'messages.upsert' || !payload.data) return [];
  const items = Array.isArray(payload.data) ? payload.data : [payload.data];
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const key = item.key;
    if (!key || typeof key.id !== 'string' || !key.id) continue;
    if (!isChatIgnored(key.remoteJid)) {
      const body = extractText(item.message);
      if (body) {
        const ts = Number(item.messageTimestamp);
        out.push({
          instance: payload.instance,
          chat: key.remoteJid,
          externalId: `wa:${payload.instance}:${key.id}`,
          direction: key.fromMe ? 'out' : 'in',
          body,
          tsMs: Number.isFinite(ts) ? ts * 1000 : Date.now(),
          pushName: typeof item.pushName === 'string' && item.pushName ? item.pushName : null,
        });
      }
    }
  }
  return out;
}
