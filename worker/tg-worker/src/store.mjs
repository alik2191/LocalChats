import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.TG_DATA_DIR || '/home/node/data';
const SESSION_FILE = join(DATA_DIR, 'tg-session.enc');

/**
 * Шифрування StringSession на диску (AES-256-GCM).
 * Утечка файла без SESSION_ENCRYPTION_KEY не дає доступу до акаунта.
 */
function deriveKey(salt) {
  const key = process.env.SESSION_ENCRYPTION_KEY;
  if (!key || key.length < 64) {
    throw new Error('SESSION_ENCRYPTION_KEY має містити 32 байти (64 hex-символи)');
  }
  return scryptSync(Buffer.from(key, 'hex'), salt, 32);
}

export function loadSessionString() {
  if (!existsSync(SESSION_FILE)) return '';
  try {
    const box = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
    const salt = Buffer.from(box.salt, 'base64');
    const key = deriveKey(salt);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    // Пошкоджений файл або змінився ключ — безпечніше почати з нового логіна
    return '';
  }
}

export function saveSessionString(sessionString) {
  if (!sessionString) return;
  const salt = randomBytes(16);
  const key = deriveKey(salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(sessionString, 'utf8'), cipher.final()]);
  const box = {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64'),
  };
  // 0600: файл читає лише власник процесу (USER node)
  writeFileSync(SESSION_FILE, JSON.stringify(box), { mode: 0o600 });
}
