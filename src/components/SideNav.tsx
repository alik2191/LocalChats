import { isSuperAdmin, setView, totalUnread, useAppState } from '../lib/store';
import type { View } from '../lib/store';

export function SideNav() {
  const s = useAppState();
  const unread = totalUnread(s);
  const online = s.channels.filter((c) => c.status === 'online').length;
  const admin = isSuperAdmin(s);

  const items: Array<{ key: View; label: string; icon: string }> = [
    { key: 'inbox', label: 'Інбокс', icon: '✉' },
    { key: 'channels', label: 'Канали', icon: '⋮⋮' },
    ...(admin ? [{ key: 'admin' as View, label: 'Адмін', icon: '★' }] : []),
    { key: 'leads', label: 'Ліди', icon: '☰' },
    { key: 'attribution', label: 'Атрибуція', icon: '⌖' },
    { key: 'reports', label: 'Звіти', icon: '◔' },
    { key: 'settings', label: 'Налаштування', icon: '⚙' },
  ];

  return (
    <nav className="side-nav">
      {items.map((it) => (
        <button
          key={it.key}
          className={`nav-item ${s.view === it.key ? 'active' : ''}`}
          onClick={() => setView(it.key)}
        >
          <span className="nav-icon">{it.icon}</span>
          <span className="nav-label">{it.label}</span>
          {it.key === 'inbox' && unread > 0 && <span className="nav-badge">{unread}</span>}
          {it.key === 'channels' && <span className="nav-count">{online}</span>}
        </button>
      ))}
      <div className="nav-footer">
        <span className="nav-mode">режим: inbound-only</span>
      </div>
    </nav>
  );
}
