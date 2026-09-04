export const SUPER_ADMINS = ['alik2191@gmail.com'];

export function isSuperAdminEmail(email?: string | null): boolean {
  return !!email && SUPER_ADMINS.includes(email.toLowerCase());
}
