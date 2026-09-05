import { useSyncExternalStore } from 'react';
import type { Channel, ChannelKind, Click, Conversation, Employee, Message } from '../types';
import { getBackend, mergeRemote, scheduleRemoteSave } from './backend';
import { extractTag, genCid, resolveAttribution } from './attribution';
import type { EvoIncoming } from './worker';
import { getConnections } from './connections';
import { isSuperAdminEmail } from './roles';
import { buildSeed, pick, randomIncomingBody, randomName, randomUtm, rnd, uid } from './simulation';
import { normalizeQrSrc, sleep, workerApi } from './worker';

export type PairingStatus = 'waiting' | 'scanned' | 'syncing' | 'connected';

export interface Pairing {
  id: string;
  kind: Extract<ChannelKind, 'wa' | 'tg'>;
  owner: 'company' | 'personal';
  status: PairingStatus;
  qrSeed: string;
  real?: boolean;
  qrImage?: string;
  pairingCode?: string;
  instanceName?: string;
  error?: string;
}

export interface Filters {
  channel: 'all' | ChannelKind | 'personal';
  attribution: 'all' | 'exact' | 'fallback' | 'direct';
  tag: string;
}

export type View = 'inbox' | 'channels' | 'admin' | 'leads' | 'attribution' | 'reports' | 'settings';
export const VIEWS: View[] = ['inbox', 'channels', 'admin', 'leads', 'attribution', 'reports', 'settings'];

export interface AppState {
  employees: Employee[];
  currentUserId: string;
  userEmail: string | null;
  channels: Channel[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  clicks: Click[];
  selectedId: string | null;
  filters: Filters;
  simulatorOn: boolean;
  pairing: Pairing | null;
  view: View;
}

const STORAGE_KEY = 'localchats_console_v1';

function freshState(): AppState {
  return {
    ...buildSeed(),
    userEmail: null,
    selectedId: null,
    filters: { channel: 'all', attribution: 'all', tag: '' },
    simulatorOn: false,
    pairing: null,
    view: 'inbox',
  };
}

/**
 * Самолікування стану: старі збірки могли записати канал із kind 'tg'
 * для WhatsApp-інстансів. Префікс інстанса воркера — надійне джерело правди:
 * WA-інстанси завжди `lc_wa_*`. Виправляємо kind і displayName.
 */
export function normalizeChannelKinds(channels: Channel[]): Channel[] {
  return channels.map((ch) => {
    if (!ch.instance || !ch.instance.startsWith('lc_wa_')) return ch;
    const fixed: Channel = ch.kind === 'wa' ? ch : { ...ch, kind: 'wa' };
    const wantName =
      fixed.owner === 'company' ? 'WhatsApp' : 'WhatsApp · мій';
    return fixed.displayName === wantName ? fixed : { ...fixed, displayName: wantName };
  });
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as AppState;
    if (!VIEWS.includes(parsed.view)) parsed.view = 'inbox';
    parsed.channels = normalizeChannelKinds(parsed.channels ?? []);
    return parsed;
  } catch {
    return freshState();
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();
// Момент останньої локальної зміни — захист від гонки «pull vs локальні правки»
let lastChangeAt = 0;

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // сховище переповнене/заблоковане — сесія просто не збережеться
  }
  // Активний бекенд (Supabase/REST) отримує стан асинхронно; localStorage — офлайн-кеш
  scheduleRemoteSave(state);
}

/**
 * Підтягнути стан з активного віддаленого бекенду (Supabase/REST).
 * Викликається один раз після входу; дані з бекенду мають пріоритет,
 * локальні налаштування UI зберігаються. Якщо під час завантаження
 * користувач щось змінив локально — злиття пропускаємо, щоб не
 * перетерти свіжі правки застарілим віддаленим станом.
 */
