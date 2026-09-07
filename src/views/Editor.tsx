import { useEffect, useState } from 'react';
import { useStore, newId } from '../store';
import type { Habit, HabitKind } from '../types';

const KIND_DEFAULT_WEIGHT: Record<HabitKind, number> = { habit: 1, bonus: 1, penalty: -1 };

const EMOJIS = ['🧘','🦉','🍽️','🏋️','💧','📚','🏃','😴','🦷','💊','🎸','✍️','🧹','🌱','🙏','🚶','🥗','☕','📵','🎨','🧠','❤️','🐶','🎧'];
const COLORS = ['#6c8cff','#9d6cff','#3ddc97','#ffb020','#ff6b6b','#4fd1e0','#f472b6','#a3e635'];
const DOW = ['S','M','T','W','T','F','S'];

export default function Editor({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const { dispatch } = useStore();
  const isNew = habit === null;
  const [draft, setDraft] = useState<Habit>(() =>
    habit ?? {
      id: newId(),
      kind: 'habit',
      weight: 1,
      name: '',
      emoji: EMOJIS[0],
      color: COLORS[0],
      notes: '',
      recurrence: { kind: 'daily' },
      targetTime: null,
      reminderEnabled: false,
      reminderTime: '09:00',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archived: false,
    },
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = <K extends keyof Habit>(k: K, v: Habit[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setKind = (k: HabitKind) =>
    setDraft((d) => ({
      ...d,
      kind: k,
      weight: d.weight === KIND_DEFAULT_WEIGHT[d.kind] ? KIND_DEFAULT_WEIGHT[k] : d.weight,
    }));
  const weekly = draft.recurrence.kind === 'weekly';
  const isHabit = draft.kind === 'habit';
  const valid =
    draft.name.trim().length > 0 &&
    Number.isFinite(draft.weight) && Math.abs(draft.weight) < 1000 &&
    (draft.recurrence.kind === 'daily' || draft.recurrence.days.length > 0);

  const save = () => {
    if (!valid) return;
    // Bonus/penalty items are logged ad hoc: always daily, never scheduled or nagging.
    const shaped: Habit = isHabit
      ? draft
      : { ...draft, recurrence: { kind: 'daily' }, targetTime: null, reminderEnabled: false, reminderTime: null };
    const clean = { ...shaped, name: shaped.name.trim(), reminderTime: shaped.reminderEnabled ? shaped.reminderTime : shaped.reminderTime ?? null };
    dispatch({ type: isNew ? 'add' : 'update', habit: clean });
    onClose();
  };

  const toggleDow = (d: number) => {
    const days = draft.recurrence.kind === 'weekly' ? draft.recurrence.days : [];
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    setDraft((prev) => ({ ...prev, recurrence: { kind: 'weekly', days: next } }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={isNew ? 'New habit' : 'Edit habit'} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{isNew ? `New ${draft.kind}` : `Edit ${draft.kind}`}</h2>

        <label className="field">
          <span>Name</span>
          <input autoFocus value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Meditate" maxLength={60} />
        </label>

        <div className="field">
          <span>Icon</span>
          <div className="emoji-grid">
            {EMOJIS.map((em) => (
              <button key={em} className={`emoji-opt ${draft.emoji === em ? 'sel' : ''}`} onClick={() => set('emoji', em)}>{em}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Color</span>
          <div className="color-row">
            {COLORS.map((c) => (
              <button key={c} className={`color-opt ${draft.color === c ? 'sel' : ''}`} style={{ background: c }} onClick={() => set('color', c)} aria-label={`Color ${c}`} />
            ))}
          </div>
        </div>

        <div className="field">
          <span>Type</span>
          <div className="seg">
            <button className={`seg-btn ${draft.kind === 'habit' ? 'sel' : ''}`} onClick={() => setKind('habit')}>Habit</button>
            <button className={`seg-btn ${draft.kind === 'bonus' ? 'sel' : ''}`} onClick={() => setKind('bonus')}>Bonus</button>
            <button className={`seg-btn ${draft.kind === 'penalty' ? 'sel' : ''}`} onClick={() => setKind('penalty')}>Penalty</button>
          </div>
        </div>

        <label className="field">
          <span>Score weight</span>
          <input
            type="number"
            step="0.5"
            value={draft.weight}
            onChange={(e) => set('weight', e.target.value === '' ? 0 : Number(e.target.value))}
          />
          <em className="field-hint">Adds to your daily score when checked. Negative for penalties.</em>
        </label>

        {isHabit && (
        <div className="field">
          <span>Repeats</span>
          <div className="seg">
            <button className={`seg-btn ${!weekly ? 'sel' : ''}`} onClick={() => set('recurrence', { kind: 'daily' })}>Daily</button>
            <button className={`seg-btn ${weekly ? 'sel' : ''}`} onClick={() => set('recurrence', { kind: 'weekly', days: weekly ? (draft.recurrence as {days:number[]}).days : [1,3,5] })}>Weekly</button>
          </div>
          {weekly && (
            <div className="dow-row">
              {DOW.map((label, i) => (
                <button key={i} className={`dow ${weekly && (draft.recurrence as {days:number[]}).days.includes(i) ? 'sel' : ''}`} onClick={() => toggleDow(i)}>{label}</button>
              ))}
            </div>
          )}
        </div>

        )}

        {isHabit && (
        <>
        <label className="field">
          <span>Target time <em>(optional)</em></span>
          <input type="time" value={draft.targetTime ?? ''} onChange={(e) => set('targetTime', e.target.value || null)} />
        </label>

        <div className="field row">
          <span>Reminder</span>
          <button className={`switch ${draft.reminderEnabled ? 'on' : ''}`} role="switch" aria-checked={draft.reminderEnabled} onClick={() => set('reminderEnabled', !draft.reminderEnabled)}>
            <span className="knob" />
          </button>
        </div>
        {draft.reminderEnabled && (
          <label className="field">
            <span>Remind me at</span>
            <input type="time" value={draft.reminderTime ?? '09:00'} onChange={(e) => set('reminderTime', e.target.value || '09:00')} />
          </label>
        )}

        </>
        )}

        <label className="field">
          <span>Notes <em>(optional)</em></span>
          <input value={draft.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. Kitchen closes at 20:00" maxLength={140} />
        </label>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!valid} onClick={save}>{isNew ? 'Add habit' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
