import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { backendConfigured, supabase, supabaseUrl } from '../supabaseClient';
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

const passkeySupported = typeof window !== 'undefined' && 'PublicKeyCredential' in window;

/** Cancelling the system passkey prompt is not an error worth showing. */
const isPasskeyCancel = (message: string) =>
  /not allowed|timed out|abort|cancel/i.test(message);

export default function Account({ status, toast }: { status: SyncStatus; toast: (t: string, b: string) => void }) {
  const {
    session,
    loading,
    recovery,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    signInWithPasskey,
    registerPasskey,
  } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
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
    setInfo(null);
    if (mode === 'in') {
      const err = await signIn(email.trim(), password);
      setBusy(false);
      if (err) setError(err);
      return;
    }
    const r = await signUp(email.trim(), password);
    setBusy(false);
    if (r.error) setError(r.error);
    else if (r.confirmationNeeded) setInfo('Account created. Check your email for the confirmation link, then come back and sign in.');
    else toast('🎉 Account created', 'Your habits now sync to the cloud.');
  };

  const forgot = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const err = await resetPassword(email.trim());
    setBusy(false);
    if (err) setError(err);
    else setInfo('Reset link sent. Open the email on this device and follow the link to choose a new password.');
  };

  const saveNewPassword = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const err = await updatePassword(newPw);
    setBusy(false);
    if (err) setError(err);
    else toast('✅ Password updated', 'You are signed in with your new password.');
  };

  const passkeyIn = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const err = await signInWithPasskey();
    setBusy(false);
    if (err && !isPasskeyCancel(err)) setError(err);
  };

  const addPasskey = async () => {
    setBusy(true);
    setError(null);
    const err = await registerPasskey();
    setBusy(false);
    if (err) {
      if (!isPasskeyCancel(err)) setError(err);
      return;
    }
    toast('🔑 Passkey added', 'Next time, sign in with your fingerprint, face, or device PIN.');
  };

  const deleteAccount = async () => {
    if (!supabase || !session) return;
    if (!window.confirm('Delete your Rhythm account and wipe all cloud data? This cannot be undone. Data on this device stays.')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(`Delete failed: ${(j as { error?: string }).error ?? r.status}`);
        setBusy(false);
        return;
      }
      await signOut();
      toast('🗑️ Account deleted', 'Your cloud data was wiped. This device still has its local copy.');
    } catch {
      setError('Delete failed: network error');
    }
    setBusy(false);
  };

  // Password-reset landing: the reset email link opens the app here.
  if (recovery) {
    return (
      <div className="view">
        <header className="page-head">
          <h1>Choose a new password</h1>
          <p className="page-sub">{session?.user?.email ?? 'Password reset'}</p>
        </header>
        <section className="account-card">
          <label className="field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="6+ characters" />
          </label>
          <label className="field">
            <span>Repeat new password</span>
            <input type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="Same as above" />
          </label>
          {newPw2.length > 0 && newPw !== newPw2 && <p className="form-error">Passwords do not match.</p>}
          {error && <p className="form-error">{error}</p>}
          <div className="settings-actions">
            <button className="btn primary" disabled={busy || newPw.length < 6 || newPw !== newPw2} onClick={() => void saveNewPassword()}>
              Save new password
            </button>
          </div>
        </section>
      </div>
    );
  }

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
          {info && <p className="form-info">{info}</p>}
          <div className="settings-actions">
            <button className="btn primary" disabled={busy || loading || !email.includes('@') || password.length < 6} onClick={() => void submit('in')}>
              Sign in
            </button>
            <button className="btn" disabled={busy || loading || !email.includes('@') || password.length < 6} onClick={() => void submit('up')}>
              Create account
            </button>
          </div>
          <div className="settings-actions">
            <button className="btn ghost" disabled={busy || loading || !email.includes('@')} onClick={() => void forgot()}>
              Forgot password?
            </button>
            {passkeySupported && (
              <button className="btn ghost" disabled={busy || loading} onClick={() => void passkeyIn()}>
                Sign in with a passkey
              </button>
            )}
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

        {passkeySupported && (
          <div className="settings-row">
            <div>
              <strong>Passkey sign-in</strong>
              <p className="settings-note">
                Sign in with your fingerprint, face, or device PIN instead of a password. Add one on each device you use.
              </p>
            </div>
            <button className="btn" disabled={busy} onClick={() => void addPasskey()}>Add</button>
          </div>
        )}

        <div className="settings-row">
          <div>
            <strong>Sign out</strong>
            <p className="settings-note">Your data stays on this device and in the cloud.</p>
          </div>
          <button className="btn ghost" onClick={() => void signOut()}>Sign out</button>
        </div>

        <div className="settings-row">
          <div>
            <strong>Privacy</strong>
            <p className="settings-note">What Rhythm stores and where it goes.</p>
          </div>
          <a className="btn ghost" href="./privacy.html" target="_blank" rel="noreferrer">View</a>
        </div>

        <div className="settings-row">
          <div>
            <strong>Delete account</strong>
            <p className="settings-note">Wipes your account and all cloud data permanently. The copy on this device stays.</p>
          </div>
          <button className="btn danger" disabled={busy} onClick={() => void deleteAccount()}>Delete</button>
        </div>
      </section>
    </div>
  );
}
