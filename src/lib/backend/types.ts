import type { AppState } from '../store';

export type BackendKind = 'local' | 'supabase' | 'rest';

export interface RestBackendConfig {
  baseUrl: string;
  apiKey: string;
}

export interface BackendConfig {
  kind: BackendKind;
  rest?: RestBackendConfig;
}

export interface BackendHealth {
  ok: boolean;
  detail: string;
}

/**
 * Контракт шару даних консолі. UI і store залежать лише від цього інтерфейсу,
 * тому будь-яке сховище (localStorage, Supabase, власний REST-сервер, Firebase тощо)
 * підключається новим адаптером без змін екранів і бізнес-логіки.
 */
export interface DataBackend {
  readonly kind: BackendKind;
  /** Завантажити збережений стан (null — ще нічого не збережено). */
  load(): Promise<AppState | null>;
  /** Зберегти стан. Помилки не повинні ламати UI (fire-and-forget з боку store). */
  save(state: AppState): Promise<void>;
  /** Перевірка доступності для екрана «Налаштування». */
  health(): Promise<BackendHealth>;
}
