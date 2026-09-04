import { useSyncExternalStore } from 'react';
import type { BackendConfig } from './backend/types';

export type WorkMode = 'demo' | 'production';

export interface WorkerConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ZohoConfig {
  dc: 'zoho.eu' | 'zoho.com';
  clientId: string;
  clientSecret: string;
}

export interface ConnectionStatus {
  state: 'untested' | 'ok' | 'fail' | 'auth_required';
  detail: string;
  checkedAt?: number;
}

export interface Connections {
  mode: WorkMode;
  worker: WorkerConfig;
  zoho: ZohoConfig;
  /** Архітектура шару даних: localStorage / Supabase / довільний REST-сервер. */
  backend: BackendConfig;
  workerStatus: ConnectionStatus;
  zohoStatus: ConnectionStatus;
}

const STORAGE_KEY = 'localchats_connections_v1';

const initial: Connections = {
  mode: 'demo',
  worker: { baseUrl: '', apiKey: '' },
  zoho: { dc: 'zoho.eu', clientId: '', clientSecret: '' },
  backend: { kind: 'local' },
  workerStatus: { state: 'untested', detail: 'не перевірено' },
  zohoStatus: { state: 'untested', detail: 'не перевірено' },
};

function load(): Connections {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initial;
    return { ...initial, ...(JSON.parse(raw) as Connections) };
  } catch {
    return initial;
  }
}

let state: Connections = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function update(fn: (c: Connections) => Connections) {
  state = fn(state);
  persist();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useConnections(): Connections {
  return useSyncExternalStore(subscribe, () => state);
}

export function getConnections(): Connections {
  return state;
}

export function setMode(mode: WorkMode) {
  update((c) => ({ ...c, mode }));
}

export function setWorker(worker: Partial<WorkerConfig>) {
  update((c) => ({ ...c, worker: { ...c.worker, ...worker } }));
}

export function setZoho(zoho: Partial<ZohoConfig>) {
  update((c) => ({ ...c, zoho: { ...c.zoho, ...zoho } }));
}

export function setBackend(backend: Partial<BackendConfig>) {
  update((c) => {
    const rest = backend.rest ?? c.backend.rest;
    return {
      ...c,
      backend: {
        kind: backend.kind ?? c.backend.kind,
        ...(rest ? { rest } : {}),
      },
    };
  });
}

async function probe(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Evolution API-сумісний воркер сесій: перевіряємо базовий статус */
export async function testWorker() {
  const { baseUrl, apiKey } = state.worker;
  if (!baseUrl) {
    update((c) => ({ ...c, workerStatus: { state: 'fail', detail: 'вкажіть URL воркера' } }));
    return;
  }
  try {
    const res = await probe(`${baseUrl.replace(/\/$/, '')}/instance/fetchInstances`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      update((c) => ({
        ...c,
        workerStatus: { state: 'ok', detail: `зв'язок встановлено (HTTP ${res.status})`, checkedAt: Date.now() },
      }));
    } else {
      update((c) => ({
        ...c,
        workerStatus: { state: 'auth_required', detail: `воркер відповів HTTP ${res.status} — перевірте ключ`, checkedAt: Date.now() },
      }));
    }
  } catch {
    update((c) => ({
      ...c,
      workerStatus: { state: 'fail', detail: 'воркер недоступний (мережа/URL)', checkedAt: Date.now() },
    }));
  }
}

/**
 * Zoho: фінальний OAuth-обмін робить бекенд (redirect URI). Тут перевіряємо
 * досяжність API та валідність регіону — відповідь 401 означає «доступно, потрібен токен».
 */
export async function testZoho() {
  const { dc } = state.zoho;
  try {
    const res = await probe(`https://www.${dc}/crm/v6/settings/fields?module=Leads`);
    if (res.status === 401) {
      update((c) => ({
        ...c,
        zohoStatus: { state: 'auth_required', detail: `API ${dc} доступний — потрібен OAuth-токен (бекенд)`, checkedAt: Date.now() },
      }));
    } else if (res.ok) {
      update((c) => ({
        ...c,
        zohoStatus: { state: 'ok', detail: `API ${dc} відповів`, checkedAt: Date.now() },
      }));
    } else {
      update((c) => ({
        ...c,
        zohoStatus: { state: 'fail', detail: `HTTP ${res.status}`, checkedAt: Date.now() },
      }));
    }
  } catch {
    update((c) => ({
      ...c,
      zohoStatus: { state: 'fail', detail: 'Zoho API недоступний (мережа/CORS)', checkedAt: Date.now() },
    }));
  }
}

/** Прод-режим активний лише коли принаймні воркер реально відповідає */
export function isProductionReady(c: Connections): boolean {
  return c.mode === 'production' && c.workerStatus.state === 'ok';
}
