import { useEffect, useRef, useState } from 'react';
import { StoreProvider, useStore } from './store';
import type { Habit } from './types';
import Today from './views/Today';
import Schedule from './views/Schedule';
import Stats from './views/Stats';
import Editor from './views/Editor';
import { dateKey, dueOn, isCompleted } from './logic';
import { notify, setBadge, startReminderLoop } from './reminders';

type Tab = 'today' | 'schedule' | 'stats';
type EditorState = { open: false } | { open: true; habit: Habit | null };
interface Toast { id: number; title: string; body: string }

function Shell() {
  const { state } = useStore();
  const [tab, setTab] = useState<Tab>('today');
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [toasts, setToasts] = useState<Toast[]>([]);
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
      <main className="content">
        {tab === 'today' && <Today />}
        {tab === 'schedule' && (
          <Schedule
            onAdd={() => setEditor({ open: true, habit: null })}
            onEdit={(h) => setEditor({ open: true, habit: h })}
          />
        )}
        {tab === 'stats' && <Stats toast={pushToast} />}
      </main>

      <nav className="bottomnav">
        <button className={tab === 'today' ? 'sel' : ''} onClick={() => setTab('today')}><span>◉</span>Today</button>
        <button className={tab === 'schedule' ? 'sel' : ''} onClick={() => setTab('schedule')}><span>☷</span>Schedule</button>
        <button className={tab === 'stats' ? 'sel' : ''} onClick={() => setTab('stats')}><span>▦</span>Stats</button>
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
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