export async function pullRemoteState(): Promise<boolean> {
  const backend = getBackend(getConnections().backend);
  if (backend.kind === 'local') return false;
  const startedAt = Date.now();
  try {
    const remote = await backend.load();
    if (!remote) return false;
    if (lastChangeAt > startedAt) return false;
    update((s) => {
      const merged = mergeRemote(s, remote);
      // самолікування: у віддаленому стані можуть бути канали з битим kind
      return { ...merged, channels: normalizeChannelKinds(merged.channels) };
    });
    return true;
  } catch {
    return false;
  }
}

function update(fn: (s: AppState) => AppState) {
  state = fn(state);
  lastChangeAt = Date.now();
  persist();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, () => state);
}

// ============ селектори ============

/** Синхронний знімок стану (для тестів і позареактивного доступу) */
export function getState(): AppState {
  return state;
}

export function currentEmployee(s: AppState): Employee | undefined {
  return s.employees.find((e) => e.id === s.currentUserId);
}

export function isSuperAdmin(s: AppState): boolean {
  return isSuperAdminEmail(s.userEmail);
}

export function myChannels(s: AppState): Channel[] {
  return activeChannels(s).filter((c) => c.owner === 'personal' && c.ownerId === s.currentUserId);
}

export function companyChannels(s: AppState): Channel[] {
  return activeChannels(s).filter((c) => c.owner === 'company');
}

/**
 * Канали, активні для поточного режиму. У продакшені показуємо лише реальні
 * канали з прив'язаною сесією воркера (instance) — демо-сид без instance
 * приховуємо, щоб демо-діалоги не плуталися з реальними повідомленнями.
 * У демо-режимі видимі всі канали.
 */
export function activeChannels(s: AppState): Channel[] {
  if (getConnections().mode !== 'production') return s.channels;
  return s.channels.filter((c) => !!c.instance);
}

export function channelById(s: AppState, id: string): Channel | undefined {
  return s.channels.find((c) => c.id === id);
}

export function lastMessage(s: AppState, convId: string): Message | undefined {
  const list = s.messages[convId];
  return list?.[list.length - 1];
}

export function visibleConversations(s: AppState): Conversation[] {
  const { channel, attribution, tag } = s.filters;
  const q = tag.replace('#', '').trim().toUpperCase();
  const activeIds = new Set(activeChannels(s).map((c) => c.id));
  return s.conversations
    .filter((c) => {
      const ch = channelById(s, c.channelId);
      if (!ch) return false;
      // демо-діалоги (канал без instance) не показуємо в продакшені
      if (!activeIds.has(c.channelId)) return false;
      if (ch.owner === 'personal' && ch.ownerId !== s.currentUserId) return false;
      if (channel === 'personal' && ch.owner !== 'personal') return false;
      if (channel !== 'all' && channel !== 'personal' && ch.kind !== channel) return false;
      if (attribution !== 'all' && ch.owner === 'company' && c.attribution !== attribution) return false;
      if (q) {
        const inTag = c.clickId?.toUpperCase().includes(q);
        const inBody = s.messages[c.id]?.some((m) => m.body.toUpperCase().includes(q));
        if (!inTag && !inBody) return false;
      }
      return true;
    })
    .sort((a, b) => b.lastTs - a.lastTs);
}

/** Діалоги робочих каналів, активних у поточному режимі (ліди/звіти/атрибуція) */
export function companyConversations(s: AppState): Conversation[] {
  const activeIds = new Set(activeChannels(s).filter((c) => c.owner === 'company').map((c) => c.id));
  return s.conversations.filter((c) => activeIds.has(c.channelId));
}

export function totalUnread(s: AppState): number {
  const activeIds = new Set(activeChannels(s).map((c) => c.id));
  return s.conversations
    .filter((c) => {
      if (!activeIds.has(c.channelId)) return false;
      const ch = channelById(s, c.channelId);
      return ch && !(ch.owner === 'personal' && ch.ownerId !== s.currentUserId);
    })
    .reduce((acc, c) => acc + c.unread, 0);
}

