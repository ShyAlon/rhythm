import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<{ error?: string; confirmationNeeded?: boolean }>;
  signOut: () => Promise<void>;
}

const noop = async () => 'Backend not configured';
const noopUp = async () => ({ error: 'Backend not configured' });
const Ctx = createContext<AuthCtx>({ session: null, loading: false, signIn: noop, signUp: noopUp, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const v = useMemo<AuthCtx>(
    () => ({
      session,
      loading,
      signIn: async (email, password) => {
        if (!supabase) return 'Backend not configured';
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return error?.message ?? null;
      },
      signUp: async (email, password) => {
        if (!supabase) return { error: 'Backend not configured' };
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return { error: error.message };
        return { confirmationNeeded: !data.session }; // email confirmation on: no session until confirmed
      },
      signOut: async () => {
        await supabase?.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
