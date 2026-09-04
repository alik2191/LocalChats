import type { AppState } from './store';

const KYIV_TZ = 'Europe/Kyiv';

function kyivTime(ts: number): string {
  // Google Ads offline conversions ждут время в таймзоне из Parameters
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: KYIV_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** Экспорт GCLID для ручного импорта офлайн-конверсий в Google Ads */
export function exportGclidCsv(s: AppState) {
  const rows = s.conversations
    .filter((c) => !c.personal && c.gclid)
    .sort((a, b) => a.lastTs - b.lastTs)
    .map((c) =>
      [
        c.gclid,
        'LeadMessenger',
        kyivTime(c.lastTs),
        '0',
        'UAH',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','),
    );

  const csv = [
    'Parameters: TimeZone=Europe/Kyiv',
    'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency',
    ...rows,
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meridian_gclid_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
