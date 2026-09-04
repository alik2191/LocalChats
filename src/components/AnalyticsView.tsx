import { exportGclidCsv } from '../lib/gclidExport';
import { useAppState } from '../lib/store';

export function AnalyticsView() {
  const s = useAppState();
  const company = s.conversations.filter((c) => !c.personal);
  const byAttr = (a: string) => company.filter((c) => c.attribution === a).length;
  const withGclid = company.filter((c) => c.gclid).length;
  const unread = company.reduce((acc, c) => acc + c.unread, 0);

  const byChannel = (['wa', 'tg', 'viber'] as const).map((k) => ({
    kind: k,
    count: company.filter((c) => {
      const ch = s.channels.find((x) => x.id === c.channelId);
      return ch?.kind === k;
    }).length,
  }));
  const maxCh = Math.max(1, ...byChannel.map((b) => b.count));

  return (
    <div className="view">
      <h2>Аналітика</h2>
      <p className="view-sub">Звернення з робочих каналів за поточну сесію демо.</p>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-num">{company.length}</span>
          <span className="stat-label">усього діалогів</span>
        </div>
        <div className="stat-card accent">
          <span className="stat-num">{unread}</span>
          <span className="stat-label">непрочитаних</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{byAttr('exact')}</span>
          <span className="stat-label">exact</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{byAttr('fallback')}</span>
          <span className="stat-label">fallback</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{byAttr('direct')}</span>
          <span className="stat-label">direct</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{withGclid}</span>
          <span className="stat-label">лідів з GCLID</span>
        </div>
      </div>

      <h3 className="section-title">РОЗПОДІЛ ЗА КАНАЛАМИ</h3>
      <div className="bars">
        {byChannel.map((b) => (
          <div key={b.kind} className="bar-row">
            <span className="bar-label">{b.kind.toUpperCase()}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(b.count / maxCh) * 100}%` }} />
            </div>
            <span className="bar-num">{b.count}</span>
          </div>
        ))}
      </div>

      {withGclid > 0 && (
        <button className="btn outline" onClick={() => exportGclidCsv(s)}>
          Експорт GCLID для Google Ads (CSV)
        </button>
      )}
    </div>
  );
}
