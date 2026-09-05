import { ATTRIBUTION_FULL, ATTRIBUTION_LABEL } from '../lib/attribution';
import { exportGclidCsv } from '../lib/gclidExport';
import { useAppState } from '../lib/store';
import type { AppState } from '../lib/store';
import type { Attribution } from '../types';

const ATTRS: Attribution[] = ['exact', 'fallback', 'direct'];
const ATTR_COLORS: Record<Attribution, string> = {
  exact: 'var(--ok, #4ade80)',
  fallback: '#fbbf24',
  direct: 'var(--text-faint, #6b7280)',
};

function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export function AttributionView() {
  const s = useAppState();
  const company = s.conversations.filter((c) => !c.personal);
  const byAttr = (a: Attribution) => company.filter((c) => c.attribution === a).length;
  const total = company.length;
  const matched = byAttr('exact') + byAttr('fallback');

  // UTM-джерела та кампанії (по діалогах робочих каналів)
  const bySource = new Map<string, number>();
  const byCampaign = new Map<string, number>();
  for (const c of company) {
    const src = c.utmSource || '(без джерела)';
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
    const camp = c.utmCampaign || '(без кампанії)';
    byCampaign.set(camp, (byCampaign.get(camp) ?? 0) + 1);
  }
  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
  const campaigns = [...byCampaign.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxSrc = Math.max(1, ...sources.map(([, n]) => n));
  const maxCamp = Math.max(1, ...campaigns.map(([, n]) => n));

  const recentClicks = [...s.clicks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="view">
      <h2>Атрибуція</h2>
      <p className="view-sub">
        Звідки приходять звернення: метки з deep link (EXACT), матчинг за недавнім кліком (FALLBACK),
        решта — DIRECT. Дані живі: демо — із симулятора, прод — із реальних звернень.
      </p>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-num">{total}</span>
          <span className="stat-label">діалогів з робочих каналів</span>
        </div>
        <div className="stat-card accent">
          <span className="stat-num">{pct(matched, total)}</span>
          <span className="stat-label">атрибутовано (EX + FB)</span>
        </div>
        {ATTRS.map((a) => (
          <div key={a} className="stat-card">
            <span className="stat-num">{byAttr(a)}</span>
            <span className="stat-label" title={ATTRIBUTION_FULL[a]}>
              {ATTRIBUTION_LABEL[a]} · {a} — {pct(byAttr(a), total)}
            </span>
          </div>
        ))}
        <div className="stat-card">
          <span className="stat-num">{company.filter((c) => c.gclid).length}</span>
          <span className="stat-label">з GCLID (Google Ads)</span>
        </div>
      </div>

      <h3 className="section-title">ЯКІСТЬ АТРИБУЦІЇ</h3>
      <div className="stack-bar">
        {ATTRS.map((a) => (
          <div
            key={a}
            className="stack-seg"
            style={{ width: pct(byAttr(a), total || 1), background: ATTR_COLORS[a] }}
            title={`${ATTRIBUTION_FULL[a]}: ${byAttr(a)}`}
          />
        ))}
      </div>
      <div className="stack-legend">
        {ATTRS.map((a) => (
          <span key={a} className="stack-item">
            <i className="legend-dot" style={{ background: ATTR_COLORS[a] }} />
            {ATTRIBUTION_FULL[a]} — {byAttr(a)}
          </span>
        ))}
      </div>

      <h3 className="section-title">ДЖЕРЕЛА (UTM SOURCE)</h3>
      <div className="bars">
        {sources.length === 0 && <p className="hint">Ще немає звернень з робочих каналів.</p>}
        {sources.map(([src, n]) => (
          <div key={src} className="bar-row">
            <span className="bar-label">{src}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(n / maxSrc) * 100}%` }} />
            </div>
            <span className="bar-num">{n}</span>
          </div>
        ))}
      </div>

      <h3 className="section-title">ТОП КАМПАНІЙ (UTM CAMPAIGN)</h3>
      <table className="leads-table">
        <thead>
          <tr>
            <th>Кампанія</th>
            <th>Звернень</th>
            <th>Частка</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map(([camp, n]) => (
            <tr key={camp}>
              <td className="td-name mono">{camp}</td>
              <td>
                <div className="bar-inline">
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(n / maxCamp) * 100}%` }} />
                  </div>
                  <span className="bar-num">{n}</span>
                </div>
              </td>
              <td className="mono">{pct(n, total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="section-title">ОСТАННІ КЛІКИ З DEEP LINK</h3>
      <table className="leads-table">
        <thead>
          <tr>
            <th>click_id</th>
            <th>Канал</th>
            <th>Джерело</th>
            <th>Кампанія</th>
            <th>GCLID</th>
            <th>Час</th>
          </tr>
        </thead>
        <tbody>
          {recentClicks.length === 0 && (
            <tr>
              <td colSpan={6} className="hint">Кліків ще не було — лінки з метками поки не переходили.</td>
            </tr>
          )}
          {recentClicks.map((cl) => (
            <tr key={cl.clickId}>
              <td className="mono">#{cl.clickId}</td>
              <td>{cl.channelKind.toUpperCase()}</td>
              <td className="mono">{cl.utmSource ?? '—'}</td>
              <td className="mono">{cl.utmCampaign ?? '—'}</td>
              <td className="mono">{cl.gclid ? `${cl.gclid.slice(0, 10)}…` : '—'}</td>
              <td className="mono">{fmtTime(cl.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {company.some((c) => c.gclid) && (
        <button className="btn outline" onClick={() => exportGclidCsv(s)}>
          Експорт GCLID для Google Ads (CSV)
        </button>
      )}
    </div>
  );
}
