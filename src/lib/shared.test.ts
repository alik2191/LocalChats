import { describe, expect, test, vi } from 'vitest';
import type { Channel, Conversation } from '../types';
import type { AppState } from './store';

// supabase-клієнт (і @verdent/auth-js) у тестах не використовується —
// перевіряємо чисті маппери і мерж. fetchSharedState тестується на живому ендпоінті.
vi.mock('./supabase', () => ({ supabase: {} }));

const { mapDbChannel, mapDbConversation, mapDbMessage, mergeSharedState } = await import('./shared');

// Форми рядків — як їх віддає PostgREST (supabase/schema.sql)
const dbChannel = {
  id: '11111111-1111-1111-1111-111111111111',
  kind: 'wa',
  owner: 'company',
  owner_id: null,
  display_name: 'WhatsApp',
  external_ref: '+380671234567',
  instance: 'lc_wa_mtovgqj5',
  status: 'online',
};

const dbConv = {
  id: '22222222-2222-2222-2222-222222222222',
  channel_id: dbChannel.id,
  external_chat_id: '110600407498928@lid',
  contact_name: 'Оксана',
  phone: '+380671234567',
  click_id: 'A7K2M9QX',
  attribution: 'exact',
  utm_source: 'google',
  utm_medium: 'cpc',
  utm_campaign: 'rl_search_ua',
  gclid: 'Cj0KCQjw',
  unread_count: 0,
  last_message_at: '2026-09-06T20:00:00.000Z',
};

const dbMsg = {
  id: '33333333-3333-3333-3333-333333333333',
  conversation_id: dbConv.id,
  direction: 'in',
  body: 'Привіт',
  external_id: 'wa:lc_wa_mtovgqj5:3EB0TEST1',
  status: 'sent',
  created_at: '2026-09-06T20:00:00.000Z',
};

function localState(): AppState {
  return {
    employees: [],
    currentUserId: 'e1',
    userEmail: 'a@b.c',
    channels: [],
    conversations: [],
    messages: {},
    clicks: [],
    selectedId: null,
    filters: { channel: 'all', attribution: 'all', tag: '' },
    simulatorOn: false,
    pairing: null,
    view: 'inbox',
  };
}

describe('mapDbChannel', () => {
  test('валідний рядок → Channel з uuid як id', () => {
    const ch = mapDbChannel(dbChannel);
    expect(ch).toEqual({
      id: dbChannel.id,
      kind: 'wa',
      owner: 'company',
      ownerId: 'company',
      displayName: 'WhatsApp',
      externalRef: '+380671234567',
      instance: 'lc_wa_mtovgqj5',
      status: 'online',
    });
  });

  test('особистий канал → ownerId з owner_id; статус offline коли інстанс закритий', () => {
    const ch = mapDbChannel({ ...dbChannel, owner: 'personal', owner_id: 'e1', status: 'offline', display_name: 'WhatsApp · мій' });
    expect(ch).toMatchObject({ owner: 'personal', ownerId: 'e1', status: 'offline' });
  });

  test('биті рядки відкидаються (нема id/kind/instance, чужий kind)', () => {
    expect(mapDbChannel(null)).toBeNull();
    expect(mapDbChannel({ ...dbChannel, id: undefined })).toBeNull();
    expect(mapDbChannel({ ...dbChannel, kind: 'skype' })).toBeNull();
    expect(mapDbChannel({ ...dbChannel, instance: null })).toBeNull();
  });
});