export function channelUnread(s: AppState, predicate: (ch: Channel) => boolean): number {
  const activeIds = new Set(activeChannels(s).map((c) => c.id));
  return s.conversations
    .filter((c) => {
      if (!activeIds.has(c.channelId)) return false;
      const ch = channelById(s, c.channelId);
      return ch && predicate(ch);
    })
    .reduce((acc, c) => acc + c.unread, 0);
}

// ============ действия ============

export function setView(view: View) {
  update((s) => (view === 'admin' && !isSuperAdmin(s) ? s : { ...s, view }));
}

/** Реєстрація/вхід: створюємо співробітника за email (якщо новий) і робимо поточним.
 * Завжди вирівнюємо currentUserId за email: застарілий id (наприклад, 'e1' із сиду
 * після відновлення стану) приховував би реальні особисті канали користувача. */
export function signInUser(email: string) {
  update((s) => {
    const id = `emp_${email.toLowerCase()}`;
    let employees = s.employees;
    if (!employees.some((e) => e.id === id)) {
      const namePart = email.split('@')[0];
      employees = [
        ...employees,
        {
          id,
          name: namePart,
          initials: namePart.slice(0, 2).toUpperCase(),
        },
      ];
    }
    if (s.userEmail === email && s.currentUserId === id) return s;
    const prevId = s.currentUserId;
    // Листування/канали, підв'язані до попереднього поточного користувача
    // (створені до входу), переходять за новим власником.
    const channels = s.channels.map((c) =>
      c.owner === 'personal' && c.ownerId === prevId ? { ...c, ownerId: id } : c,
    );
    return { ...s, userEmail: email, employees, currentUserId: id, channels, selectedId: null };
  });
}

/** Перейменувати контакт (коли pushName від мессенджера відсутній) */
export function renameContact(convId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  update((s) => ({
    ...s,
    conversations: s.conversations.map((c) =>
      c.id === convId ? { ...c, contactName: trimmed } : c,
    ),
  }));
}

/** Створити лід вручну з панелі чату (локальна відмітка; Zoho-синк — етап 3) */
export function createLeadManually(convId: string) {
  update((s) => ({
    ...s,
    conversations: s.conversations.map((c) =>
      c.id === convId ? { ...c, leadCreated: true } : c,
    ),
  }));
}

export function selectConversation(id: string | null) {
  update((s) => ({
    ...s,
    selectedId: id,
    conversations: id
      ? s.conversations.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
      : s.conversations,
  }));
}

export function setChannelFilter(channel: Filters['channel']) {
  update((s) => ({ ...s, filters: { ...s.filters, channel } }));
}

export function setAttributionFilter(attribution: Filters['attribution']) {
  update((s) => ({ ...s, filters: { ...s.filters, attribution } }));
}

export function setTagQuery(tag: string) {
  update((s) => ({ ...s, filters: { ...s.filters, tag } }));
}

export function toggleSimulator() {
  update((s) => ({ ...s, simulatorOn: !s.simulatorOn }));
}

export function resetDemo() {
  state = freshState();
  persist();
  listeners.forEach((l) => l());
}

export function switchUser(id: string) {
  update((s) => ({ ...s, currentUserId: id, selectedId: null }));
}

