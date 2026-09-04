import { useSyncExternalStore } from 'react';
import type { Channel, ChannelKind, Click, Conversation, Employee, Message } from '../types';
import { extractTag, genCid, resolveAttribution } from './attribution';
import { buildSeed, pick, randomIncomingBody, randomName, randomUtm, rnd, uid } from './simulation';

export type PairingStatus = 'waiting' | 'scanned' | 'syncing' | 'connected';

export interface Pairing {
  id: string;
  kind: Extract<ChannelKind, 'wa' | 'tg'>;
  status: PairingStatus;
  qrSeed: string;
}

export interface Filters {
  channel: 'all' | ChannelKind | 'personal';
  attribution: 'all' | 'exact' | 'fallback' | 'direct';
  tag: string;
}

export type View = 'inbox' | 'channels' | 'leads' | 'analytics' | 'settings';
export const VIEWS: View[] = ['inbox', 'channels', 'leads', 'analytics', 'settings'];

export interface AppState {
  employees: Employee[];
  currentUserId: string;
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

const STORAGE_KEY = 'meridian_console_v1';

function freshState(): AppState {
  return {
    ...buildSeed(),
    selectedId: null,
    filters: { channel: 'all', attribution: 'all', tag: '' },
    simulatorOn: false,
    pairing: null,
    view: 'inbox',
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as AppState;
    if (!VIEWS.includes(parsed.view)) parsed.view = 'inbox';
    return parsed;
  } catch {
    return freshState();
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full/blocked — сессия просто не сохранится
  }
}

function update(fn: (s: AppState) => AppState) {
  state = fn(state);
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

// ============ селекторы ============

export function currentEmployee(s: AppState): Employee | undefined {
  return s.employees.find((e) => e.id === s.currentUserId);
}

export function myChannels(s: AppState): Channel[] {
  return s.channels.filter((c) => c.owner === 'personal' && c.ownerId === s.currentUserId);
}

export function companyChannels(s: AppState): Channel[] {
  return s.channels.filter((c) => c.owner === 'company');
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
  return s.conversations
    .filter((c) => {
      const ch = channelById(s, c.channelId);
      if (!ch) return false;
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

export function totalUnread(s: AppState): number {
  return s.conversations
    .filter((c) => {
      const ch = channelById(s, c.channelId);
      return ch && !(ch.owner === 'personal' && ch.ownerId !== s.currentUserId);
    })
    .reduce((acc, c) => acc + c.unread, 0);
}

export function channelUnread(s: AppState, predicate: (ch: Channel) => boolean): number {
  return s.conversations
    .filter((c) => {
      const ch = channelById(s, c.channelId);
      return ch && predicate(ch);
    })
    .reduce((acc, c) => acc + c.unread, 0);
}

// ============ действия ============

export function setView(view: View) {
  update((s) => ({ ...s, view }));
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
  update((s) => ({
    ...s,
    messages: { ...s.messages, [convId]: [...(s.messages[convId] ?? []), msg] },
    conversations: s.conversations.map((c) =>
      c.id === convId ? { ...c, lastTs: msg.ts } : c,
    ),
  }));
  setTimeout(() => setMessageStatus(convId, msg.id, 'delivered'), 1200);
  setTimeout(() => setMessageStatus(convId, msg.id, 'read'), 3200);
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
      // «клик был недавно, метку стёр» — матчится по recency через resolveAttribution
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

    // direct или личный чат
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

function mkMsg(convId: string, direction: 'in' | 'out', body: string, ts: number): Message {
  return { id: uid(), conversationId: convId, direction, body, ts, status: 'sent' };
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

// ============ QR-пейринг личного номера ============

export function startPairing(kind: Extract<ChannelKind, 'wa' | 'tg'>) {
  const p: Pairing = { id: uid(), kind, status: 'waiting', qrSeed: uid() };
  update((s) => ({ ...s, pairing: p }));
  setTimeout(() => setPairingStatus(p.id, 'scanned'), 2600);
  setTimeout(() => setPairingStatus(p.id, 'syncing'), 3900);
  setTimeout(() => finishPairing(p), 5200);
}

function setPairingStatus(id: string, status: PairingStatus) {
  update((s) =>
    s.pairing && s.pairing.id === id ? { ...s, pairing: { ...s.pairing, status } } : s,
  );
}

function finishPairing(p: Pairing) {
  update((s) => {
    if (!s.pairing || s.pairing.id !== p.id) return s;
    const phone = p.kind === 'wa' ? '+38 095 731 46 90' : '+38 099 218 63 54';
    const channel: Channel = {
      id: uid(),
      kind: p.kind,
      owner: 'personal',
      ownerId: s.currentUserId,
      displayName: p.kind === 'wa' ? 'WhatsApp · мій' : 'Telegram · мій',
      externalRef: phone,
      status: 'online',
    };
    return { ...s, pairing: null, channels: [...s.channels, channel] };
  });
}

export function cancelPairing() {
  update((s) => ({ ...s, pairing: null }));
}

export function removeChannel(channelId: string) {
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