describe('mapDbConversation / mapDbMessage', () => {
  test('валідні рядки → локальні Conversation/Message', () => {
    const conv = mapDbConversation(dbConv);
    expect(conv).toMatchObject({
      id: dbConv.id,
      channelId: dbChannel.id,
      personal: false,
      contactName: 'Оксана',
      phone: '+380671234567',
      attribution: 'exact',
      clickId: 'A7K2M9QX',
      utmSource: 'google',
      gclid: 'Cj0KCQjw',
      lastTs: Date.parse('2026-09-06T20:00:00.000Z'),
    });
    const msg = mapDbMessage(dbMsg);
    expect(msg).toEqual({
      id: dbMsg.id,
      conversationId: dbConv.id,
      direction: 'in',
      body: 'Привіт',
      ts: Date.parse('2026-09-06T20:00:00.000Z'),
      status: 'sent',
      externalId: 'wa:lc_wa_mtovgqj5:3EB0TEST1',
    });
  });

  test('биті рядки відкидаються', () => {
    expect(mapDbConversation({ ...dbConv, channel_id: undefined })).toBeNull();
    expect(mapDbMessage({ ...dbMsg, direction: 'sideways' })).toBeNull();
    expect(mapDbMessage({ ...dbMsg, body: '' })).toBeNull();
  });
});

describe('mergeSharedState', () => {
  test('канали з БД замінюють локальні з тим самим instance; локальні без інстанса в БД лишаються', () => {
    const local = localState();
    const dup: Channel = {
      id: 'ch_local', kind: 'wa', owner: 'company', ownerId: 'company',
      displayName: 'WhatsApp', externalRef: '+380671234567',
      instance: 'lc_wa_mtovgqj5', status: 'online',
    };
    const other: Channel = {
      id: 'ch_other', kind: 'wa', owner: 'personal', ownerId: 'e1',
      displayName: 'WhatsApp · мій', externalRef: '+380679998877',
      instance: 'lc_wa_personal', status: 'online',
    };
    local.channels = [dup, other];
    const merged = mergeSharedState(local, { channels: [dbChannel], conversations: [], messages: {} });
    const ids = merged.channels.map((c) => c.instance).sort();
    expect(ids).toEqual(['lc_wa_mtovgqj5', 'lc_wa_personal']);
    // id канала тепер з БД
    expect(merged.channels.find((c) => c.instance === 'lc_wa_mtovgqj5')!.id).toBe(dbChannel.id);
  });

  test('діалоги і повідомлення з БД додаються; локальні повідомлення (по external_id) не дублюються', () => {
    const local = localState();
    local.channels = [{
      id: dbChannel.id, kind: 'wa', owner: 'company', ownerId: 'company',
      displayName: 'WhatsApp', externalRef: '+380671234567',
      instance: 'lc_wa_mtovgqj5', status: 'online',
    }];
    const localMsgId = 'wa:lc_wa_mtovgqj5:3EB0TEST1';
    local.conversations = [{
      id: dbConv.id, channelId: dbChannel.id, personal: false,
      contactName: 'Старе імʼя', unread: 3, lastTs: 1,
    }];
    local.messages = {
      [dbConv.id]: [
        { id: 'm_local', conversationId: dbConv.id, direction: 'in', body: 'Привіт', ts: 1, status: 'read', externalId: localMsgId },
      ],
    };
    const merged = mergeSharedState(local, {
      channels: [dbChannel],
      conversations: [dbConv],
      messages: { [dbConv.id]: [dbMsg, { ...dbMsg, id: 'm2', external_id: 'wa:x:2', body: 'друге', created_at: '2026-09-06T20:01:00.000Z' }] },
    });
    // контактне імʼя оновилось з БД, unread локальний збережено
    expect(merged.conversations[0].contactName).toBe('Оксана');
    expect(merged.conversations[0].unread).toBe(3);
    // дублікат по external_id не зʼявився
    expect(merged.messages[dbConv.id]).toHaveLength(2);
    // локальні UI-настройки не змінені
    expect(merged.selectedId).toBeNull();
    expect(merged.view).toBe('inbox');
  });

  test('порожній/битий shared → локальний стан без змін', () => {
    const local = localState();
    expect(mergeSharedState(local, null)).toBe(local);
    expect(mergeSharedState(local, { channels: 'x' })).toBe(local);
  });
});