export function sendReply(convId: string, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return;
  const msg: Message = {
    id: uid(),
    conversationId: convId,
    direction: 'out',
    body: trimmed,
    ts: Date.now(),
    status: 'sent',
  };
  const conv = state.conversations.find((c) => c.id === convId);
  const ch = conv ? channelById(state, conv.channelId) : undefined;
  const isProd = getConnections().mode === 'production';
  const prodSend: Promise<void> | null = (() => {
    if (!isProd || !ch?.instance || !conv) return null;
    if (ch.kind === 'wa') {
      if (!conv.phone) return null;
      return workerApi
        .sendText(ch.instance, conv.phone, trimmed)
        .then(() => {
          setMessageStatus(convId, msg.id, 'delivered');
          setTimeout(() => setMessageStatus(convId, msg.id, 'read'), 2000);
        })
        .catch(() => setMessageStatus(convId, msg.id, 'failed'));
    }
    if (ch.kind === 'tg') {
      if (!conv.phone) return null; // немає адресата — блок, не імітація
      return workerApi
        .tgSend(ch.instance, conv.phone, trimmed)
        .then(() => {
          setMessageStatus(convId, msg.id, 'delivered');
          setTimeout(() => setMessageStatus(convId, msg.id, 'read'), 2000);
        })
        .catch(() => setMessageStatus(convId, msg.id, 'failed'));
    }
    return null;
  })();

  update((s) => ({
    ...s,
    messages: { ...s.messages, [convId]: [...(s.messages[convId] ?? []), msg] },
    conversations: s.conversations.map((c) =>
      c.id === convId ? { ...c, lastTs: msg.ts } : c,
    ),
  }));

  if (prodSend) {
    void prodSend;
  } else if (isProd) {
    // Прод-режим, але канал не прив'язаний до реальної сесії — чесно позначаємо як failed
    setMessageStatus(convId, msg.id, 'failed');
  } else {
    setTimeout(() => setMessageStatus(convId, msg.id, 'delivered'), 1200);
    setTimeout(() => setMessageStatus(convId, msg.id, 'read'), 3200);
  }
}

/** Heartbeat: звіряємо статуси каналів із воркером (production) */
export function syncChannelStatuses(
  instances: Array<{ instanceName?: string; name?: string; connectionStatus?: string; state?: string }>,
) {
  update((s) => ({
    ...s,
    channels: s.channels.map((ch) => {
      if (!ch.instance) return ch;
      const me = instances.find((i) => (i.instanceName ?? i.name) === ch.instance);
      const st = me?.connectionStatus ?? me?.state;
      return st ? { ...ch, status: st === 'open' ? 'online' : 'offline' } : ch;
    }),
  }));
}

// ============ production ingest: polling вхідних із воркера ============

let pollInFlight = false;
/** Вікно TG-inbox з перехрестям, щоб не втратити повідомлення між опитуваннями */
let tgSince = Date.now() - 10 * 60 * 1000;
/** Перехрестя проти годинникового скіху client↔server (дедуп робить replay безпечним) */
const TG_OVERLAP_MS = 60_000;
const WA_WINDOW_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Забрати вхідні повідомлення з воркера (WA: /chat/findMessages, TG: /tg/inbox)
 * і залити в стан через той самий пайплайн, що й симулятор:
 * дедуп за external_id → атрібуція (exact/fallback/direct) → unread.
 */
export async function pollWorkerIncoming(): Promise<number> {
  if (pollInFlight) return 0;
  const conn = getConnections();
  if (conn.mode !== 'production' || conn.workerStatus.state !== 'ok') return 0;
  pollInFlight = true;
  const tgUntil = Date.now();
  // WA: findMessages повертає історію — інбоксимо лише свіжі (вікно 30 хв + запас на
  // скіх між годинником браузера і timestamp'ами сервера Evolution).
  // Повні вебхуки без цієї втрати — фаза 3 (ingest-пайплайн з БД).
  const waFloor = Date.now() - WA_WINDOW_MS - CLOCK_SKEW_MS;
  try {
    const incoming: EvoIncoming[] = [];
    let tgFetchOk = false;
    for (const ch of state.channels.filter((c) => c.instance && c.status === 'online')) {
      try {
        if (ch.kind === 'wa') {
          const msgs = (await workerApi.fetchMessages(ch.instance!, 50))
            .filter((m) => m.ts >= waFloor)
            .map((m) => ({ ...m, instance: ch.instance }));
          incoming.push(...msgs);
        } else if (ch.kind === 'tg') {
          incoming.push(...(await workerApi.tgInbox(tgSince)).map((m) => ({ ...m, instance: ch.instance })));
          tgFetchOk = true;
        }
      } catch {
        // канал тимчасово недоступний — інші канали опитуємо далі
      }
    }
    // Вотермарк рухається лише після успішного TG-запиту (інакше повідомлення
    // з вікна [tgSince, tgUntil) загубилися б); перехрестя + дедуп — безпечно.
    if (tgFetchOk) tgSince = tgUntil - TG_OVERLAP_MS;
    if (incoming.length === 0) return 0;
    let added = 0;
    update((s) => {
      // Індекс external_id один раз на батч (замість O(n)-скану на кожне повідомлення)
      const seenIds = new Set(
        Object.values(s.messages).flatMap((list) =>
          list.map((x) => x.externalId).filter((x): x is string => !!x),
        ),
      );
      let next = s;
      for (const m of incoming.sort((a, b) => a.ts - b.ts)) {
        const [merged, isNew] = ingestIncoming(next, m, seenIds);
        if (isNew) added += 1;
        next = merged;
      }
      return next;
    });
    return added;
  } finally {
    pollInFlight = false;
  }
}

