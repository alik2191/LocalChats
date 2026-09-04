import { useState } from 'react';
import type { Conversation, Message } from '../types';
import { channelById, sendReply, useAppState } from '../lib/store';

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function Bubble({ m }: { m: Message }) {
  const out = m.direction === 'out';
  return (
    <div className={`bubble-row ${out ? 'out' : 'in'}`}>
      <div className={`bubble ${out ? 'out' : 'in'}`}>
        <p>{m.body}</p>
        <span className="bubble-meta">
          {fmtTime(m.ts)}
          {out && <i className={`ticks ${m.status}`}>{m.status === 'read' ? '✓✓' : '✓'}</i>}
        </span>
      </div>
    </div>
  );
}

function Composer({ conv }: { conv: Conversation }) {
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    sendReply(conv.id, text);
    setText('');
  };
  return (
    <div className="composer">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        placeholder={`Відповісти ${conv.contactName}…`}
      />
      <button className="btn primary" onClick={send} disabled={!text.trim()}>
        Надіслати
      </button>
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
  const ch = channelById(s, conv.channelId);
  const msgs = s.messages[conv.id] ?? [];

  return (
    <div className="chat">
      <div className="chat-head">
        <div>
          <span className="chat-name">{conv.contactName}</span>
          <span className="chat-sub">
            {ch?.displayName} · {conv.phone ?? '—'}
            {ch?.owner === 'personal' && ' · особистий чат'}
          </span>
        </div>
        <span className={`attr-pill ${conv.attribution ?? 'personal'}`}>
          {conv.attribution ? conv.attribution.toUpperCase() : 'PERSONAL'}
        </span>
      </div>
      <div className="chat-scroll">
        {msgs.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
      </div>
      <Composer conv={conv} />
    </div>
  );
}
