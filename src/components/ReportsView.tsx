import { channelById, companyConversations, useAppState } from '../lib/store';

const DAY_MS = 86400000;
const DAYS = 14;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function ReportsView() {
  const s = useAppState();
  const company = companyConversations(s);
  const companyMsgs = s.messages
    ? Object.values(s.messages).flat().filter((m) => company.some((c) => c.id === m.conversationId))
    : [];

  // Активність за 14 днів: вхідні/вихідні
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: DAYS }, (_, i) => {
    const start = today.getTime() - (DAYS - 1 - i) * DAY_MS;
    const end = start + DAY_MS;
    const inCount = companyMsgs.filter((m) => m.direction === 'in' && m.ts >= start && m.ts < end).length;
    const outCount = companyMsgs.filter((m) => m.direction === 'out' && m.ts >= start && m.ts < end).length;
    return { start, inCount, outCount };
  });
  const maxDay = Math.max(1, ...days.map((d) => d.inCount + d.outCount));

  // Середній час першої відповіді
  const responseTimes: number[] = [];
  for (const conv of company) {
    const msgs = companyMsgs
      .filter((m) => m.conversationId === conv.id)
      .sort((a, b) => a.ts - b.ts);
    const firstIn = msgs.find((m) => m.direction === 'in');
    const firstOut = msgs.find((m) => m.direction === 'out' && firstIn && m.ts > firstIn.ts);
    if (firstIn && firstOut) responseTimes.push(firstOut.ts - firstIn.ts);
  }
  const avgResponseMin = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length / 60000)
    : null;

  const inTotal = companyMsgs.filter((m) => m.direction === 'in').length;
  const outTotal = companyMsgs.filter((m) => m.direction === 'out').length;

  // Канали
  const byChannel = (['wa', 'tg', 'viber'] as const).map((k) => ({
    kind: k,
    count: company.filter((c) => channelById(s, c.channelId)?.kind === k).length,
    online: s.channels.filter((c) => c.kind === k && c.status === 'online').length,
  }));
  const maxCh = Math.max(1, ...byChannel.map((b) => b.count));

  // Найдієвші контакти (за кількістю повідомлень у робочих діалогах)
  const byContact = company
    .map((c) => ({
      name: c.contactName,
      count: companyMsgs.filter((m) => m.conversationId === c.id).length,
      conv: c,
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const maxContact = Math.max(1, ...byContact.map((e) => e.count));

  const fmtDay = (ts: number) =>
    new Date(ts).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });

  return (
    <div className="view">
      <h2>Звіти</h2>
      <p className="view-sub">
        Активність за 14 днів по робочих каналах. У демо — статистика симулятора, у проді — реальні
        повідомлення.
      </p>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-num">{company.length}</span>
          <span className="stat-label">діалогів</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{inTotal}</span>
          <span className="stat-label">вхідних повідомлень</span>
        </div>
        <div className="stat-card accent">
          <span className="stat-num">{outTotal}</span>
          <span className="stat-label">відповідей надіслано</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{avgResponseMin !== null ? `${avgResponseMin} хв` : '—'}</span>
          <span className="stat-label">середня перша відповідь</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">
            {s.channels.filter((c) => c.status === 'online').length}/{s.channels.length}
          </span>
          <span className="stat-label">каналів онлайн</span>
        </div>
      </div>

      <h3 className="section-title">АКТИВНІСТЬ ЗА 14 ДНІВ</h3>
      <div className="col-chart">
        {days.map((d) => {
          const totalH = ((d.inCount + d.outCount) / maxDay) * 100;
          const outShare = d.inCount + d.outCount ? (d.outCount / (d.inCount + d.outCount)) * 100 : 0;
          return (
            <div key={d.start} className="col-day" title={`${fmtDay(d.start)}: вхідні ${d.inCount}, відповіді ${d.outCount}`}>
              <div className="col-track">
                <div className="col-fill" style={{ height: `${totalH}%` }}>
                  <div className="col-out" style={{ height: `${outShare}%` }} />
                </div>
              </div>
              <span className="col-num">{d.inCount + d.outCount > 0 ? d.inCount + d.outCount : ''}</span>
              <span className="col-label">{fmtDay(d.start).slice(0, 5)}</span>
            </div>
          );
        })}
      </div>
      <div className="stack-legend">
        <span className="stack-item"><i className="legend-dot dim" />вхідні</span>
        <span className="stack-item"><i className="legend-dot accent" />відповіді</span>
      </div>

      <h3 className="section-title">РОЗПОДІЛ ЗА КАНАЛАМИ</h3>
      <div className="bars">
        {byChannel.map((b) => (
          <div key={b.kind} className="bar-row">
            <span className="bar-label">{b.kind.toUpperCase()}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(b.count / maxCh) * 100}%` }} />
            </div>
            <span className="bar-num">
              {b.count} <span className="hint">({b.online} онлайн)</span>
            </span>
          </div>
        ))}
      </div>

      {byContact.length > 0 && (
        <>
          <h3 className="section-title">НАЙАКТИВНІШІ КОНТАКТИ</h3>
          <div className="bars">
            {byContact.map((c) => (
              <div key={c.conv.id} className="bar-row">
                <span className="bar-label">{c.name}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(c.count / maxContact) * 100}%` }} />
                </div>
                <span className="bar-num">{c.count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
