import { useMemo, useRef, useState } from 'react';
import { useStore, exportState, parseImport } from '../store';
import { adherence, bestStreak, currentStreak, heatmap, recurrenceLabel } from '../logic';
import { permissionState, requestPermission } from '../reminders';
import Weight from './Weight';

export default function Stats({ toast }: { toast: (t: string, b: string) => void }) {
  const { state, dispatch } = useStore();
  const habits = state.habits.filter((h) => !h.archived);
  const fileRef = useRef<HTMLInputElement>(null);
  const [perm, setPerm] = useState(permissionState());

  const overall = useMemo(() => {
    let due = 0, hit = 0;
    for (const h of habits) {
      const a = adherence(h, state.completions[h.id] ?? [], 7);
      due += a.due; hit += a.hit;
    }
    return due === 0 ? null : Math.round((hit / due) * 100);
  }, [habits, state.completions]);

  return (
    <div className="view">
      <header className="page-head">
        <h1>Stats</h1>
        {overall !== null && <p className="page-sub">{overall}% adherence over the last 7 days</p>}
      </header>

      {habits.map((h) => {
        const done = state.completions[h.id] ?? [];
        const cur = currentStreak(h, done);
        const best = bestStreak(h, done);
        const a30 = adherence(h, done, 30);
        const hm = heatmap(h, done, 12);
        return (
          <section key={h.id} className="stat-card" style={{ ['--hc' as string]: h.color }}>
            <div className="stat-head">
              <span className="habit-emoji">{h.emoji}</span>
              <div className="habit-text">
                <span className="habit-name">{h.name}</span>
                <span className="habit-meta">{recurrenceLabel(h)}</span>
              </div>
              <div className="stat-nums">
                <span title="Current streak">🔥 {cur}</span>
                <span title="Best streak">🏆 {best}</span>
                <span title="30-day adherence">{a30.due === 0 ? '—' : `${Math.round(a30.ratio * 100)}%`}</span>
              </div>
            </div>
            <div className="heatmap" role="img" aria-label={`12 week history for ${h.name}`}>
              {hm.map((col, i) => (
                <div key={i} className="hm-col">
                  {col.map((cell) => (
                    <span
                      key={cell.key}
                      title={cell.due ? `${cell.key}: ${cell.done ? 'done' : 'missed'}` : cell.key}
                      className={`hm-cell ${cell.due ? (cell.done ? 'hm-done' : 'hm-miss') : 'hm-na'}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <Weight toast={toast} />

      {habits.length === 0 && (
        <div className="empty"><span className="empty-emoji">📊</span><p>Add habits to start seeing stats.</p></div>
      )}

      <section className="settings">
        <h2>Settings</h2>
        <div className="settings-row">
          <div>
            <strong>Notifications</strong>
            <p className="settings-note">
              {perm === 'unsupported'
                ? 'This browser does not support notifications. On iPhone, install the app to your Home Screen first.'
                : perm === 'granted'
                  ? 'Enabled. Reminders fire while the app is open or installed.'
                  : 'Off. Enable to get reminders.'}
            </p>
          </div>
          {perm !== 'granted' && perm !== 'unsupported' && (
            <button className="btn" onClick={async () => setPerm(await requestPermission())}>Enable</button>
          )}
        </div>
        <div className="settings-row">
          <div>
            <strong>Back up data</strong>
            <p className="settings-note">Everything is stored on this device. Export a JSON backup or restore one.</p>
          </div>
          <div className="settings-actions">
            <button className="btn" onClick={() => exportState(state)}>Export</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>Import</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const s = parseImport(await f.text());
                if (s) { dispatch({ type: 'import', state: s }); toast('✅ Backup restored', 'Your habits were imported.'); }
                else toast('⚠️ Import failed', 'That file is not a valid Rhythm backup.');
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