/** Дедуп за external_id → знайти/створити діалог → атрібуція → повідомлення in */
function ingestIncoming(s: AppState, m: EvoIncoming, seenIds: Set<string>): [AppState, boolean] {
  const ch =
    m.instance
      ? s.channels.find((c) => c.instance === m.instance)
      : undefined;
  if (!ch) return [s, false];

  const externalId = `${ch.kind}:${ch.instance}:${m.id}`;
  if (seenIds.has(externalId)) return [s, false];
  seenIds.add(externalId);

  const now = m.ts;
  const existing = s.conversations.find((c) => c.channelId === ch.id && c.phone === m.chat);
  const tag = extractTag(m.text);
  const res =
    ch.owner === 'company'
      ? resolveAttribution(s.clicks, tag, ch.kind, now)
      : { attribution: 'direct' as const, click: undefined };
  const attributionPatch =
    ch.owner === 'company' && res.attribution !== 'direct'
      ? {
          attribution: res.attribution,
          clickId: res.click?.clickId,
          utmSource: res.click?.utmSource,
          utmMedium: res.click?.utmMedium,
          utmCampaign: res.click?.utmCampaign,
          gclid: res.click?.gclid,
        }
      : {};

  if (existing) {
    const msg = mkMsg(existing.id, 'in', m.text, now, externalId);
    const conv: Conversation = {
      ...existing,
      unread: existing.unread + 1,
      lastTs: Math.max(existing.lastTs, now),
      // атрибуція оновлюється лише якщо попередня була direct/нед визначена
      ...(existing.attribution === 'direct' || !existing.attribution ? attributionPatch : {}),
    };
    return [patchConv(s, conv, [], msg), true];
  }
  const newConv = mkConv(ch, m.from, now, {
    phone: m.chat,
    unread: 1,
    ...(ch.owner === 'company' ? { attribution: res.attribution, ...attributionPatch } : {}),
  });
  const msg = mkMsg(newConv.id, 'in', m.text, now, externalId);
  return [addConv(s, newConv, [], msg), true];
}

function setMessageStatus(convId: string, msgId: string, status: Message['status']) {
  update((s) => {
    const list = s.messages[convId];
    if (!list) return s;
    return {
      ...s,
      messages: {
        ...s.messages,
        [convId]: list.map((m) => (m.id === msgId ? { ...m, status } : m)),
      },
    };
  });
}

// ============ симулятор входящих ============

