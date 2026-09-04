import type { AppState } from '../store';
import type { BackendHealth, DataBackend } from './types';

const STORAGE_KEY = 'localchats_console_v1';

/**
 * Локальний адаптер: стан живе в localStorage браузера.
 * Це і автономний режим, і офлайн-кеш для віддалених бекендів.
 */
export const localBackend: DataBackend = {
  kind: 'local',

  async load(): Promise<AppState | null> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as AppState;
    } catch {
      return null;
    }
  },

  async save(state: AppState): Promise<void> {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // сховище переповнене/заблоковане — сесія просто не збережеться
    }
  },

  async health(): Promise<BackendHealth> {
    try {
      localStorage.setItem('localchats_probe', '1');
      localStorage.removeItem('localchats_probe');
      return { ok: true, detail: 'localStorage доступний' };
    } catch {
      return { ok: false, detail: 'localStorage недоступний (приватний режим/квота)' };
    }
  },
};

/** Синхронне читання для початкової ініціалізації store (до першого рендера). */
export function loadLocalSync(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppState;
  } catch {
    return null;
  }
}
