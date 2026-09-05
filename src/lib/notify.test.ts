import { expect, test } from 'vitest';
import { detectNewIncoming } from './notify';
import type { Conversation, Message } from '../types';

const conv = { id: 'c1', channelId: 'ch1', contactName: 'Оксана' } as Conversation;

test('detectNewIncoming: лише вхідні, seen оновлюється, повторний виклик порожній', () => {
  const messages: Record<string, Message[]> = {
    c1: [
      { id: 'm1', conversationId: 'c1', direction: 'in', body: 'привіт', ts: 1, status: 'delivered' },
      { id: 'm2', conversationId: 'c1', direction: 'out', body: 'відповідь', ts: 2, status: 'sent' },
    ],
  };
  const seen = new Set<string>();
  const first = detectNewIncoming([conv], messages, { ch1: 'wa' }, seen);
  expect(first.length).toBe(1);
  expect(first[0]).toMatchObject({ id: 'm1', name: 'Оксана', kind: 'wa' });
  const second = detectNewIncoming([conv], messages, { ch1: 'wa' }, seen);
  expect(second.length).toBe(0);
});
