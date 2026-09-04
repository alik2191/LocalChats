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

/** Debounce-збереження в активний віддалений бекенд (localStorage пише сам store). */
export function scheduleRemoteSave(state: AppState) {
  if (getActiveBackend().kind === 'local') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void getActiveBackend().save(state).catch(() => {
      // бекенд недоступний — локальний кеш усе рівно зберігся
    });
  }, SAVE_DEBOUNCE);
}

export function cancelRemoteSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

/** Поля, які описують дані, а не локальні налаштування інтерфейсу. */
const DATA_FIELDS = ['employees', 'currentUserId', 'channels', 'conversations', 'messages', 'clicks'] as const;

/**
 * Злити віддалений стан із локальним: дані беруться з бекенду,
 * локальні налаштування UI (фільтри, вид, вибраний діалог, симулятор) лишаються.
 */
export function mergeRemote(local: AppState, remote: AppState): AppState {
  const merged: AppState = { ...local };
  for (const f of DATA_FIELDS) {
    const v: unknown = remote[f];
    if (v !== undefined) {
      (merged as unknown as Record<string, unknown>)[f] = v;
    }
  }
  return merged;
}
