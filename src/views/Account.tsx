import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { backendConfigured, supabase } from '../supabaseClient';
import { syncNow } from '../syncControl';
import type { SyncStatus } from '../sync';
import { disablePush, enablePush, getPushState } from '../push';
import type { PushState } from '../push';

const STATUS_LABEL: Record<SyncStatus, string> = {
  off: 'Not signed in - data stays on this device',
  syncing: 'Syncing…',
  synced: 'Synced across your devices',
  error: 'Sync hit a problem - will retry automatically',
  offline: 'Offline - changes will sync when you reconnect',
};

export default function Account({ status, toast }: { status: SyncStatus; toast: (t: string, b: string) => void }) {
  const { session, loading, signIn, signUp, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>('off');

  useEffect(() => {
    if (session) void getPushState().then(setPush);
  }, [session, status]);

  if (!backendConfigured) {
    return (
      <div className="view">
        <header className="page-head">
          <h1>Account</h1>
          <p className="page-sub">Cloud sync is not configured in this build</p>
        </header>
        <div className="empty">
          <span className="empty-emoji">📴</span>
          <p>This build has no backend keys, so everything stays on this device.</p>
        </div>
      </div>
    );
  }

  const submit = async (mode: 'in' | 'up') => {
    setBusy(true);
    setError(null);
    const err = mode === 'in' ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
    setBusy(false);
    if (err) setError(err);
    else if (mode === 'up') toast('🎉 Account created', 'Your habits now sync to the cloud.');
  };

  if (!session) {
    return (
      <div className="view">
        <header className="page-head">
          <h1>Account</h1>
          <p className="page-sub">Sync across devices + real push reminders</p>
        </header>

        <section className="account-card">
          <p className="settings-note">
            Sign in to sync your habits across phones and computers, and to get push reminders even when
            Rhythm is closed. Everything you have on this device uploads on first sign-in. Without an
            account the app still works fully offline on this device.
          </p>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6+ characters" />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="settings-actions">
            <button className="btn primary" disabled={busy || loading || !email.includes('@') || password.length < 6} onClick={() => void submit('in')}>
              Sign in
            </button>
            <button className="btn" disabled={busy || loading || !email.includes('@') || password.length < 6} onClick={() => void submit('up')}>
              Create account
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="view">
      <header className="page-head">
        <h1>Account</h1>
        <p className="page-sub">{session.user.email}</p>
      </header>

      <section className="account-card">
        <div className="settings-row">
          <div>
            <strong>Cloud sync</strong>
            <p className="settings-note">{STATUS_LABEL[status]}</p>
          </div>
          <button className="btn" onClick={() => syncNow()}>Sync now</button>
        </div>

        <div className="settings-row">
          <div>
            <strong>Push reminders</strong>
            <p className="settings-note">
              {push === 'on'
                ? 'On - reminders arrive even when Rhythm is closed.'
                : push === 'denied'
                  ? 'Blocked by the browser. Re-enable notifications for this site in your browser settings.'
                  : push === 'unsupported'
                    ? 'Not supported in this browser. On iPhone, install Rhythm to your Home Screen first (iOS 16.4+).'
                    : 'Off. Enable to get reminders on this device even when the app is closed.'}
            </p>
          </div>
          {push === 'off' && (
            <button
              className="btn primary"
              onClick={async () => {
                if (!supabase || !session) return;
                const r = await enablePush(supabase, session.user.id);
                toast(r.ok ? '🔔 Push on' : '⚠️ Push not enabled', r.message);
                setPush(await getPushState());
              }}
            >
              Enable
            </button>
          )}
          {push === 'on' && (
            <button
              className="btn"
              onClick={async () => {
                if (!supabase) return;
                await disablePush(supabase);
                setPush(await getPushState());
                toast('🔕 Push off', 'This device will no longer get push reminders.');
              }}
            >
              Disable
            </button>
          )}
        </div>

        <div className="settings-row">
          <div>
            <strong>Sign out</strong>
            <p className="settings-note">Your data stays on this device and in the cloud.</p>
          </div>
          <button className="btn ghost" onClick={() => void signOut()}>Sign out</button>
        </div>
      </section>
    </div>
  );
}
