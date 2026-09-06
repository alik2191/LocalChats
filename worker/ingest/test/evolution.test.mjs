// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { extractText, isChatIgnored, mapUpsertPayload } from '../src/evolution.mjs';

const WA_OK = '110600407498928@s.whatsapp.net';

function payload(overrides = {}) {
  return {
    event: 'messages.upsert',
    instance: 'lc_wa_mtovgqj5',
    data: {
      key: { remoteJid: WA_OK, fromMe: false, id: '3EB0TEST1' },
      message: { conversation: 'Привіт, цікавить квартира' },
      messageTimestamp: 1709550600,
      pushName: 'Оксана',
    },
    ...overrides,
  };
}

describe('extractText', () => {
  test('conversation / extendedTextMessage / caption', () => {
    expect(extractText({ conversation: 'hello' })).toBe('hello');
    expect(extractText({ extendedTextMessage: { text: 'reply text' } })).toBe('reply text');
    expect(extractText({ imageMessage: { caption: 'фото планування' } })).toBe('фото планування');
    expect(extractText({ videoMessage: { caption: 'video cap' } })).toBe('video cap');
    expect(extractText({ documentMessage: { caption: 'doc cap' } })).toBe('doc cap');
  });

  test('нема тексту → порожній рядок', () => {
    expect(extractText({ imageMessage: { url: 'https://…' } })).toBe('');
    expect(extractText(undefined)).toBe('');
  });
});

describe('isChatIgnored', () => {
  test('групи, розсилки, статус — ігноруємо; 1:1 і @lid — ні', () => {
    expect(isChatIgnored('120363@g.us')).toBe(true);
    expect(isChatIgnored('status@broadcast')).toBe(true);
    expect(isChatIgnored('123@newsletter')).toBe(true);
    expect(isChatIgnored(WA_OK)).toBe(false);
    expect(isChatIgnored('110600407498928@lid')).toBe(false);
  });
});

describe('mapUpsertPayload', () => {
  test('валідний payload → нормалізоване повідомлення (вхідне)', () => {
    const out = mapUpsertPayload(payload());
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      instance: 'lc_wa_mtovgqj5',
      chat: WA_OK,
      externalId: 'wa:lc_wa_mtovgqj5:3EB0TEST1',
      direction: 'in',
      body: 'Привіт, цікавить квартира',
      tsMs: 1709550600 * 1000,
      pushName: 'Оксана',
    });
  });

  test('fromMe: true → direction out (evolution#1340: свої повідомлення теж у upsert)', () => {
    const out = mapUpsertPayload(
      payload({ data: { key: { remoteJid: WA_OK, fromMe: true, id: 'X2' }, message: { conversation: 'відповідь' }, messageTimestamp: 1, pushName: null } }),
    );
    expect(out[0].direction).toBe('out');
  });

  test('data як масив (батч) → N повідомлень', () => {
    const arr = [
      { key: { remoteJid: WA_OK, fromMe: false, id: 'A1' }, message: { conversation: 'one' }, messageTimestamp: 1 },
      { key: { remoteJid: WA_OK, fromMe: false, id: 'A2' }, message: { conversation: 'two' }, messageTimestamp: 2 },
    ];
    expect(mapUpsertPayload(payload({ data: arr }))).toHaveLength(2);
  });

  test('група/статус/пусте тіло/нема key.id → пропуск', () => {
    expect(mapUpsertPayload(payload({ data: { key: { remoteJid: '120363@g.us', fromMe: false, id: 'G1' }, message: { conversation: 'spam' }, messageTimestamp: 1 } }))).toHaveLength(0);
    expect(mapUpsertPayload(payload({ data: { key: { remoteJid: 'status@broadcast', fromMe: false, id: 'S1' }, message: { conversation: 'x' }, messageTimestamp: 1 } }))).toHaveLength(0);
    expect(mapUpsertPayload(payload({ data: { key: { remoteJid: WA_OK, fromMe: false, id: 'E1' }, message: { imageMessage: { url: 'x' } }, messageTimestamp: 1 } }))).toHaveLength(0);
    expect(mapUpsertPayload(payload({ data: { key: { remoteJid: WA_OK, fromMe: false }, message: { conversation: 'no id' }, messageTimestamp: 1 } }))).toHaveLength(0);
  });

  test('інші події (messages.update тощо) → пусто', () => {
    expect(mapUpsertPayload(payload({ event: 'messages.update' }))).toHaveLength(0);
    expect(mapUpsertPayload(payload({ event: 'connection.update', data: { state: 'open' } }))).toHaveLength(0);
  });
});
