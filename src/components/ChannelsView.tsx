import { companyChannels, myChannels, removeChannel, startPairing, useAppState } from '../lib/store';

const KIND_LABEL: Record<string, string> = { wa: 'WhatsApp', tg: 'Telegram', viber: 'Viber' };

function ChannelCard({
  name,
  ref_,
  kind,
  owner,
  status,
  onRemove,
  risk,
}: {
  name: string;
  ref_: string;
  kind: string;
  owner: string;
  status: string;
  onRemove?: () => void;
  risk?: string;
}) {
  return (
    <div className="channel-card">
      <div className="channel-card-head">
        <span className={`dot ${status} k-${kind}`} />
        <div>
          <div className="channel-name">{name}</div>
          <div className="channel-ref">{ref_}</div>
        </div>
        <span className="channel-owner">{owner}</span>
        {onRemove && (
          <button className="btn ghost small" onClick={onRemove}>
            Відключити
          </button>
        )}
      </div>
      <div className="channel-card-foot">
        <span className={`status-pill ${status}`}>{status === 'online' ? 'онлайн' : 'офлайн'}</span>
        {risk && <span className="channel-risk">{risk}</span>}
      </div>
    </div>
  );
}

export function ChannelsView() {
  const s = useAppState();
  const company = companyChannels(s);
  const mine = myChannels(s);

  return (
    <div className="view">
      <h2>Канали</h2>
      <p className="view-sub">
        Робочі номери компанії підключає адміністратор (QR-пейринг через воркер сесій). Особистий
        номер кожен співробітник підключає сам — його листування бачить тільки він.
      </p>

      <h3 className="section-title">РОБОЧІ КАНАЛИ КОМПАНІЇ</h3>
      <div className="channel-grid">
        {company.map((ch) => (
          <ChannelCard
            key={ch.id}
            name={ch.displayName}
            ref_={ch.externalRef}
            kind={ch.kind}
            owner="компанія"
            status={ch.status}
            risk={ch.kind === 'wa' ? 'inbound-only: тільки відповіді клієнтам' : undefined}
          />
        ))}
      </div>

      <h3 className="section-title">МОЇ НОМЕРИ</h3>
      {mine.length === 0 && (
        <p className="hint">Ще не підключено. Оберіть месенджер нижче — відкриється QR-код.</p>
      )}
      <div className="channel-grid">
        {mine.map((ch) => (
          <ChannelCard
            key={ch.id}
            name={ch.displayName}
            ref_={ch.externalRef}
            kind={ch.kind}
            owner="особистий"
            status={ch.status}
            onRemove={() => removeChannel(ch.id)}
            risk={
              ch.kind === 'wa'
                ? '⚠️ Meta банить неофіційні сесії навіть без розсилок — тільки окрема SIM'
                : 'MTProto: без масових розсилок — ризик низький'
            }
          />
        ))}
      </div>

      <div className="connect-actions">
        <button className="btn primary" onClick={() => startPairing('wa')}>
          + Підключити WhatsApp
        </button>
        <button className="btn outline" onClick={() => startPairing('tg')}>
          + Підключити Telegram
        </button>
      </div>
      <p className="hint">
        Viber особистий підключити неможливо — протокол закритий. Доступний лише безкоштовний
        Viber Bot (вебхук), він підключається адміністратором.
      </p>
    </div>
  );
}
