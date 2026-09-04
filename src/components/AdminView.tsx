import { companyChannels, removeChannel, startPairing, useAppState, currentEmployee, isSuperAdmin } from '../lib/store';
import { SUPER_ADMINS } from '../lib/roles';

export function AdminView() {
  const s = useAppState();
  const company = companyChannels(s);
  const me = currentEmployee(s);
  if (!isSuperAdmin(s)) return null;

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
