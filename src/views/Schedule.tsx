import { useStore } from '../store';
import { recurrenceLabel } from '../logic';
import type { Habit } from '../types';

export default function Schedule({ onEdit, onAdd }: { onEdit: (h: Habit) => void; onAdd: () => void }) {
  const { state, dispatch } = useStore();
  const habits = state.habits.filter((h) => !h.archived);

  return (
    <div className="view">
      <header className="page-head">
        <h1>Schedule</h1>
        <p className="page-sub">{habits.length} habit{habits.length === 1 ? '' : 's'}</p>
      </header>

      <ul className="sched-list">
        {habits.map((h) => (
          <li key={h.id} className="sched-row" style={{ ['--hc' as string]: h.color }}>
            <span className="habit-emoji">{h.emoji}</span>
            <div className="habit-text">
              <span className="habit-name">{h.name}</span>
              <span className="habit-meta">
                {recurrenceLabel(h)}
                {h.targetTime ? ` · by ${h.targetTime}` : ''}
                {h.reminderEnabled && h.reminderTime ? ` · 🔔 ${h.reminderTime}` : ' · 🔕'}
              </span>
            </div>
            <div className="row-actions">
              <button className="icon-btn" aria-label={`Edit ${h.name}`} onClick={() => onEdit(h)}>✎</button>
              <button
                className="icon-btn danger"
                aria-label={`Delete ${h.name}`}
                onClick={() => { if (window.confirm(`Delete “${h.name}” and its history?`)) dispatch({ type: 'remove', id: h.id }); }}
              >🗑</button>
            </div>
          </li>
        ))}
      </ul>

      {habits.length === 0 && (
        <div className="empty">
          <span className="empty-emoji">🌱</span>
          <p>No habits yet. Tap + to build your first one.</p>
        </div>
      )}

      <button className="fab" aria-label="Add habit" onClick={onAdd}>+</button>
    </div>
  );
}
