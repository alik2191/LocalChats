export const SUPER_ADMINS = ['alik2191@gmail.com', 'sergey.v@mk-translations.ua'];

export function isSuperAdminEmail(email?: string | null): boolean {
  return !!email && SUPER_ADMINS.includes(email.toLowerCase());
}
