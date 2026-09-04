import { useEffect, useState } from 'react';
import {
  companyChannels,
  currentEmployee,
  resetDemo,
  simulateIncoming,
  switchUser,
  toggleSimulator,
  totalUnread,
  useAppState,
} from '../lib/store';
import { supabase } from '../lib/supabase';
import { useConnections } from '../lib/connections';

const KIND_DOT: Record<string, string> = { wa: '#34c759', tg: '#3b82f6', viber: '#a78bfa' };

export function TopBar({ userEmail }: { userEmail?: string }) {
  const s = useAppState();
  const conn = useConnections();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const me = currentEmployee(s);
  const unread = totalUnread(s);
  const clock = now.toLocaleTimeString('uk-UA', { hour12: false });

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">LOCALCHATS</span>
        <span className="brand-sub">SALES CONSOLE · v1.5-UA</span>
      </div>

      <div className="topbar-center">
        <div className="ch-dots" title="Статус робочих каналів">
          {companyChannels(s).map((c) => (
            <span key={c.id} className={`dot ${c.status}`} style={{ background: KIND_DOT[c.kind] }} />
          ))}
        </div>
        {unread > 0 && <span className="unread-total">{unread}</span>}
        <span className={`mode-badge ${conn.mode === 'production' ? 'prod' : 'demo'}`}>
          {conn.mode === 'production' ? 'ПРОД' : 'ДЕМО'}
        </span>
        {conn.mode === 'demo' ? (
          <>
            <label className="sim-toggle-wrap">
              <span className="sim-label">СИМУЛЯТОР ВХІДНИХ</span>
              <button
                className={`switch ${s.simulatorOn ? 'on' : ''}`}
                onClick={toggleSimulator}
                aria-label="Симулятор вхідних"
              />
            </label>
            <button className="btn ghost small" onClick={() => simulateIncoming()} disabled={!s.simulatorOn}>
              Згенерувати
            </button>
          </>
        ) : (
          <span className="sim-label">реальні дані · воркер сесій</span>
        )}
      </div>

      <div className="topbar-right">
        <span className="clock">{clock}</span>
        <select
          className="employee-select"
          value={s.currentUserId}
          onChange={(e) => switchUser(e.target.value)}
          aria-label="Поточний менеджер"
        >
          {s.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button className="btn outline" onClick={resetDemo}>
          Скинути демо
        </button>
        {userEmail && <span className="user-chip">{userEmail}</span>}
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>
          Вийти
        </button>
      </div>
      {me && <span className="sr-only">{me.initials}</span>}
    </header>
  );
}
