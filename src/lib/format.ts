/** Форматування та допоміжні функції відображення контактів. */

/** Внутрішній phone від Evolution — чисті цифри ('380671234567'). */
export function formatPhone(raw: string): string {
  if (!raw) return '';
  const plus = raw.trim();
  if (!/^\+?\d+$/.test(plus)) return raw; // @handles, вже відформатовані тощо
  const digits = plus.replace(/\D/g, '');
  if (digits.startsWith('380') && digits.length === 12) {
    const d = digits.slice(3);
    return `+38 0${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
  }
  if (digits.startsWith('48') && digits.length === 11) {
    const d = digits.slice(2);
    return `+48 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)}`;
  }
  // загальний випад: групуємо по 3 справа
  const groups = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `+${groups}`;
}

/** Ініціали для аватара: перші літери перших двох слів. */
export function initials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Адресат для WhatsApp sendText: JID (зокрема @lid) — як є, телефон — лише цифри. */
export function toWhatsAppNumber(jidOrPhone: string): string {
  const v = (jidOrPhone ?? '').trim();
  if (!v) return '';
  if (v.includes('@')) return v; // JID: @s.whatsapp.net, @lid, @g.us — не руйнуємо
  return v.replace(/\D/g, '');
}

/** Детермінований відтінок аватара за рядком (0..359). */
export function avatarHue(str: string): number {
  let h = 2166136261;
  for (const c of str) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}
