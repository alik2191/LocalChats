import { useState } from 'react';
import { exportGclidCsv } from '../lib/gclidExport';
import { getBackend } from '../lib/backend';
import { setBackend, useConnections } from '../lib/connections';
import { currentEmployee, pullRemoteState, resetDemo, switchUser, toggleSimulator, useAppState } from '../lib/store';

const BACKEND_LABELS: Record<string, string> = {
  local: 'Локально (localStorage)',
  supabase: 'Supabase (хмара, за користувачем)',
  rest: 'Власний REST-сервер',
};

export function SettingsView() {
  const s = useAppState();
  const conn = useConnections();
  const me = currentEmployee(s);
  const [backendCheck, setBackendCheck] = useState<string>('');

  const checkBackend = async () => {
    setBackendCheck('перевіряємо…');
    const res = await getBackend(conn.backend).health();
    setBackendCheck(`${res.ok ? '✓' : '✗'} ${res.detail}`);
  };

  const pullFromBackend = async () => {
    setBackendCheck('завантажуємо…');
    const pulled = await pullRemoteState();
    setBackendCheck(pulled ? '✓ стан завантажено з бекенду' : '✗ бекенд не повернув стан (ще нічого не збережено або помилка)');
  };

  return (
    <div className="view narrow">
      <h2>Налаштування</h2>
      <p className="view-sub">Керування консоллю та статус інтеграцій.</p>

      <h3 className="section-title">КОРИСТУВАЧ</h3>
      <div className="settings-block">
        <label className="settings-row">
          <span>Поточний менеджер</span>
          <select
            className="employee-select"
            value={s.currentUserId}
            onChange={(e) => switchUser(e.target.value)}
          >
            {s.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        {me && <p className="hint">Увійшли як {me.name}. Особисті номери прив'язуються до користувача.</p>}
      </div>

      <h3 className="section-title">ДЕМО</h3>
      <div className="settings-block">
        <label className="settings-row">
          <span>Симулятор вхідних</span>
          <button className={`switch ${s.simulatorOn ? 'on' : ''}`} onClick={toggleSimulator} />
        </label>
        <div className="settings-actions">
          <button className="btn outline" onClick={resetDemo}>
            Скинути демо
          </button>
          {s.conversations.some((c) => !c.personal && c.gclid) && (
            <button className="btn outline" onClick={() => exportGclidCsv(s)}>
              Експорт GCLID (CSV)
            </button>
          )}
        </div>
      </div>

      <h3 className="section-title">АРХІТЕКТУРА ДАНИХ</h3>
      <div className="settings-block">
        <label className="settings-row">
          <span>Сховище даних консолі</span>
          <select
            className="employee-select"
            value={conn.backend.kind}
            onChange={(e) => setBackend({ kind: e.target.value as typeof conn.backend.kind })}
          >
            <option value="local">{BACKEND_LABELS.local}</option>
            <option value="supabase">{BACKEND_LABELS.supabase}</option>
            <option value="rest">{BACKEND_LABELS.rest}</option>
          </select>
        </label>
        <p className="hint">
          localStorage завжди лишається офлайн-кешем: перемикання архітектури не втрачає дані.
          Для Supabase стан зберігається за обліковим записом (таблиця app_state, RLS).
        </p>
        {conn.backend.kind === 'rest' && (
          <>
            <label className="settings-row">
              <span>URL сервера</span>
              <input
                className="conn-input"
                placeholder="https://api.example.ua"
                value={conn.backend.rest?.baseUrl ?? ''}
                onChange={(e) => setBackend({ rest: { baseUrl: e.target.value, apiKey: conn.backend.rest?.apiKey ?? '' } })}
              />
            </label>
            <label className="settings-row">
              <span>API-ключ (Bearer)</span>
              <input
                className="conn-input"
                type="password"
                placeholder="необов'язково"
                value={conn.backend.rest?.apiKey ?? ''}
                onChange={(e) => setBackend({ rest: { baseUrl: conn.backend.rest?.baseUrl ?? '', apiKey: e.target.value } })}
              />
            </label>
            <p className="hint">Контракт: GET /state → JSON стану (або 204), PUT /state ← JSON стану. Деталі — docs/backend-adapters.md.</p>
          </>
        )}
        <div className="settings-actions">
          <button className="btn outline" onClick={checkBackend}>
            Перевірити зʼєднання
          </button>
          {conn.backend.kind !== 'local' && (
            <button className="btn outline" onClick={pullFromBackend}>
              Завантажити стан з бекенду
            </button>
          )}
        </div>
        {backendCheck && <p className="hint">{backendCheck}</p>}
      </div>

      <h3 className="section-title">ІНТЕГРАЦІЇ</h3>
      <div className="settings-block">
        <div className="integration-row">
          <span>Сесії месенджерів (воркер)</span>
          <span className="status-pill offline">етап 2 · очікує VPS</span>
        </div>
        <div className="integration-row">
          <span>Supabase (база + Realtime)</span>
          <span className="status-pill offline">етап 2 · схема готова</span>
        </div>
        <div className="integration-row">
          <span>Zoho CRM</span>
          <span className="status-pill offline">очікує OAuth</span>
        </div>
        <div className="integration-row">
          <span>Google Ads офлайн-конверсії</span>
          <span className="status-pill offline">ручний експорт CSV</span>
        </div>
      </div>

      <h3 className="section-title">ПОЛІТИКА РОБОТИ</h3>
      <div className="settings-block">
        <p className="hint">
          Консоль працює в режимі <b>inbound-only</b>: масові розсилки не передбачені. Відповіді —
          лише на вхідні звернення клієнтів. Це свідоме рішення для мінімізації ризику банів номерів.
        </p>
      </div>
    </div>
  );
}
