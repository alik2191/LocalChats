import type { Channel, Conversation, Message } from '../types';

export interface ToastItem {
  id: string;
  convId: string;
  name: string;
  body: string;
  kind: Channel['kind'];
}

/** Нові вхідні, яких ще немає в seen. Побічний ефект: додає знайдені id у seen. */
export function detectNewIncoming(
  conversations: Conversation[],
  messages: Record<string, Message[]>,
  kindByChannel: Record<string, Channel['kind']>,
  seen: Set<string>,
): ToastItem[] {
  const out: ToastItem[] = [];
  for (const c of conversations) {
    for (const m of messages[c.id] ?? []) {
      if (m.direction !== 'in' || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({
        id: m.id,
        convId: c.id,
        name: c.contactName,
        body: m.body,
        kind: kindByChannel[c.channelId] ?? 'wa',
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