export function simulateIncoming(scenario?: 'exact' | 'fallback' | 'direct') {
  const kind = scenario ?? pick(['exact', 'fallback', 'direct'] as const);
  update((s) => {
    const pool = s.channels.filter((c) => c.status === 'online');
    const channel = pick(pool);
    const now = Date.now();
    let body = randomIncomingBody();
    const name = randomName();
    const isPersonal = channel.owner === 'personal';

    let conv = s.conversations.find(
      (c) => c.channelId === channel.id && c.contactName === name,
    );
    const tag = genCid();

    if (kind === 'exact' && !isPersonal) {
      body += ` #${tag}`;
      const { utm, gclid } = randomUtm();
      const click: Click = {
        clickId: tag,
        channelKind: channel.kind,
        utmSource: utm[0],
        utmMedium: utm[1],
        utmCampaign: utm[2],
        gclid,
        ipHash: `sim-${rnd(1e6)}`,
        uaHash: `sim-${rnd(1e6)}`,
        createdAt: now,
      };
      const msg = mkMsg(conv?.id ?? '', 'in', body, now);
      if (conv) {
        conv = {
          ...conv,
          attribution: 'exact',
          clickId: tag,
          utmSource: utm[0],
          utmMedium: utm[1],
          utmCampaign: utm[2],
          gclid,
          unread: conv.unread + 1,
          lastTs: now,
        };
        return patchConv(s, conv, [click], msg);
      }
      const newConv = mkConv(channel, name, now, {
        attribution: 'exact',
        clickId: tag,
        utmSource: utm[0],
        utmMedium: utm[1],
        utmCampaign: utm[2],
        gclid,
      });
      msg.conversationId = newConv.id;
      return addConv(s, newConv, [click], msg);
    }

    if (kind === 'fallback' && !isPersonal) {
      // «клик був нещодавно, мітку стер» — матчиться за recency через resolveAttribution
      const tagMatch = extractTag(body);
      const res = resolveAttribution(s.clicks, tagMatch, channel.kind, now);
      const msg = mkMsg(conv?.id ?? '', 'in', body, now);
      if (conv && res.attribution !== 'direct') {
        conv = {
          ...conv,
          attribution: 'fallback',
          clickId: res.click?.clickId,
          utmSource: res.click?.utmSource,
          utmMedium: res.click?.utmMedium,
          utmCampaign: res.click?.utmCampaign,
          gclid: res.click?.gclid,
          unread: conv.unread + 1,
          lastTs: now,
        };
        return patchConv(s, conv, [], msg);
      }
      const newConv = mkConv(channel, name, now, {
        attribution: res.attribution === 'direct' ? 'direct' : 'fallback',
        clickId: res.click?.clickId,
        utmSource: res.click?.utmSource,
        utmMedium: res.click?.utmMedium,
        utmCampaign: res.click?.utmCampaign,
        gclid: res.click?.gclid,
      });
      msg.conversationId = newConv.id;
      return addConv(s, newConv, [], msg);
    }

    // direct або особистий чат
    const msg = mkMsg(conv?.id ?? '', 'in', body, now);
    if (conv) {
      conv = { ...conv, unread: conv.unread + 1, lastTs: now };
      return patchConv(s, conv, [], msg);
    }
    const newConv = mkConv(channel, name, now, isPersonal ? {} : { attribution: 'direct' });
    msg.conversationId = newConv.id;
    return addConv(s, newConv, [], msg);
  });
}

function mkMsg(convId: string, direction: 'in' | 'out', body: string, ts: number, externalId?: string): Message {
  return { id: uid(), conversationId: convId, direction, body, ts, status: 'sent', externalId };
}

function mkConv(
  channel: Channel,
  name: string,
  now: number,
  extra: Partial<Conversation>,
): Conversation {
  return {
    id: uid(),
    channelId: channel.id,
    personal: channel.owner === 'personal',
    contactName: name,
    phone: channel.kind === 'tg' ? `@${name.split(' ')[0].toLowerCase()}_ua` : `+38 0${rnd(9)} ${rnd(90) + 10} ${rnd(90) + 10} ${rnd(90) + 10} ${rnd(90) + 10}`,
    unread: 0,
    lastTs: now,
    ...extra,
  };
}

function patchConv(s: AppState, conv: Conversation, newClicks: Click[], msg: Message): AppState {
  return {
    ...s,
    clicks: [...s.clicks, ...newClicks],
    conversations: s.conversations.map((c) => (c.id === conv.id ? conv : c)),
    messages: { ...s.messages, [conv.id]: [...(s.messages[conv.id] ?? []), msg] },
  };
}

function addConv(s: AppState, conv: Conversation, newClicks: Click[], msg: Message): AppState {
  return {
    ...s,
    clicks: [...s.clicks, ...newClicks],
    conversations: [...s.conversations, conv],
    messages: { ...s.messages, [conv.id]: [msg] },
  };
}

