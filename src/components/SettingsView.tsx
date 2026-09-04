import { exportGclidCsv } from '../lib/gclidExport';
import { currentEmployee, resetDemo, switchUser, toggleSimulator, useAppState } from '../lib/store';

export function SettingsView() {
  const s = useAppState();
  const me = currentEmployee(s);

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
