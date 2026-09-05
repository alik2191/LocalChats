import { useState } from 'react';
import { ATTRIBUTION_FULL, ATTRIBUTION_LABEL } from '../lib/attribution';
import { exportGclidCsv } from '../lib/gclidExport';
import { channelById, createLeadManually, useAppState } from '../lib/store';
import { getConnections } from '../lib/connections';
import { formatPhone } from '../lib/format';

function Row({ label, value, mono, accent }: { label: string; value?: string | null; mono?: boolean; accent?: boolean }) {
  if (!value) return null;
  return (
    <div className="attr-row">
      <span className="attr-label">{label}</span>
      <span className={`attr-value ${mono ? 'mono' : ''} ${accent ? 'accent' : ''}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="attr-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function DeepLinkButton({ clickId }: { clickId: string }) {
  const [copied, setCopied] = useState(false);
  const { worker } = getConnections();
  const url = `${worker.baseUrl.replace(/\/$/, '')}/c/${clickId}`;
  return (
    <button
      className="btn outline deep-link"
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          },
          () => {},
        );
      }}
      title={url}
    >
      {copied ? 'Посилання скопійовано ✓' : '🔗 Deep link'}
    </button>
  );
}

export function AttributionPanel() {
  const s = useAppState();
  const conv = s.conversations.find((c) => c.id === s.selectedId);
  if (!conv) return null;
  const ch = channelById(s, conv.channelId);
  const msgs = s.messages[conv.id] ?? [];

  if (conv.personal || ch?.owner === 'personal') {
    return (
      <aside className="attr-panel">
        <Section title="КОНТАКТ">
          <Row label="Ім'я" value={conv.contactName} />
          <Row label="Телефон" value={conv.phone ? formatPhone(conv.phone) : null} mono />
          <Row label="Канал" value={`${ch?.displayName} · особистий`} />
        </Section>
        <Section title="ДІАЛОГ">
          <Row label="повідомлень" value={String(msgs.length)} />
          <Row label="створено" value={new Date(msgs[0]?.ts ?? conv.lastTs).toLocaleString('uk-UA')} />
        </Section>
        <div className="attr-note">
          Особистий чат — бачите лише ви. Атрибуція маркетингу не застосовується.
        </div>
      </aside>
    );
  }

  const click = conv.clickId ? s.clicks.find((c) => c.clickId === conv.clickId) : undefined;
  const clickTime = click ? new Date(click.createdAt) : null;
  const firstTs = msgs[0]?.ts ?? conv.lastTs;

  return (
    <aside className="attr-panel">
      <Section title="АТРИБУЦІЯ">
        <div className="attr-row">
          <span className="attr-label">якість</span>
          <span className={`attr-pill ${conv.attribution ?? 'direct'}`}>
            {(conv.attribution ?? 'direct').toUpperCase()}
          </span>
        </div>
        <Row label="click_id" value={conv.clickId ? `#${conv.clickId}` : '—'} mono accent={!!conv.clickId} />
        <Row label="джерело" value={conv.utmSource ?? 'direct'} mono />
        <Row label="кампанія" value={conv.utmCampaign ?? '—'} mono />
        <Row label="gclid" value={conv.gclid ?? '—'} mono />
        <Row label="реферер" value={click?.utmMedium ?? conv.utmMedium ?? 'direct'} mono />
        {clickTime && <Row label="клік" value={clickTime.toLocaleString('uk-UA')} />}
        <p className="attr-explain">{ATTRIBUTION_FULL[conv.attribution ?? 'direct']}</p>
        {conv.clickId && <DeepLinkButton clickId={conv.clickId} />}
      </Section>

      <Section title="ZOHO LEADS">
        {conv.leadCreated ? (
          <p className="zoho-note ok">Лід створено (локально). Zoho-синк підключається на етапі 3.</p>
        ) : (
          <>
            <p className="zoho-note">
              Лід не створено — атрибуція {ATTRIBUTION_LABEL[conv.attribution ?? 'direct']},
              джерело {conv.utmSource ?? 'невідоме'}.
            </p>
            <button className="btn outline full" onClick={() => createLeadManually(conv.id)}>
              + Створити лід вручну
            </button>
          </>
        )}
        <p className="zoho-hint">
          Живі API-імена полів збирайте у вашому Zoho (урок field20/field29): імена на кшталт
          Last_Name — умовні.
        </p>
      </Section>

      <Section title="ДІАЛОГ">
        <Row label="повідомлень" value={String(msgs.length)} />
        <Row label="канал" value={`${ch?.displayName ?? '—'} · робочий`} />
        <Row label="створено" value={new Date(firstTs).toLocaleString('uk-UA')} />
        {ch?.kind === 'wa' && (
          <div className="attr-risk">
            ⚠️ WhatsApp: режим inbound-only. Розсилки заборонені — ризик перманентного бану номера.
          </div>
        )}
      </Section>

      {s.conversations.some((c) => !c.personal && c.gclid) && (
        <button className="btn outline full" onClick={() => exportGclidCsv(s)}>
          Експорт GCLID (CSV)
        </button>
      )}
    </aside>
  );
}
