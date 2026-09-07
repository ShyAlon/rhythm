import { useEffect, useRef, useState } from 'react';
import { StoreProvider, useStore } from './store';
import type { Habit } from './types';
import Today from './views/Today';
import Schedule from './views/Schedule';
import Stats from './views/Stats';
import Editor from './views/Editor';
import Account from './views/Account';
import { dateKey, dueOn, isCompleted } from './logic';
import { notify, setBadge, startReminderLoop } from './reminders';
import { AuthProvider, useAuth } from './auth';
import { supabase } from './supabaseClient';
import { startSync } from './sync';
import type { SyncStatus } from './sync';
import { registerSyncNow } from './syncControl';

type Tab = 'today' | 'schedule' | 'stats' | 'account';
type EditorState = { open: false } | { open: true; habit: Habit | null };
interface Toast { id: number; title: string; body: string }

/** Runs the cloud sync engine for the signed-in user. Renders nothing. */
function SyncManager({ onStatus }: { onStatus: (s: SyncStatus) => void }) {
  const { session } = useAuth();
  const { state, dispatch } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!supabase || !userId) {
      onStatus('off');
      registerSyncNow(null);
      return;
    }
    const handle = startSync(
      supabase,
      userId,
      () => stateRef.current,
      (s) => dispatch({ type: 'replaceAll', state: s }),
      onStatus,
    );
    registerSyncNow(handle.syncNow);
    return () => {
      handle.stop();
      registerSyncNow(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return null;
}

function Shell() {
  const { state } = useStore();
  const [tab, setTab] = useState<Tab>('today');
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('off');
  const stateRef = useRef(state);
  stateRef.current = state;
  const toastId = useRef(0);

  const pushToast = (title: string, body: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, title, body }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  };

  // Reminder loop: system notification when permitted, in-app toast always.
  useEffect(() => {
    return startReminderLoop(
      () => stateRef.current,
      (title, body) => { notify(title, body); pushToast(title, body); },
    );
  }, []);

  // App-icon badge = incomplete habits today.
  useEffect(() => {
    const now = new Date();
    const key = dateKey(now);
    const remaining = dueOn(state, now).filter((h) => !isCompleted(state, h.id, key)).length;
    void setBadge(remaining);
  }, [state]);

  return (
    <div className="app">
      <SyncManager onStatus={setSyncStatus} />
      <main className="content">
        {tab === 'today' && <Today />}
        {tab === 'schedule' && (
          <Schedule
            onAdd={() => setEditor({ open: true, habit: null })}
            onEdit={(h) => setEditor({ open: true, habit: h })}
          />
        )}
        {tab === 'stats' && <Stats toast={pushToast} />}
        {tab === 'account' && <Account status={syncStatus} toast={pushToast} />}
      </main>

      <nav className="bottomnav">
        <button className={tab === 'today' ? 'sel' : ''} onClick={() => setTab('today')}><span>◉</span>Today</button>
        <button className={tab === 'schedule' ? 'sel' : ''} onClick={() => setTab('schedule')}><span>☷</span>Schedule</button>
        <button className={tab === 'stats' ? 'sel' : ''} onClick={() => setTab('stats')}><span>▦</span>Stats</button>
        <button className={tab === 'account' ? 'sel' : ''} onClick={() => setTab('account')}><span>☁</span>Account</button>
      </nav>

      {editor.open && <Editor habit={editor.habit} onClose={() => setEditor({ open: false })} />}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="toast" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
            <strong>{t.title}</strong>
            <p>{t.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </AuthProvider>
  );
}
