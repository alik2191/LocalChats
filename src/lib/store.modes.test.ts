// @vitest-environment happy-dom
/**
 * Тести на режими видимості каналів та ідентичність користувача.
 * Стан сіємо через localStorage ПЕРЕД динамічним імпортом store
 * (модуль читає localStorage на завантаженні).
 */
import { beforeEach, vi } from 'vitest';
import { expect, test } from 'vitest';
import type { Channel, Conversation } from '../types';
import type { AppState } from './store';

// supabase-клієнт (і @verdent/auth-js) у тестах не використовується —
// бекенд завжди 'local'. Мокаємо, щоб не тягнути важкий імпорт.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

const localStorage = window.localStorage;
const CONSOLE_KEY = 'localchats_console_v1';
const CONN_KEY = 'localchats_connections_v1';

function seedState(partial: Partial<AppState>) {
  localStorage.setItem(CONSOLE_KEY, JSON.stringify({ view: 'inbox', ...partial }));
}

async function loadStore() {
  vi.resetModules();
  return import('../lib/store');
}

function setMode(mode: 'demo' | 'production') {
  localStorage.setItem(CONN_KEY, JSON.stringify({ mode }));
}

const demoCompanyWa: Channel = {
  id: 'ch_wa', kind: 'wa', owner: 'company', ownerId: 'company',
  displayName: 'WhatsApp', externalRef: '+38 000', status: 'online',
};
const realCompanyWa: Channel = {
  id: 'rc_wa', kind: 'wa', owner: 'company', ownerId: 'company',
  displayName: 'WhatsApp', externalRef: '+380671234567', status: 'online',
  instance: 'lc_wa_real',
};
const demoPersonalTg: Channel = {
  id: 'ch_p_tg1', kind: 'tg', owner: 'personal', ownerId: 'e1',
  displayName: 'Telegram · мій', externalRef: '@demo', status: 'online',
};
const realPersonalWa: Channel = {
  id: 'rp_wa', kind: 'wa', owner: 'personal', ownerId: 'e1',
  displayName: 'WhatsApp · мій', externalRef: 'lc_wa_mine', status: 'online',
  instance: 'lc_wa_mine',
};

function conv(id: string, channelId: string, unread = 1): Conversation {
  return {
    id, channelId, personal: false, contactName: `C-${id}`,
    unread, lastTs: Date.now(),
  } as Conversation;
}

function baseChannels(): Channel[] {
  return [demoCompanyWa, realCompanyWa, demoPersonalTg, realPersonalWa];
}

beforeEach(() => {
  localStorage.clear();
});

test('production: demo-канали (без instance) сховані з усіх списків', async () => {
  setMode('production');
  seedState({
    channels: baseChannels(),
    conversations: [conv('c_demo', 'ch_wa', 3), conv('c_real', 'rc_wa', 2)],
    messages: {},
    clicks: [],
    currentUserId: 'e1',
    employees: [{ id: 'e1', name: 'Test', initials: 'T' }],
    filters: { channel: 'all', attribution: 'all', tag: '' },
  });
  const store = await loadStore();
  const s = store.getState();

  const companyIds = store.companyChannels(s).map((c) => c.id);
  expect(companyIds).toEqual(['rc_wa']);

  // Особисті: реальний WA належить e1 → після входу власник має переїхати за email
  store.signInUser('alik2191@gmail.com');
  const s2 = store.getState();
  expect(s2.currentUserId).toBe('emp_alik2191@gmail.com');
  expect(store.myChannels(s2).map((c) => c.id)).toEqual(['rp_wa']);
  expect(store.visibleConversations(s2).map((c) => c.id)).toEqual(['c_real']);
  expect(store.totalUnread(s2)).toBe(2);
});

test('demo mode: усі канали та діалоги видимі', async () => {
  setMode('demo');
  seedState({
    channels: baseChannels(),
    conversations: [conv('c_demo', 'ch_wa', 3), conv('c_real', 'rc_wa', 2)],
    messages: {},
    clicks: [],
    currentUserId: 'e1',
    employees: [{ id: 'e1', name: 'Test', initials: 'T' }],
    filters: { channel: 'all', attribution: 'all', tag: '' },
  });
  const store = await loadStore();
  const s = store.getState();
  expect(store.companyChannels(s).map((c) => c.id)).toEqual(['ch_wa', 'rc_wa']);
  expect(store.myChannels(s).map((c) => c.id)).toEqual(['ch_p_tg1', 'rp_wa']);
});

test('normalizeChannelKinds: виправляє kind за префіксом інстанса (старі збірки писали tg для WA)', async () => {
  const store = await loadStore();
  const fixed = store.normalizeChannelKinds([
    { id: 'c1', kind: 'tg', owner: 'company', ownerId: 'company', displayName: 'Telegram', status: 'online', instance: 'lc_wa_abc' },
    { id: 'c2', kind: 'wa', owner: 'company', ownerId: 'company', displayName: 'WhatsApp', status: 'online', instance: 'lc_wa_def' },
    { id: 'c3', kind: 'tg', owner: 'personal', ownerId: 'e1', displayName: 'Telegram · мій', status: 'online', instance: 'tg-token-xyz' },
  ] as Channel[]);
  expect(fixed.map((c) => c.kind)).toEqual(['wa', 'wa', 'tg']);
  expect(fixed[0]!.displayName).toBe('WhatsApp');
  expect(fixed[2]!.displayName).toBe('Telegram · мій');
});

test('dedupeConversations: залишає один діалог на (канал, телефон), зливаючи непрочитані та повідомлення', async () => {
  const store = await loadStore();
  const s = {
    channels: [realCompanyWa],
    conversations: [
      { ...conv('c1', 'rc_wa', 2), phone: '380671234567', lastTs: 100 },
      { ...conv('c2', 'rc_wa', 3), phone: '380671234567', lastTs: 200 },
      { ...conv('c3', 'rc_wa', 5), phone: '380991112233', lastTs: 50 },
    ],
    messages: {
      c1: [{ id: 'm1', conversationId: 'c1', direction: 'in', body: 'старе', ts: 90 }],
      c2: [{ id: 'm2', conversationId: 'c2', direction: 'in', body: 'нове', ts: 190 }],
    },
  } as unknown as AppState;
  const [dedup, changed] = store.dedupeConversations(s);
  expect(changed).toBe(true);
  const same = dedup.conversations.filter((c) => c.phone === '380671234567');
  expect(same.length).toBe(1);
  expect(same[0]!.id).toBe('c2');
  expect(same[0]!.unread).toBe(5); // 2 + 3
  expect(dedup.messages['c2']!.map((m) => m.id)).toEqual(['m1', 'm2']);
  expect(dedup.conversations.length).toBe(2);
});

test('signInUser: виправляє розсинхрон currentUserId (userEmail задано, id застарілий)', async () => {
  setMode('demo');
  seedState({
    channels: [realPersonalWa],
    conversations: [],
    messages: {},
    clicks: [],
    currentUserId: 'e1',
    employees: [{ id: 'e1', name: 'Test', initials: 'T' }],
    userEmail: 'alik2191@gmail.com',
    filters: { channel: 'all', attribution: 'all', tag: '' },
  });
  const store = await loadStore();
  // розсинхрон: userEmail вже цей, але currentUserId залишився 'e1'
  store.signInUser('alik2191@gmail.com');
  const s = store.getState();
  expect(s.currentUserId).toBe('emp_alik2191@gmail.com');
  // особисті канали попереднього власника переходять за новим
  expect(store.myChannels(s).map((c) => c.id)).toEqual(['rp_wa']);
});
