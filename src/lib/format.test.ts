import { expect, test } from 'vitest';
import { avatarHue, formatPhone, initials } from './format';

test('formatPhone: український номер +38', () => {
  expect(formatPhone('380671234567')).toBe('+38 067 123 45 67');
});

test('formatPhone: польський номер +48', () => {
  expect(formatPhone('48794576148')).toBe('+48 794 576 148');
});

test('formatPhone: невідомий формат — групування по 3', () => {
  expect(formatPhone('1234567890')).toBe('+1 234 567 890');
});

test('formatPhone: вже з плюсом/пробілами — не ламає', () => {
  expect(formatPhone('+38 067 123 45 67')).toBe('+38 067 123 45 67');
});

test('formatPhone: порожнє/сміття — як є', () => {
  expect(formatPhone('')).toBe('');
  expect(formatPhone('@taras_l')).toBe('@taras_l');
});

test('initials: імʼя та прізвище', () => {
  expect(initials('Оксана Білик')).toBe('ОБ');
  expect(initials('Одне слово')).toBe('ОС');
  expect(initials('')).toBe('??');
});

test('avatarHue: детермінований відтінок 0..359', () => {
  const h1 = avatarHue('Оксана');
  expect(h1).toBeGreaterThanOrEqual(0);
  expect(h1).toBeLessThan(360);
  expect(avatarHue('Оксана')).toBe(h1);
  expect(avatarHue('Інше імʼя')).not.toBe(h1);
});
