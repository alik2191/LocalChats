import { ATTRIBUTION_FULL } from '../lib/attribution';
import { exportGclidCsv } from '../lib/gclidExport';
import { channelById, useAppState } from '../lib/store';

function Row({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="attr-row">
      <span className="attr-label">{label}</span>
      <span className={`attr-value ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}

export function AttributionPanel() {
  const s = useAppState();
  const conv = s.conversations.find((c) => c.id === s.selectedId);
  if (!conv) return null;
  const ch = channelById(s, conv.channelId);

  if (conv.personal || ch?.owner === 'personal') {
    return (
      <aside className="attr-panel">
        <h3>КОНТАКТ</h3>
        <Row label="Ім'я" value={conv.contactName} />
        <Row label="Телефон" value={conv.phone} mono />
        <Row label="Канал" value={`${ch?.displayName} · ${ch?.externalRef}`} />
        <div className="attr-note">
          Особистий чат — бачите лише ви. Атрибуція маркетингу не застосовується.
        </div>
      </aside>
    );
  }

  const clickTime = conv.clickId
    ? new Date(s.clicks.find((c) => c.clickId === conv.clickId)?.createdAt ?? conv.lastTs)
    : null;

  return (
    <aside className="attr-panel">
      <h3>АТРИБУЦІЯ ЛІДА</h3>
      <div className={`attr-pill big ${conv.attribution ?? 'direct'}`}>
        {conv.attribution?.toUpperCase() ?? 'DIRECT'}
      </div>
      <p className="attr-explain">{ATTRIBUTION_FULL[conv.attribution ?? 'direct']}</p>

      <Row label="click_id" value={conv.clickId ? `#${conv.clickId}` : null} mono />
      <Row label="utm_source" value={conv.utmSource} mono />
      <Row label="utm_medium" value={conv.utmMedium} mono />
      <Row label="utm_campaign" value={conv.utmCampaign} mono />
      <Row label="gclid" value={conv.gclid ? `${conv.gclid.slice(0, 18)}…` : null} mono />
      {clickTime && <Row label="Клік по сайту" value={clickTime.toLocaleString('uk-UA')} />}

      <div className="attr-block">
        <div className="attr-row">
          <span className="attr-label">Zoho CRM</span>
          <span className="attr-value pending">очікує синку</span>
        </div>
        <div className="attr-row">
          <span className="attr-label">Канал</span>
          <span className="attr-value">
            {ch?.displayName} · {ch?.externalRef}
          </span>
        </div>
        {ch?.kind === 'wa' && (
          <div className="attr-risk">⚠️ WhatsApp-особистий: режим inbound-only. Розсилки заборонені — ризик перманентного бану номера.</div>
        )}
      </div>

      {s.conversations.some((c) => !c.personal && c.gclid) && (
        <button className="btn outline full" onClick={() => exportGclidCsv(s)}>
          Експорт GCLID (CSV)
        </button>
      )}
    </aside>
  );
}