// ============ QR-пейринг (демо — симуляція, прод — реальний воркер) ============

let pairingCancelled = false;
let pairingSeq = 0; // покоління: скасовує застарілі цикли опитування при повторному пейрингу

export function startPairing(kind: Extract<ChannelKind, 'wa' | 'tg'>, owner: 'company' | 'personal' = 'personal') {
  const conn = getConnections();
  if (conn.mode === 'production' && conn.workerStatus.state === 'ok') {
    void startRealPairing(kind, owner);
    return;
  }
  const p: Pairing = { id: uid(), kind, owner, status: 'waiting', qrSeed: uid() };
  update((s) => ({ ...s, pairing: p }));
  setTimeout(() => setPairingStatus(p.id, 'scanned'), 2600);
  setTimeout(() => setPairingStatus(p.id, 'syncing'), 3900);
  setTimeout(() => finishPairing(p), 5200);
}

function updatePairing(patch: Partial<Pairing>) {
  update((s) => (s.pairing ? { ...s, pairing: { ...s.pairing, ...patch } } : s));
}

async function startRealPairing(kind: Extract<ChannelKind, 'wa' | 'tg'>, owner: 'company' | 'personal') {
  pairingCancelled = false;
  const seq = ++pairingSeq;
  const stale = () => seq !== pairingSeq || pairingCancelled;
  update((s) => ({
    ...s,
    pairing: { id: uid(), kind, owner, status: 'waiting', qrSeed: uid(), real: true },
  }));
  let waInstance: string | undefined;
  try {
    if (kind === 'wa') {
      const instance = `lc_wa_${Date.now().toString(36)}`;
      waInstance = instance;
      await workerApi.createInstance(instance);
      const { qr, qrIsImage, pairingCode } = await workerApi.connectInstance(instance);
      if (!qr) throw new Error('Воркер не повернув QR-код');
      // Використовуємо лише готове QR-зображення; сирий payload рендерити не можна
      if (!qrIsImage) throw new Error('Воркер повернув QR-payload без зображення');
      if (stale()) {
        void workerApi.logoutInstance(instance);
        return;
      }
      updatePairing({ instanceName: instance, qrImage: normalizeQrSrc(qr), pairingCode });
      const deadline = Date.now() + 150000;
      let connected = false;
      while (Date.now() < deadline) {
        if (stale()) {
          void workerApi.logoutInstance(instance);
          return;
        }
        await sleep(3000);
        if (stale()) {
          void workerApi.logoutInstance(instance);
          return;
        }
        const state = await workerApi.connectionState(instance);
        if (state === 'open') {
          connected = true;
          break;
        }
      }
      if (stale()) {
        void workerApi.logoutInstance(instance);
        return;
      }
      if (!connected) {
        void workerApi.logoutInstance(instance);
        updatePairing({ error: 'Час очікування сканування QR вичерпано' });
        return;
      }
      updatePairing({ status: 'syncing' });
      const instances = await workerApi.fetchInstances().catch(() => []);
      const me = instances.find((i) => (i.instanceName ?? i.name) === instance);
      const phone = me?.owner ?? me?.profileName ?? instance;
      finishRealPairing(seq, kind, owner, instance, String(phone));
    } else {
      const { qr, token } = await workerApi.tgQr();
      if (!qr || !token) throw new Error('Воркер не повернув QR для Telegram (/tg/qr)');
      if (stale()) return;
      updatePairing({ instanceName: token, qrImage: normalizeQrSrc(qr) });
      const deadline = Date.now() + 150000;
      let phone = '';
      let authorized = false;
      while (Date.now() < deadline) {
        if (stale()) return;
        await sleep(3000);
        if (stale()) return;
        const st = await workerApi.tgStatus(token);
        if (st.authorized) {
          authorized = true;
          phone = st.phone ?? '';
          break;
        }
      }
      if (stale()) return;
      if (!authorized) {
        updatePairing({ error: 'Час очікування сканування QR вичерпано' });
        return;
      }
      updatePairing({ status: 'syncing' });
      finishRealPairing(seq, kind, owner, token, phone || 'Telegram');
    }
  } catch (e) {
    // Не залишаємо «живу» WA-сесію на воркері після помилки
    if (waInstance) void workerApi.logoutInstance(waInstance);
    if (!stale()) {
      updatePairing({
        error: e instanceof Error ? e.message : 'помилка зʼєднання з воркером',
      });
    }
  }
}

