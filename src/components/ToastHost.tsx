import { useEffect, useRef, useState } from 'react';
import { selectConversation, setView, useAppState } from '../lib/store';
import { detectNewIncoming, type ToastItem } from '../lib/notify';
import { KIND_COLOR } from './DialogList';

const TOAST_TTL_MS = 6000;
const MAX_TOASTS = 4;

/** Поп-ап «нове повідомлення» внизу праворуч. Клік — відкрити діалог. */
export function ToastHost() {
  const s = useAppState();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (seen.current === null) {
      // перший рендер: не спамимо тостами наявну історію
      seen.current = new Set(
        Object.values(s.messages).flat().map((m) => m.id),
      );
      return;
    }
    const kindByChannel: Record<string, (typeof s.channels)[number]['kind']> = {};
    for (const ch of s.channels) kindByChannel[ch.id] = ch.kind;
    const fresh = detectNewIncoming(s.conversations, s.messages, kindByChannel, seen.current);
    if (fresh.length === 0) return;
    setToasts((prev) => [...fresh, ...prev].slice(0, MAX_TOASTS));
    for (const t of fresh) {
      timers.current.push(
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== t.id));
        }, TOAST_TTL_MS),
      );
    }
  }, [s.messages, s.conversations, s.channels]);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          className="toast"
          onClick={() => {
            setView('inbox');
            selectConversation(t.convId);
            setToasts((prev) => prev.filter((x) => x.id !== t.id));
          }}
        >
          <i className="ch-dot" style={{ background: KIND_COLOR[t.kind] }} />
          <span className="toast-body">
            <b>{t.name}</b>
            <span>{t.body.length > 90 ? `${t.body.slice(0, 90)}…` : t.body}</span>
          </span>
          <span className="toast-new">нове</span>
        </button>
      ))}
    </div>
  );
}
