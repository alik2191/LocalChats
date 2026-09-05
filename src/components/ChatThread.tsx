import { useState } from 'react';
import type { Conversation, Message } from '../types';
import { channelById, renameContact, sendReply, useAppState } from '../lib/store';
import { avatarHue, formatPhone, initials } from '../lib/format';

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function Avatar({ name, size = 38 }: { name: string; size?: number }) {
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

function Bubble({ m }: { m: Message }) {
  const out = m.direction === 'out';
  return (
    <div className={`bubble-row ${out ? 'out' : 'in'}`}>
      <div className={`bubble ${out ? 'out' : 'in'}`}>
        <p>{m.body}</p>
        <span className="bubble-meta">
          {fmtTime(m.ts)}
          {out && (
            <i className={`ticks ${m.status}`}>
              {m.status === 'failed' ? '!' : m.status === 'read' ? '✓✓' : '✓'}
            </i>
          )}
        </span>
      </div>
    </div>
  );
}

/** Швидкі відповіді (reply-only: вставляє текст у композер, не надсилає сама) */
const QUICK_REPLIES = [
  'Рахунок підготуємо протягом години та надішлемо.',
  'Доставка по Україні 3–5 днів — розраховуємо вартість.',
  'КП надіслав, перевірте, будь ласка.',
  'Передав у відділ розрахунків, відповімо найближчим часом.',
];

function Composer({ conv }: { conv: Conversation }) {
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    sendReply(conv.id, text);
    setText('');
  };
  return (
    <div className="composer-wrap">
      <div className="qr-chips">
        {QUICK_REPLIES.map((q) => (
          <button key={q} className="qr-chip" title={q} onClick={() => setText(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="composer">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Відповісти клієнту… (Enter — надіслати)"
        />
        <button className="send-btn" onClick={send} disabled={!text.trim()} title="Надіслати">
          ➤
        </button>
      </div>
    </div>
  );
}

function ChatHeader({ conv }: { conv: Conversation }) {
  const s = useAppState();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const ch = channelById(s, conv.channelId);
  const displayPhone = conv.phone ? formatPhone(conv.phone) : null;
  const nameIsDigits = /^\+?\d+$/.test(conv.contactName.replace(/\s/g, ''));
  const title = nameIsDigits && displayPhone ? displayPhone : conv.contactName;

  return (
    <div className="chat-head rich">
      <Avatar name={conv.contactName} />
      <div className="chat-head-main">
        {editing ? (
          <form
            className="rename-row"
            onSubmit={(e) => {
              e.preventDefault();
              renameContact(conv.id, draft);
              setEditing(false);
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setEditing(false)}
              placeholder="Ім'я контакту"
            />
            <button className="btn ghost small" type="submit">Зберегти</button>
          </form>
        ) : (
          <span
            className="chat-name editable"
            title="Перейменувати контакт"
            onClick={() => {
              setDraft(nameIsDigits ? '' : conv.contactName);
              setEditing(true);
            }}
          >
            {title}
          </span>
        )}
        <span className="chat-sub">
          {displayPhone && <span>{displayPhone} · </span>}
          <span>{ch?.displayName ?? '—'}</span>
          <span> · {ch?.owner === 'personal' ? 'особистий' : 'робочий'}</span>
          {ch && (
            <span className="link-status">
              {' '}· <i className={`dot ${ch.status}`} /> канал на зв'язку
            </span>
          )}
        </span>
      </div>
      {conv.clickId && <span className="tag-pill">#{conv.clickId}</span>}
    </div>
  );
}

export function ChatThread() {
  const s = useAppState();
  const conv = s.conversations.find((c) => c.id === s.selectedId);
  if (!conv) {
    return (
      <div className="chat-empty">
        <div className="empty-box">
          <h2>ДІАЛОГ НЕ ВИБРАНО</h2>
          <p>ліворуч — усе листування всіх каналів</p>
          <p>атрибуція кожного ліда — у правій панелі</p>
        </div>
      </div>
    );
  }
  const msgs = s.messages[conv.id] ?? [];

  return (
    <div className="chat">
      <ChatHeader conv={conv} />
      <div className="chat-scroll">
        {msgs.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
      </div>
      <Composer conv={conv} />
    </div>
  );
}
