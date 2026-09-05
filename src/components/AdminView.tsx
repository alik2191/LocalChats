import { useState } from 'react';
import { attachWorkerInstances, companyChannels, removeChannel, startPairing, useAppState, currentEmployee, isSuperAdmin } from '../lib/store';
import { workerApi } from '../lib/worker';
import { SUPER_ADMINS } from '../lib/roles';
import {
  setMode,
  setWorker,
  setZoho,
  testWorker,
  testZoho,
  useConnections,
} from '../lib/connections';
import type { ConnectionStatus } from '../lib/connections';

function StatusPill({ st }: { st: ConnectionStatus }) {
  const cls = st.state === 'ok' ? 'online' : st.state === 'untested' ? 'offline' : 'err';
  const label = st.state === 'ok' ? 'працює' : st.state === 'auth_required' ? 'потрібен токен' : st.state === 'fail' ? 'помилка' : 'не перевірено';
  return (
    <span className="conn-line">
      <span className={`status-pill ${cls}`}>{label}</span>
      <span className="hint">{st.detail}</span>
    </span>
  );
}

export function AdminView() {
  const s = useAppState();
  const conn = useConnections();
  const company = companyChannels(s);
  const me = currentEmployee(s);
  const [showSecret, setShowSecret] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachMsg, setAttachMsg] = useState('');
  if (!isSuperAdmin(s)) return null;

  const attachSessions = async () => {
    setAttaching(true);
    setAttachMsg('');
    try {
      const instances = await workerApi.fetchInstances();
      attachWorkerInstances(instances);
      const claimed = instances.filter((i) => (i.connectionStatus ?? i.state) === 'open').length;
      setAttachMsg(
        `Воркер відповів: ${instances.length} інстанс(ів), відкритих: ${claimed}. Вільні відкриті сесії прив'язано до каналів (найраніша — особистий номер).`,
      );
    } catch (e) {
      setAttachMsg(`Помилка: ${(e as Error).message}`);
    } finally {
      setAttaching(false);
    }
  };

  return (
    <div className="view">
      <h2>Панель адміністратора</h2>
      <p className="view-sub">
        Тільки суперадмін. Тут підключаються робочі номери компанії — вони одразу стають видимі
        всім співробітникам. Особисті номери кожен підключає собі сам у розділі «Канали».
      </p>

      <h3 className="section-title">РОБОЧІ НОМЕРИ КОМПАНІЇ</h3>
      <div className="channel-grid">
        {company.map((ch) => (
          <div key={ch.id} className="channel-card">
            <div className="channel-card-head">
              <span className={`dot ${ch.status}`} />
              <div>
                <div className="channel-name">{ch.displayName}</div>
                <div className="channel-ref">{ch.externalRef}</div>
              </div>
              <button className="btn ghost small" onClick={() => removeChannel(ch.id)}>
                Відключити
              </button>
            </div>
            <div className="channel-card-foot">
              <span className={`status-pill ${ch.status}`}>
                {ch.status === 'online' ? 'онлайн' : 'офлайн'}
              </span>
              {ch.kind === 'wa' && (
                <span className="channel-risk">inbound-only: тільки відповіді клієнтам</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="connect-actions">
        <button className="btn primary" onClick={() => startPairing('wa', 'company')}>
          + Підключити робочий WhatsApp
        </button>
        <button className="btn outline" onClick={() => startPairing('tg', 'company')}>
          + Підключити робочий Telegram
        </button>
      </div>
      <p className="hint">
        Viber підключається безкоштовним ботом (вебхук) — додається адміністратором на етапі
        підключення Supabase. Особистий Viber неможливий: протокол закритий.
      </p>

      <h3 className="section-title">КОМАНДА</h3>
      <div className="settings-block">
        {s.employees.map((e) => {
          const personalCount = s.channels.filter((c) => c.owner === 'personal' && c.ownerId === e.id).length;
          const isMe = e.id === s.currentUserId;
          return (
            <div key={e.id} className="integration-row">
              <span>
                {e.name} {isMe && <b className="you-mark">— це ви</b>}
              </span>
              <span className="hint">
                особистих каналів: {personalCount}
              </span>
            </div>
          );
        })}
      </div>

      <h3 className="section-title">РЕЖИМ СИСТЕМИ</h3>
      <div className="settings-block">
        <div className="mode-row">
          <button
            className={`mode-card ${conn.mode === 'demo' ? 'active' : ''}`}
            onClick={() => setMode('demo')}
          >
            <b>ДЕМО</b>
            <span>Симуляція для тестів інтерфейсу: seed-дані, симулятор вхідних, фейковий QR.</span>
          </button>
          <button
            className={`mode-card ${conn.mode === 'production' ? 'active' : ''}`}
            onClick={() => setMode('production')}
            disabled={conn.workerStatus.state !== 'ok'}
            title={conn.workerStatus.state !== 'ok' ? 'Спершу підключіть воркер сесій' : undefined}
          >
            <b>ПРОДАКШЕН</b>
            <span>Реальні номери через воркер сесій та Zoho CRM. Симулятор вимкнено.</span>
          </button>
        </div>
        {conn.mode === 'production' && conn.workerStatus.state !== 'ok' && (
          <p className="warn-note">
            Продакшен активується лише після успішної перевірки воркера сесій — без нього реальні
            номери не працюють.
          </p>
        )}
        <p className="hint">
          Демо-режим залишається доступним завжди: перемикач не видаляє дані, а лише визначає
          джерело повідомлень. Конфігурація коннекторів зберігається локально у вашого браузера;
          у проді секрети переносяться в env (Vercel / воркер).
        </p>
      </div>

      <h3 className="section-title">КОНЕКТОР: ВОркер сесій (WhatsApp / Telegram номера)</h3>
      <div className="settings-block">
        <label className="settings-row">
          <span>Base URL (Evolution API-сумісний)</span>
          <input
            className="conn-input mono"
            placeholder="https://worker.example.com"
            value={conn.worker.baseUrl}
            onChange={(e) => setWorker({ baseUrl: e.target.value })}
          />
        </label>
        <label className="settings-row">
          <span>API-ключ воркера</span>
          <input
            className="conn-input mono"
            type={showSecret ? 'text' : 'password'}
            placeholder="••••••••"
            value={conn.worker.apiKey}
            onChange={(e) => setWorker({ apiKey: e.target.value })}
          />
        </label>
        <div className="settings-actions">
          <button className="btn outline" onClick={() => void testWorker()}>
            Перевірити зв'язок
          </button>
          <button className="btn outline" onClick={() => void attachSessions()} disabled={attaching}>
            {attaching ? "Прив'язка…" : "Прив'язати наявні сесії"}
          </button>
          <button className="btn ghost small" onClick={() => setShowSecret((v) => !v)}>
            {showSecret ? 'Приховати ключі' : 'Показати ключі'}
          </button>
        </div>
        {attachMsg && <p className="hint">{attachMsg}</p>}
        <StatusPill st={conn.workerStatus} />
        <p className="hint">
          Воркер — це Evolution API (WhatsApp) + gramjs (Telegram) на VPS/Fly.io. Він тримає
          QR-сесії та доставляє повідомлення. Без нього реальні номери підключити неможливо.
        </p>
      </div>

      <h3 className="section-title">КОНЕКТОР: ZOHO CRM</h3>
      <div className="settings-block">
        <label className="settings-row">
          <span>Дата-центр</span>
          <select
            className="employee-select"
            value={conn.zoho.dc}
            onChange={(e) => setZoho({ dc: e.target.value as 'zoho.eu' | 'zoho.com' })}
          >
            <option value="zoho.eu">zoho.eu (Україна/ЄС)</option>
            <option value="zoho.com">zoho.com</option>
          </select>
        </label>
        <label className="settings-row">
          <span>Client ID (Self Client)</span>
          <input
            className="conn-input mono"
            placeholder="1000.XXXXXXXX"
            value={conn.zoho.clientId}
            onChange={(e) => setZoho({ clientId: e.target.value })}
          />
        </label>
        <label className="settings-row">
          <span>Client Secret</span>
          <input
            className="conn-input mono"
            type={showSecret ? 'text' : 'password'}
            placeholder="••••••••"
            value={conn.zoho.clientSecret}
            onChange={(e) => setZoho({ clientSecret: e.target.value })}
          />
        </label>
        <div className="settings-actions">
          <button className="btn outline" onClick={() => void testZoho()}>
            Перевірити API
          </button>
        </div>
        <StatusPill st={conn.zohoStatus} />
        <p className="hint">
          Обмін коду на refresh_token виконує бекенд (redirect URI буде додано на етапі підключення
          Supabase-функцій). Клієнтський секрет не використовується у браузері напряму.
        </p>
      </div>

      <h3 className="section-title">ДОСТУП</h3>
      <div className="settings-block">
        <div className="integration-row">
          <span>Суперадміністратори</span>
          <span className="mono">{SUPER_ADMINS.join(', ')}</span>
        </div>
        <p className="hint">
          Суперадмін керує робочими номерами. Інші співробітники бачать робочі чати та підключають
          лише свої особисті номери — їх листування видно тільки власнику.
        </p>
      </div>
      {me && <span className="sr-only">{me.initials}</span>}
    </div>
  );
}