function finishRealPairing(
  seq: number,
  kind: Extract<ChannelKind, 'wa' | 'tg'>,
  owner: 'company' | 'personal',
  instance: string,
  phone: string,
) {
  if (seq !== pairingSeq || pairingCancelled) {
    // Пейринг уже неактуальний — не кидаємо підключену WA-сесію «в нікуду»
    if (kind === 'wa') void workerApi.logoutInstance(instance);
    return;
  }
  updatePairing({ status: 'connected' });
  setTimeout(() => {
    if (seq !== pairingSeq || pairingCancelled) {
      if (kind === 'wa') void workerApi.logoutInstance(instance);
      return;
    }
    update((s) => {
      if (!s.pairing) return s;
      const channel: Channel = {
        id: uid(),
        kind,
        owner,
        ownerId: owner === 'company' ? 'company' : s.currentUserId,
        displayName:
          kind === 'wa'
            ? owner === 'company'
              ? 'WhatsApp'
              : 'WhatsApp · мій'
            : owner === 'company'
              ? 'Telegram'
              : 'Telegram · мій',
        externalRef: phone,
        instance,
        status: 'online',
      };
      return { ...s, pairing: null, channels: [...s.channels, channel] };
    });
  }, 900);
}

function setPairingStatus(id: string, status: PairingStatus) {
  update((s) =>
    s.pairing && s.pairing.id === id ? { ...s, pairing: { ...s.pairing, status } } : s,
  );
}

function finishPairing(p: Pairing) {
  update((s) => {
    if (!s.pairing || s.pairing.id !== p.id) return s;
    const phone = p.kind === 'wa' ? `+38 09${rnd(9)} ${rnd(90) + 10} ${rnd(90) + 10} ${rnd(90) + 10} ${rnd(90) + 10}` : `+38 09${rnd(9)} ${rnd(90) + 10} ${rnd(90) + 10} ${rnd(90) + 10} ${rnd(90) + 10}`;
    const isCompany = p.owner === 'company';
    const channel: Channel = {
      id: uid(),
      kind: p.kind,
      owner: p.owner,
      ownerId: isCompany ? 'company' : s.currentUserId,
      displayName: isCompany
        ? p.kind === 'wa'
          ? 'WhatsApp'
          : 'Telegram'
        : p.kind === 'wa'
          ? 'WhatsApp · мій'
          : 'Telegram · мій',
      externalRef: phone,
      status: 'online',
    };
    return { ...s, pairing: null, channels: [...s.channels, channel] };
  });
}

export function cancelPairing() {
  pairingCancelled = true;
  const p = state.pairing;
  if (p?.real && p.instanceName && p.status !== 'connected') {
    if (p.kind === 'wa') void workerApi.logoutInstance(p.instanceName);
  }
  update((s) => ({ ...s, pairing: null }));
}

export function removeChannel(channelId: string) {
  const ch = channelById(state, channelId);
  if (getConnections().mode === 'production' && ch?.instance) {
    if (ch.kind === 'wa') void workerApi.logoutInstance(ch.instance);
  }
  update((s) => {
    const convIds = new Set(
      s.conversations.filter((c) => c.channelId === channelId).map((c) => c.id),
    );
    const messages = { ...s.messages };
    for (const id of convIds) delete messages[id];
    return {
      ...s,
      channels: s.channels.filter((c) => c.id !== channelId),
      conversations: s.conversations.filter((c) => !convIds.has(c.id)),
      selectedId: s.selectedId && convIds.has(s.selectedId) ? null : s.selectedId,
      messages,
    };
  });
}
