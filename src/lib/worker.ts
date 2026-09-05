import { getConnections } from './connections';
import { toWhatsAppNumber } from './format';

const TIMEOUT = 10000;

/**
 * Клієнт воркера сесій.
 * - WhatsApp: Evolution API-сумісні ендпоінти.
 * - Telegram: мінімальний контракт воркера на gramjs (/tg/qr, /tg/status, /tg/send).
 */
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const { worker } = getConnections();
  if (!worker.baseUrl) throw new Error('Воркер не налаштований');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${worker.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: worker.apiKey,
        Authorization: `Bearer ${worker.apiKey}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export interface EvoInstance {
  /** Evolution <=2.2: instanceName; Evolution >=2.3: name */
  instanceName?: string;
  name?: string;
  connectionStatus?: string;
  state?: string;
  profileName?: string;
  owner?: string;
}

export const workerApi = {
  async fetchInstances(): Promise<EvoInstance[]> {
    const data = await req<EvoInstance[] | { instances?: EvoInstance[] }>('/instance/fetchInstances');
    return Array.isArray(data) ? data : data.instances ?? [];
  },

  async createInstance(name: string) {
    return req('/instance/create', {
      method: 'POST',
      body: JSON.stringify({ instanceName: name, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
    });
  },

  async connectInstance(
    name: string,
  ): Promise<{ qr?: string; qrIsImage?: boolean; pairingCode?: string }> {
    const data = await req<Record<string, unknown>>(`/instance/connect/${name}`);
    // Evolution <=2.1: qrcode nested; Evolution >=2.3: base64/code на верхньому рівні
    const raw = (data?.qrcode ?? data) as Record<string, unknown> | string | undefined;
    let qr: string | undefined;
    let qrIsImage = false;
    let pairingCode: string | undefined;
    if (typeof raw === 'string') {
      // Деякі версії повертають рядок напряму: data:URL або base64-зображення
      qr = raw;
      qrIsImage = raw.startsWith('data:image');
    } else if (raw && typeof raw === 'object') {
      // Evolution: base64 — готове PNG-зображення; code — сирий QR-payload (не зображення)
      const img = (raw.base64 as string) ?? (raw.codebase64 as string);
      const payload = raw.code as string | undefined;
      pairingCode = (raw.pairingCode as string) ?? undefined;
      if (img) {
        qr = img;
        qrIsImage = true;
      } else if (payload && payload.startsWith('data:image')) {
        qr = payload;
        qrIsImage = true;
      } else if (payload) {
        qr = payload;
        qrIsImage = false;
      }
    }
    return { qr, qrIsImage, pairingCode };
  },

  async connectionState(name: string): Promise<string> {
    const data = await req<{ instance?: { state?: string } }>(`/instance/connectionState/${name}`);
    return data.instance?.state ?? 'unknown';
  },

  async sendText(name: string, number: string, text: string) {
    // JID (@lid тощо) проходить без змін — інакше LID-контакт недоступний
    const jid = toWhatsAppNumber(number);
    return req(`/message/sendText/${name}`, {
      method: 'POST',
      body: JSON.stringify({ number: jid, text }),
    });
  },

  async logoutInstance(name: string) {
    try {
      await req(`/instance/logout/${name}`, { method: 'DELETE' });
    } catch {
      // best effort
    }
    try {
      await req(`/instance/delete/${name}`, { method: 'DELETE' });
    } catch {
      // best effort
    }
  },

  // ============ Telegram (контракт нашого gramjs-воркера) ============

  async tgQr(): Promise<{ qr?: string; token?: string }> {
    const data = await req<{ qr_base64?: string; qr?: string; token?: string }>('/tg/qr');
    return { qr: data.qr_base64 ?? data.qr, token: data.token };
  },

  async tgStatus(token: string): Promise<{ authorized?: boolean; phone?: string }> {
    return req(`/tg/status?token=${encodeURIComponent(token)}`);
  },

  async tgSend(token: string, chat: string, text: string) {
    // gramjs розуміє лише @handles або числові ID: прибираємо пробіли/розділові знаки,
    // @handles залишаємо без змін
    const trimmed = chat.trim();
    const normalized = trimmed.startsWith('@')
      ? trimmed
      : trimmed.replace(/[^+\d]/g, '');
    return req('/tg/send', {
      method: 'POST',
      body: JSON.stringify({ token, chat: normalized, text }),
    });
  },

  // ============ Вхідні повідомлення (production ingest, polling) ============

  /** Evolution v2: POST /chat/findMessages/{instance}. Фільтр remoteJid ненадіжний —
   * забираємо останні N і фільтруємо на клієнті. */
  async fetchMessages(name: string, limit = 50): Promise<EvoIncoming[]> {
    const data = await req<{ messages?: { records?: unknown[] } } | unknown[]>(
      `/chat/findMessages/${name}`,
      { method: 'POST', body: JSON.stringify({ limit }) },
    );
    const records = Array.isArray(data) ? data : data?.messages?.records ?? [];
    return records.map(parseEvoRecord).filter((m): m is EvoIncoming => m !== null);
  },

  /** gramjs-воркер: вхідні, зібрані обробником подій (ring buffer на сервері). */
  async tgInbox(since = 0): Promise<EvoIncoming[]> {
    const data = await req<{ messages?: EvoIncoming[] }>(`/tg/inbox?since=${Math.floor(since)}`);
    return data.messages ?? [];
  },
};

export interface EvoIncoming {
  /** Унікальний id повідомлення в межах каналу */
  id: string;
  /** Нормалізований адресат: цифри (WA) або числовий TG id */
  chat: string;
  /** Ім'я відправника (pushName/username) */
  from: string;
  text: string;
  /** Мс */
  ts: number;
  /** Імʼя інстансу Evolution (заповнює pollWorkerIncoming) */
  instance?: string;
}

/** Витягнути текст і відправника з запису Evolution; null — групи/службові/без тексту */
function parseEvoRecord(rec: unknown): EvoIncoming | null {
  if (typeof rec !== 'object' || rec === null) return null;
  const r = rec as Record<string, unknown>;
  const key = r.key as Record<string, unknown> | undefined;
  const remoteJid = typeof key?.remoteJid === 'string' ? key.remoteJid : '';
  const id = typeof key?.id === 'string' ? key.id : '';
  if (!remoteJid || !id) return null;
  if (key?.fromMe === true) return null; // власні вихідні — не інбокс
  if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@newsletter')) return null; // групи
  const phone = remoteJid.split('@')[0];
  if (!/^\d{6,20}$/.test(phone)) return null;

  const message = (r.message ?? {}) as Record<string, unknown>;
  const ext = message.extendedTextMessage as Record<string, unknown> | undefined;
  const img = message.imageMessage as Record<string, unknown> | undefined;
  const vid = message.videoMessage as Record<string, unknown> | undefined;
  const text =
    (typeof message.conversation === 'string' && message.conversation) ||
    (typeof ext?.text === 'string' && ext.text) ||
    (typeof img?.caption === 'string' && img.caption) ||
    (typeof vid?.caption === 'string' && vid.caption) ||
    '';
  if (!text) return null; // медіа/стікери без тексту поки не інбоксимо

  const tsSec = typeof r.messageTimestamp === 'number' ? r.messageTimestamp : 0;
  return {
    id,
    chat: phone,
    from: typeof r.pushName === 'string' && r.pushName ? r.pushName : `+${phone}`,
    text,
    ts: tsSec > 0 ? tsSec * 1000 : Date.now(),
  };
}

export function normalizeQrSrc(qr: string): string {
  return qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
