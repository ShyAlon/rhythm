import { useMemo } from 'react';
import { useStore } from '../store';
import { currentStreak, dailyScore, dateKey, dueOn, isCompleted } from '../logic';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = total === 0 ? 1 : done / total;
  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 80 80" className="ring">
        <circle cx="40" cy="40" r={r} className="ring-bg" />
        <circle
          cx="40" cy="40" r={r}
          className="ring-fg"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="ring-label">
        <span className="ring-num">{done}/{total}</span>
        <span className="ring-sub">today</span>
      </div>
    </div>
  );
}

export default function Today() {
  const { state, dispatch } = useStore();
  const now = new Date();
  const key = dateKey(now);
  const list = useMemo(() => dueOn(state, now), [state]);
  const doneCount = list.filter((h) => isCompleted(state, h.id, key)).length;
  const score = dailyScore(state, key);
  const allDone = list.length > 0 && doneCount === list.length;

  return (
    <div className="view">
      <header className="today-head">
        <div>
          <h1 className="today-date">{DAY_NAMES[now.getDay()]}</h1>
          <p className="today-sub">{MONTHS[now.getMonth()]} {now.getDate()}, {now.getFullYear()}</p>
          <p className={`today-score ${score < 0 ? 'neg' : ''}`}>Score {score > 0 ? `+${score}` : score}</p>
        </div>
        <ProgressRing done={doneCount} total={list.length} />
      </header>

      {allDone && (
        <div className="alldone">
          <span className="alldone-emoji">🎉</span>
          <div>
            <strong>All done for today.</strong>
            <p>Every habit checked off. Nice rhythm.</p>
          </div>
        </div>
      )}

      {list.length === 0 && (
        <div className="empty">
          <span className="empty-emoji">🌤️</span>
          <p>Nothing scheduled for today.<br />Add a habit from the Schedule tab.</p>
        </div>
      )}

      <ul className="habit-list">
        {list.map((h) => {
          const done = isCompleted(state, h.id, key);
          const streak = currentStreak(h, state.completions[h.id] ?? []);
          return (
            <li key={h.id} className={`habit-card ${done ? 'is-done' : ''}`} style={{ ['--hc' as string]: h.color }}>
              <button
                className="check"
                aria-label={done ? `Mark ${h.name} not done` : `Mark ${h.name} done`}
                onClick={() => dispatch({ type: 'toggle', id: h.id, day: key })}
              >
                {done && <span className="check-mark">✓</span>}
              </button>
              <div className="habit-body">
                <span className="habit-emoji">{h.emoji}</span>
                <div className="habit-text">
                  <span className="habit-name">{h.name}</span>
                  <span className="habit-meta">
                    {h.kind !== 'habit' ? (h.kind === 'bonus' ? 'bonus' : 'penalty') : h.targetTime ? `by ${h.targetTime}` : 'any time'}
                    {h.reminderEnabled && h.reminderTime ? ` · 🔔 ${h.reminderTime}` : ''}
                    {' ·'}<span className={`habit-weight ${h.weight < 0 ? 'neg' : ''}`}>{h.weight > 0 ? `+${h.weight}` : h.weight}</span>
                  </span>
                </div>
              </div>
              {streak > 0 && (
                <span className="streak" title="Current streak">
                  <span className="flame">🔥</span>{streak}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
