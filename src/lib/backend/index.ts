import { getConnections } from '../connections';
import type { AppState } from '../store';
import { localBackend } from './local';
import { restBackend } from './rest';
import { supabaseBackend } from './supabase';
import type { BackendConfig, DataBackend } from './types';

export type { BackendConfig, BackendHealth, BackendKind, DataBackend } from './types';

/**
 * Активний адаптер визначається конфігом з'єднань (Налаштування → Архітектура даних).
 * localStorage завжди лишається офлайн-кешем, тому перемикання архітектури
 * не призводить до втрати даних.
 */
export function getBackend(config: BackendConfig): DataBackend {
  switch (config.kind) {
    case 'supabase':
      return supabaseBackend;
    case 'rest':
      return restBackend(config.rest ?? { baseUrl: '', apiKey: '' });
    case 'local':
    default:
      return localBackend;
  }
}

export function getActiveBackend(): DataBackend {
  return getBackend(getConnections().backend);
}

const SAVE_DEBOUNCE = 800;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingState: AppState | null = null;
// Ланцюжок гарантує строгий порядок записів: повільний запит не «обжене» пізніший
let saveChain: Promise<void> = Promise.resolve();

function enqueueSave(state: AppState) {
  saveChain = saveChain
    .then(() => getActiveBackend().save(state))
    .catch(() => {
      // бекенд недоступний — локальний кеш усе рівно зберігся
    });
}

/** Debounce-збереження в активний віддалений бекенд (localStorage пише сам store). */
export function scheduleRemoteSave(state: AppState) {
  if (getActiveBackend().kind === 'local') return;
  pendingState = state;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const snapshot = pendingState;
    pendingState = null;
    if (snapshot) enqueueSave(snapshot);
  }, SAVE_DEBOUNCE);
}

export function cancelRemoteSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingState = null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Перевірка форми віддаленого стану: сумнівні/пошкоджені поля відкидаємо,
 * щоб помилковий payload не зламав рендер і не перезаписав локальний стан.
 */
function sanitizeRemote(remote: unknown): Partial<AppState> | null {
  if (!isPlainObject(remote)) return null;
  const clean: Record<string, unknown> = {};
  if (Array.isArray(remote.employees)) clean.employees = remote.employees;
  if (Array.isArray(remote.channels)) clean.channels = remote.channels;
  if (Array.isArray(remote.conversations)) clean.conversations = remote.conversations;
  if (isPlainObject(remote.messages)) clean.messages = remote.messages;
  if (Array.isArray(remote.clicks)) clean.clicks = remote.clicks;
  if (typeof remote.currentUserId === 'string' && remote.currentUserId) {
    clean.currentUserId = remote.currentUserId;
  }
  return Object.keys(clean).length > 0 ? (clean as Partial<AppState>) : null;
}

/**
 * Злити віддалений стан із локальним: валідні дані беруться з бекенду,
 * локальні налаштування UI (фільтри, вид, вибраний діалог, симулятор) лишаються.
 */
export function mergeRemote(local: AppState, remote: unknown): AppState {
  const clean = sanitizeRemote(remote);
  if (!clean) return local;
  const merged: AppState = { ...local };
  for (const [key, value] of Object.entries(clean)) {
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}
