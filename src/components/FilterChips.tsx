import {
  channelUnread,
  setAttributionFilter,
  setChannelFilter,
  setTagQuery,
  useAppState,
} from '../lib/store';
import type { Filters } from '../lib/store';

const KINDS: Array<{ key: 'wa' | 'tg' | 'viber'; label: string }> = [
  { key: 'wa', label: 'WA' },
  { key: 'tg', label: 'TG' },
  { key: 'viber', label: 'VB' },
];

const ATTRS: Array<{ key: Filters['attribution']; label: string; cls: string }> = [
  { key: 'exact', label: 'EXACT', cls: 'ex' },
  { key: 'fallback', label: 'FALLBACK', cls: 'fb' },
  { key: 'direct', label: 'DIRECT', cls: 'dr' },
];

export function FilterChips() {
  const s = useAppState();
  const { channel, attribution } = s.filters;

  return (
    <div className="filters">
      <div className="chip-row">
        <button
          className={`chip ${channel === 'all' ? 'active' : ''}`}
          onClick={() => setChannelFilter('all')}
        >
          Усі
        </button>
        {KINDS.map((k) => {
          const n = channelUnread(s, (c) => c.owner === 'company' && c.kind === k.key);
          return (
            <button
              key={k.key}
              className={`chip ${channel === k.key ? 'active' : ''}`}
              onClick={() => setChannelFilter(channel === k.key ? 'all' : k.key)}
            >
              {k.label}
              {n > 0 && <b>·{n}</b>}
            </button>
          );
        })}
        <button
          className={`chip personal ${channel === 'personal' ? 'active' : ''}`}
          onClick={() => setChannelFilter(channel === 'personal' ? 'all' : 'personal')}
        >
          Особисті
        </button>
      </div>
      <div className="chip-row">
        {ATTRS.map((a) => (
          <button
            key={a.key}
            className={`chip attr ${a.cls} ${attribution === a.key ? 'active' : ''}`}
            onClick={() => setAttributionFilter(attribution === a.key ? 'all' : a.key)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <input
        className="tag-search"
        placeholder="Пошук за #мітка…"
        value={s.filters.tag}
        onChange={(e) => setTagQuery(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
