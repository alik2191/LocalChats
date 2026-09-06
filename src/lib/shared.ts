/**
 * Спільний шар даних прод-режиму (фаза 3): канали/діалоги/повідомлення живуть
 * у спільних таблицях Supabase і синхронізуються в локальний стейт.
 * Завдяки цьому робочі канали, підключені адміном, видимі всім співробітникам,
 * а історія переживає очистку localStorage. RLS сховає особисті канали чужих.
 */
import type { Channel, ChannelKind, Conversation, Message } from '../types';
import type { AppState } from './store';
import { supabase } from './supabase';

// ============ рядки PostgREST (форма supabase/schema.sql) ============

interface DbChannel {
  id?: string;
  kind?: string;
  owner?: string;
  owner_id?: string | null;
  display_name?: string;
  external_ref?: string;
  instance?: string | null;
  status?: string;
}

interface DbConversation {
  id?: string;
  channel_id?: string;
  external_chat_id?: string;
  contact_name?: string | null;
  phone?: string | null;
  click_id?: string | null;
  attribution?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  gclid?: string | null;
  unread_count?: number;
  last_message_at?: string | null;
}

interface DbMessage {
  id?: string;
  conversation_id?: string;
  direction?: string;
  body?: string;
  external_id?: string | null;
  status?: string;
  created_at?: string;
}

const KINDS: ReadonlySet<string> = new Set(['wa', 'tg', 'viber']);
const OWNERS: ReadonlySet<string> = new Set(['company', 'personal']);
const DIRECTIONS: ReadonlySet<string> = new Set(['in', 'out']);
const STATUSES: ReadonlySet<string> = new Set(['sent', 'delivered', 'read', 'failed']);
const ATTRIBUTIONS: ReadonlySet<string> = new Set(['exact', 'fallback', 'direct']);

function tsFromIso(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

// ============ маппинг рядок БД → локальна модель ============

/**
 * ctx зіставляє uuid автора (owner_id) з локальною ідентичністю:
 * особистий канал поточного користувача має отримати localOwnerId,
 * інакше myChannels/видимість не збігнуться.
 */
export interface MappingCtx {
  authUserId?: string;
  localUserId?: string;
}

export function mapDbChannel(row: DbChannel | null | undefined, ctx?: MappingCtx): Channel | null {
  if (!row || typeof row.id !== 'string' || !row.id) return null;
  if (!row.kind || !KINDS.has(row.kind)) return null;
  if (!row.owner || !OWNERS.has(row.owner)) return null;
  if (typeof row.instance !== 'string' || !row.instance) return null;
  let ownerId = 'company';
  if (row.owner === 'personal') {
    ownerId =
      ctx?.authUserId && row.owner_id === ctx.authUserId && ctx.localUserId
        ? ctx.localUserId
        : row.owner_id || row.id;
  }
  return {
    id: row.id,
    kind: row.kind as ChannelKind,
    owner: row.owner as Channel['owner'],
    ownerId,
    displayName: typeof row.display_name === 'string' ? row.display_name : row.instance,
    externalRef: typeof row.external_ref === 'string' ? row.external_ref : '',
    instance: row.instance,
    status: row.status === 'online' ? 'online' : 'offline',
  };
}

export function mapDbConversation(row: DbConversation | null | undefined): Conversation | null {
  if (!row || typeof row.id !== 'string' || !row.id) return null;
  if (typeof row.channel_id !== 'string' || !row.channel_id) return null;
  if (typeof row.external_chat_id !== 'string' || !row.external_chat_id) return null;
  return {
    id: row.id,
    channelId: row.channel_id,
    personal: false, // уточнюється в mergeSharedState за власником канала
    contactName: row.contact_name || row.external_chat_id,
    phone: row.phone ?? row.external_chat_id,
    attribution: row.attribution && ATTRIBUTIONS.has(row.attribution) ? (row.attribution as Conversation['attribution']) : undefined,
    clickId: row.click_id ?? undefined,
    utmSource: row.utm_source ?? undefined,
    utmMedium: row.utm_medium ?? undefined,
    utmCampaign: row.utm_campaign ?? undefined,
    gclid: row.gclid ?? undefined,
    unread: 0,
    lastTs: tsFromIso(row.last_message_at),
  };
}

export function mapDbMessage(row: DbMessage | null | undefined): Message | null {
  if (!row || typeof row.id !== 'string' || !row.id) return null;
  if (typeof row.conversation_id !== 'string' || !row.conversation_id) return null;
  if (!row.direction || !DIRECTIONS.has(row.direction)) return null;
  if (typeof row.body !== 'string' || !row.body) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction as Message['direction'],
    body: row.body,
    ts: tsFromIso(row.created_at),
    status: row.status && STATUSES.has(row.status) ? (row.status as Message['status']) : 'sent',
    externalId: row.external_id ?? undefined,
  };
}

// ============ мерж спільних даних у локальний стан ============

export interface SharedData {
  channels: DbChannel[];
  conversations: DbConversation[];
  /** conversation uuid → рядки messages */
  messages: Record<string, DbMessage[]>;
}

function isSharedData(v: unknown): v is SharedData {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.channels) && Array.isArray(o.conversations);
}

/**
 * Замінити «спільні» частини стану даними з БД. Локальні UI-настройки
 * (фільтри, вибір, вид) і локальний unread не чіпаються; повідомлення
 * дедупляться за external_id, локальні (невідправлені/оптимістичні) лишаються.
 */
