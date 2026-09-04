import type { AppState } from '../store';
import type { BackendHealth, DataBackend, RestBackendConfig } from './types';

const TIMEOUT = 10000;

/**
 * Універсальний REST-адаптер: будь-який сервер (власний бекенд, VPS, serverless),
 * що реалізує два ендпоінти:
 *
 *   GET  {baseUrl}/state   → 200 + JSON стану | 204, якщо стану ще немає
 *   PUT  {baseUrl}/state   → 2xx, тіло = JSON стану
 *
 * Авторизація: заголовок Authorization: Bearer <apiKey> (якщо ключ задано).
 */
export function restBackend(config: RestBackendConfig): DataBackend {
  const base = config.baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  async function req(path: string, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      return await fetch(`${base}${path}`, { ...init, headers, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  return {
    kind: 'rest',

    async load(): Promise<AppState | null> {
      const res = await req('/state');
      if (res.status === 204) return null;
      if (!res.ok) throw new Error(`GET /state → HTTP ${res.status}`);
      return (await res.json()) as AppState;
    },

    async save(state: AppState): Promise<void> {
      const res = await req('/state', { method: 'PUT', body: JSON.stringify(state) });
      if (!res.ok) throw new Error(`PUT /state → HTTP ${res.status}`);
    },

    async health(): Promise<BackendHealth> {
      if (!config.baseUrl) return { ok: false, detail: 'вкажіть URL сервера' };
      try {
        const res = await req('/state');
        if (res.ok || res.status === 204) {
          return { ok: true, detail: `сервер відповів (HTTP ${res.status === 204 ? 204 : res.status})` };
        }
        if (res.status === 401 || res.status === 403) {
          return { ok: false, detail: `авторизація не пройдена (HTTP ${res.status}) — перевірте ключ` };
        }
        return { ok: false, detail: `HTTP ${res.status}` };
      } catch {
        return { ok: false, detail: 'сервер недоступний (мережа/URL/CORS)' };
      }
    },
  };
}
