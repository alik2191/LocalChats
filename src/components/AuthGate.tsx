import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { openSignIn, supabase } from '../lib/supabase';

export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

export function AuthGate() {
  return (
    <div className="auth-gate">
      <div className="auth-box">
        <span className="auth-brand">LOCALCHATS</span>
        <span className="auth-sub">SALES CONSOLE · v1.5-UA</span>
        <p className="auth-text">
          Єдиний інбокс робочих та особистих месенджерів відділу продажів.
          Увійдіть, щоб продовжити.
        </p>
        <button className="btn primary big" onClick={openSignIn}>
          Увійти
        </button>
        <p className="auth-hint">
          Google або email/пароль. Реєстрація та відновлення пароля — у вікні входу.
        </p>
      </div>
    </div>
  );
}