export function mergeSharedState(local: AppState, shared: unknown, ctx?: MappingCtx): AppState {
  if (!isSharedData(shared)) return local;

  const dbChannels = shared.channels
    .map((row) => mapDbChannel(row, ctx))
    .filter((c): c is Channel => c !== null);

  // БД — джерело правди для каналів з тим самим instance; локальні канали,
  // яких у БД ще нема (щойно підключені, upsert у процесі), зберігаються.
  const dbInstances = new Set(dbChannels.map((c) => c.instance));
  const keptLocal = local.channels.filter((c) => !c.instance || !dbInstances.has(c.instance));
  const channels = [...keptLocal, ...dbChannels];
  const channelIds = new Set(channels.map((c) => c.id));
  const personalOwners = new Set(channels.filter((c) => c.owner === 'personal').map((c) => c.id));

  const dbConvs = shared.conversations
    .map(mapDbConversation)
    .filter((c): c is Conversation => c !== null)
    .filter((c) => channelIds.has(c.channelId))
    .map((c) => ({ ...c, personal: personalOwners.has(c.channelId) }));

  const localConvById = new Map(local.conversations.map((c) => [c.id, c]));
  const localConvByChannelChat = new Map(local.conversations.map((c) => [`${c.channelId}|${c.phone ?? ''}`, c]));
  const conversations: Conversation[] = [];
  const usedIds = new Set<string>();
  for (const conv of dbConvs) {
    usedIds.add(conv.id);
    const prev =
      localConvById.get(conv.id) ??
      localConvByChannelChat.get(`${conv.channelId}|${conv.phone ?? ''}`);
    conversations.push({ ...conv, unread: prev?.unread ?? 0, leadCreated: prev?.leadCreated });
  }
  // Локальні діалоги, яких ще нема в БД (щойно створені полінгом), лишаються
  for (const conv of local.conversations) {
    if (!usedIds.has(conv.id) && channelIds.has(conv.channelId)) conversations.push(conv);
  }

  const convIds = new Set(conversations.map((c) => c.id));
  const messages: Record<string, Message[]> = {};
  for (const [convId, list] of Object.entries(shared.messages)) {
    if (!convIds.has(convId)) continue;
    const localList = local.messages[convId] ?? [];
    const localKeys = new Set(localList.map((m) => m.externalId ?? m.id));
    const fromDb: Message[] = [];
    for (const row of list ?? []) {
      const m = mapDbMessage(row);
      if (!m) continue;
      if (localKeys.has(m.externalId ?? m.id)) continue;
      fromDb.push(m);
    }
    messages[convId] = [...localList, ...fromDb].sort((a, b) => a.ts - b.ts);
  }
  // діалоги лише локальні — їхні повідомлення лишаються як є
  for (const conv of conversations) {
    if (!messages[conv.id]) messages[conv.id] = local.messages[conv.id] ?? [];
  }

  return {
    ...local,
    channels,
    conversations,
    messages,
  };
}

// ============ читання з Supabase (авторизований клієнт, RLS) ============

/** Підтягнути спільні дані. null — немає сесії/таблиць недоступні. */
export async function fetchSharedState(): Promise<SharedData | null> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return null;

  const [channelsRes, convsRes] = await Promise.all([
    supabase.from('channels').select('*'),
    supabase.from('conversations').select('*'),
  ]);
  if (channelsRes.error || convsRes.error) return null;

  // Останні 500 повідомлень по всіх видимих діалогах (старі підтягне backfill)
  const msgsRes = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  const msgRows = msgsRes.error ? [] : (msgsRes.data ?? []);

  const messages: Record<string, DbMessage[]> = {};
  for (const m of msgRows as DbMessage[]) {
    const convId = m.conversation_id;
    if (typeof convId !== 'string') continue;
    (messages[convId] ??= []).push(m);
  }
  // Newest-first із БД — у межах діалога розвертаємо на хронологічний порядок
  for (const list of Object.values(messages)) list.reverse();

  return {
    channels: (channelsRes.data ?? []) as DbChannel[],
    conversations: (convsRes.data ?? []) as DbConversation[],
    messages,
  };
}

// ============ записи в спільні таблиці (RLS: авторизований користувач) ============

/**
 * Апсерт канала (конфликт по уникальному instance). owner_id для личного
 * канала — uuid текущего auth-пользователя (требование RLS-политики).
 */
export async function upsertSharedChannel(ch: Channel): Promise<boolean> {
  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return false;
    const { error } = await supabase
      .from('channels')
      .upsert(
        {
          kind: ch.kind,
          owner: ch.owner,
          owner_id: ch.owner === 'personal' ? userData.user.id : null,
          display_name: ch.displayName,
          external_ref: ch.externalRef || ch.instance || userData.user.id,
          instance: ch.instance ?? null,
          status: ch.status,
        },
        { onConflict: 'instance' },
      );
    return !error;
  } catch {
    return false;
  }
}

/** Видалить канал спільної БД (адмін вимкнув номер). Діалоги/повідомлення каскадом. */
export async function deleteSharedChannel(instance: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('channels').delete().eq('instance', instance);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Записати вихідне повідомлення консоли в спільну БД через RPC
 * upsert_incoming_message (direction='out'): діалог апсертиться за
 * (instance, external_chat_id), повідомлення — з дедупом за external_id.
 */
export async function logOutgoingMessage(
  instance: string,
  chat: string,
  externalId: string,
  body: string,
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('upsert_incoming_message', {
      p_instance: instance,
      p_external_chat_id: chat,
      p_contact_name: null,
      p_external_id: externalId,
      p_direction: 'out',
      p_body: body,
      p_ts: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}
