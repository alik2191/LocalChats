import type { AppState } from '../store';
import { supabase } from '../supabase';
import type { BackendHealth, DataBackend } from './types';

interface AppStateRow {
  user_id: string;
  data: AppState;
  updated_at: string;
}

/**
 * Supabase-адаптер: повний стан консолі зберігається як jsonb у таблиці
 * app_state (рядок на користувача, RLS за auth.uid()). Схема — supabase/schema.sql.
 */
export const supabaseBackend: DataBackend = {
  kind: 'supabase',

  async load(): Promise<AppState | null> {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return null;
    const { data, error } = await supabase
      .from('app_state')
      .select('user_id, data, updated_at')
      .eq('user_id', userData.user.id)
      .maybeSingle<AppStateRow>();
    if (error || !data) return null;
    return data.data ?? null;
  },

  async save(state: AppState): Promise<void> {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return;
    await supabase.from('app_state').upsert({
      user_id: userData.user.id,
      data: state,
      updated_at: new Date().toISOString(),
    });
  },

  async health(): Promise<BackendHealth> {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return { ok: false, detail: 'немає активної сесії Supabase (увійдіть у систему)' };
    }
    const { error } = await supabase
      .from('app_state')
      .select('user_id')
      .eq('user_id', userData.user.id)
      .limit(1);
    if (error) {
      return { ok: false, detail: `таблиця app_state недоступна: ${error.message}` };
    }
    return { ok: true, detail: `Supabase відповідає (${userData.user.email ?? userData.user.id})` };
  },
};
