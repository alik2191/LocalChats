// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { mapBackfillRows } from '../src/backfill.mjs';

// Реальна форма рядка Message з Postgres Evolution (перевірено живим запитом:
// key/message — jsonb, messageTimestamp — integer, секунди; sessionId — інстанс)
const row = {
  id: '3EB0TEST1',
  sessionId: 'lc_wa_mtovgqj5',
  key: { remoteJid: '110600407498928@lid', fromMe: false, id: '3EB0TEST1' },
  message: { conversation: 'історичне повідомлення' },
  messageTimestamp: 1709550600,
  pushName: 'Оксана',
  messageType: 'conversation',
};

describe('mapBackfillRows', () => {
  test('валідний рядок Message → нормалізоване повідомлення', () => {
    const out = mapBackfillRows([row]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      instance: 'lc_wa_mtovgqj5',
      chat: '110600407498928@lid',
      externalId: 'wa:lc_wa_mtovgqj5:3EB0TEST1',
      direction: 'in',
      body: 'історичне повідомлення',
      tsMs: 1709550600 * 1000,
      pushName: 'Оксана',
    });
  });

  test('групи, пусті тіла, рядки без sessionId/key пропускаються', () => {
    const out = mapBackfillRows([
      { ...row, key: { ...row.key, remoteJid: '120363@g.us' } },
      { ...row, message: { imageMessage: { url: 'x' } } },
      { ...row, sessionId: null },
      { ...row, key: null },
      null,
    ]);
    expect(out).toHaveLength(0);
  });

  test('дедуп за external_id у межах батча', () => {
    const out = mapBackfillRows([row, { ...row }]);
    expect(out).toHaveLength(1);
  });
});
