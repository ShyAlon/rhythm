import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  /** True while the user arrived via a password-reset email link and must set a new password. */
  recovery: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<{ error?: string; confirmationNeeded?: boolean }>;
  signOut: () => Promise<void>;
  /** Send a password-reset email. Returns an error message, or null when accepted. */
  resetPassword: (email: string) => Promise<string | null>;
  /** Set a new password during recovery. Returns an error message, or null on success. */
  updatePassword: (password: string) => Promise<string | null>;
  /** WebAuthn sign-in with a previously registered passkey. Returns an error message, or null on success. */
  signInWithPasskey: () => Promise<string | null>;
  /** Register a passkey for the signed-in user. Returns an error message, or null on success. */
  registerPasskey: () => Promise<string | null>;
}

const noop = async () => 'Backend not configured';
const noopUp = async () => ({ error: 'Backend not configured' });
const Ctx = createContext<AuthCtx>({
  session: null,
  loading: false,
  recovery: false,
  signIn: noop,
  signUp: noopUp,
  signOut: async () => {},
  resetPassword: noop,
  updatePassword: noop,
  signInWithPasskey: noop,
  registerPasskey: noop,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    // A recovery link arrives as #access_token=...&type=recovery. Supabase parses
    // it and fires PASSWORD_RECOVERY; the hash check is the belt-and-braces.
    if (window.location.hash.includes('type=recovery')) setRecovery(true);
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const v = useMemo<AuthCtx>(
    () => ({
      session,
      loading,
      recovery,
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
      resetPassword: async (email) => {
        if (!supabase) return 'Backend not configured';
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname,
        });
        return error?.message ?? null;
      },
      updatePassword: async (password) => {
        if (!supabase) return 'Backend not configured';
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return error.message;
        setRecovery(false);
        if (window.location.hash.includes('type=recovery')) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        return null;
      },
      signInWithPasskey: async () => {
        if (!supabase) return 'Backend not configured';
        const { error } = await supabase.auth.signInWithPasskey();
        return error?.message ?? null;
      },
      registerPasskey: async () => {
        if (!supabase) return 'Backend not configured';
        const { error } = await supabase.auth.registerPasskey();
        return error?.message ?? null;
      },
    }),
    [session, loading, recovery],
  );

  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
