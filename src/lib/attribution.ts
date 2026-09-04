import type { Attribution, ChannelKind, Click } from '../types';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function genCid(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return s;
}

export function hashStr(v: string): string {
  let h = 2166136261;
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function extractTag(body: string): string | null {
  const m = body.match(/#([0-9A-Z]{8})\b/);
  return m ? m[1] : null;
}

/** fallback-матчинг: клик через редирект за последние 30 минут */
export function matchFallback(clicks: Click[], channelKind: ChannelKind, now: number): Click | null {
  const windowMs = 30 * 60 * 1000;
  const candidates = clicks
    .filter((c) => c.createdAt > now - windowMs)
    .sort((a, b) => b.createdAt - a.createdAt);
  return candidates.find((c) => c.channelKind === channelKind) ?? candidates[0] ?? null;
}

export function resolveAttribution(
  clicks: Click[],
  tag: string | null,
  channelKind: ChannelKind,
  now: number,
): { attribution: Attribution; click?: Click } {
  if (tag) {
    const click = clicks.find((c) => c.clickId === tag);
    if (click) return { attribution: 'exact', click };
  }
  const fb = matchFallback(clicks, channelKind, now);
  if (fb) return { attribution: 'fallback', click: fb };
  return { attribution: 'direct' };
}

export const ATTRIBUTION_LABEL: Record<Attribution, string> = {
  exact: 'EX',
  fallback: 'FB',
  direct: 'DR',
};

export const ATTRIBUTION_FULL: Record<Attribution, string> = {
  exact: 'EXACT — метка #click_id найдена в тексте',
  fallback: 'FALLBACK — совпадение по IP+UA за 30 минут',
  direct: 'DIRECT — клиент пришёл без метки',
};
