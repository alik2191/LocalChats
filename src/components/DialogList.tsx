import type { Conversation } from '../types';
import { ATTRIBUTION_LABEL } from '../lib/attribution';
import { avatarHue, formatPhone, initials } from '../lib/format';
import { channelById, lastMessage, myChannels, removeChannel, selectConversation, startPairing, useAppState, visibleConversations } from '../lib/store';

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const KIND_LABEL: Record<string, string> = { wa: 'WA', tg: 'TG', viber: 'VB' };

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const hue = avatarHue(name);
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 45% 26%)`,
        color: `hsl(${hue} 80% 78%)`,
        fontSize: size * 0.36,
      }}
    >
      {initials(name)}
    </span>
  );
}

function DialogRow({ conv }: { conv: Conversation }) {
  const s = useAppState();
  const ch = channelById(s, conv.channelId);
  const last = lastMessage(s, conv.id);
  const selected = s.selectedId === conv.id;
  const nameIsDigits = /^\+?\d+$/.test(conv.contactName.replace(/\s/g, ''));
  const title = nameIsDigits && conv.phone ? formatPhone(conv.phone) : conv.contactName;
  return (
    <button className={`dialog ${selected ? 'selected' : ''}`} onClick={() => selectConversation(conv.id)}>
      <Avatar name={conv.contactName} />
      <div className="dialog-main">
        <div className="dialog-top">
          <span className="dialog-name">{title}</span>
          <span className="dialog-time">{fmtTime(conv.lastTs)}</span>
        </div>
        <div className="dialog-bottom">
          <span className="dialog-preview">{last ? `${last.direction === 'out' ? 'Ви: ' : ''}${last.body}` : ''}</span>
          <span className="dialog-badges">
            {ch && ch.owner === 'company' && conv.attribution && (
              <span className={`attr-badge ${conv.attribution.slice(0, 2)}`}>
                {ATTRIBUTION_LABEL[conv.attribution]}
              </span>
            )}
            {ch && <span className="kind-badge">{KIND_LABEL[ch.kind]}</span>}
            {conv.unread > 0 && <span className="unread-badge">{conv.unread}</span>}
          </span>
        </div>
      </div>
    </button>
  );
}

export function DialogList() {
  const s = useAppState();
  const list = visibleConversations(s);
  const mine = myChannels(s);

  return (
    <div className="dialog-list">
      <div className="dialog-scroll">
        {list.length === 0 && <p className="empty-list">Нічого не знайдено за фільтрами</p>}
        {list.map((c) => (
          <DialogRow key={c.id} conv={c} />
        ))}
      </div>

      <div className="my-numbers">
        <div className="section-head">
          <span>МОЇ НОМЕРИ</span>
          <span className="section-connect">
            <button className="btn ghost small" title="Підключити WhatsApp" onClick={() => startPairing('wa')}>
              + WA
            </button>
            <button className="btn ghost small" title="Підключити Telegram" onClick={() => startPairing('tg')}>
              + TG
            </button>
          </span>
        </div>
        {mine.length === 0 && <p className="hint">Підключіть особистий WhatsApp або Telegram — листування бачитимете лише ви.</p>}
        {mine.map((ch) => (
          <div key={ch.id} className="my-number-row">
            <span className={`dot ${ch.status} ${ch.kind === 'wa' ? 'wa' : 'tg'}`} />
            <span className="my-number-name">
              {ch.displayName} · <b>{ch.externalRef}</b>
            </span>
            <button className="icon-btn" title="Відключити" onClick={() => removeChannel(ch.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
