import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { supabase, supabaseUrl } from '../supabaseClient';
import type { WeightEntry } from '../weight';
import { chartPoints, chartRange, deltaOverWindow, formatKg, inWindow, latest, sortByTakenAt } from '../weight';
import { addWeight, deleteWeight, loadIngestToken, loadWeights, resetIngestToken } from '../weightStore';

const CHART_DAYS = 90;
const LIST_MAX = 8;

function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function Weight({ toast }: { toast: (t: string, b: string) => void }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [kg, setKg] = useState('');
  const [when, setWhen] = useState(nowLocalInput);
  const [busy, setBusy] = useState(false);
  const [storedToken, setStoredToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  useEffect(() => {
    let live = true;
    loadWeights(supabase, userId).then((e) => {
      if (live) { setEntries(e); setLoaded(true); }
    });
    return () => { live = false; };
  }, [userId]);

  useEffect(() => {
    if (!supabase || !userId) return;
    let live = true;
    loadIngestToken(supabase).then((t) => { if (live) setStoredToken(t); });
    return () => { live = false; };
  }, [userId]);
  const token = userId ? storedToken : null;

  const cur = latest(entries);
  const delta = useMemo(() => deltaOverWindow(entries, 30), [entries]);
  const points = useMemo(() => chartPoints(entries, CHART_DAYS), [entries]);
  const range = useMemo(() => chartRange(entries, CHART_DAYS), [entries]);
  const recent = useMemo(() => sortByTakenAt(entries).slice(-LIST_MAX).reverse(), [entries]);

  const submit = async () => {
    const val = Number(kg);
    setBusy(true);
    const takenAt = when ? new Date(when).toISOString() : new Date().toISOString();
    const { entry, error } = await addWeight(supabase, userId, val, takenAt);
    setBusy(false);
    if (error) { toast('⚠️ Not saved', error); return; }
    if (entry) {
      setEntries((all) => sortByTakenAt([...all.filter((e) => e.id !== entry.id), entry]));
      setKg('');
      toast('✅ Weight logged', `${formatKg(entry.kg)} kg`);
    }
  };

  const remove = async (id: string) => {
    const err = await deleteWeight(supabase, userId, id);
    if (err) { toast('⚠️ Delete failed', err); return; }
    setEntries((all) => all.filter((e) => e.id !== id));
  };

  const regenToken = async () => {
    if (!supabase || !userId) return;
    setBusy(true);
    const { token: t, error } = await resetIngestToken(supabase, userId);
    setBusy(false);
    if (error) { toast('⚠️ Token failed', error); return; }
    setStoredToken(t ?? null);
    setShowToken(true);
    toast('🔑 New ingest token', token ? 'The old token stopped working.' : 'Paste it into the Shortcut.');
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('📋 Copied', what);
    } catch {
      toast('⚠️ Copy failed', 'Select the text and copy it manually.');
    }
  };

  const ingestUrl = `${supabaseUrl}/functions/v1/ingest-weight`;
  const inChart = inWindow(entries, CHART_DAYS);

  return (
    <section className="stat-card" style={{ ['--hc' as string]: '#3ddc97' }}>
      <div className="stat-head">
        <span className="habit-emoji">⚖️</span>
        <div className="habit-text">
          <span className="habit-name">Weight</span>
          <span className="habit-meta">
            {cur ? `last ${formatKg(cur.kg)} kg` : 'no entries yet'}
            {delta !== null && (
              <span className={delta <= 0 ? 'weight-delta-down' : 'weight-delta-up'}>
                {` · ${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg / 30d`}
              </span>
            )}
          </span>
        </div>
      </div>

      {points && range && (
        <div className="weight-chart-wrap">
          <svg className="weight-chart" viewBox="0 0 300 90" preserveAspectRatio="none" role="img" aria-label="Weight trend, last 90 days">
            <polyline points={points} fill="none" stroke="var(--good)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="weight-axis">
            <span>{formatKg(range.hi)} kg</span>
            <span>{inChart.length} {inChart.length === 1 ? 'entry' : 'entries'} / {CHART_DAYS}d</span>
            <span>{formatKg(range.lo)} kg</span>
          </div>
        </div>
      )}

      {loaded && entries.length === 0 && (
        <p className="settings-note">Log your first weigh-in below, or sync automatically from Apple Health.</p>
      )}

      {recent.map((e) => (
        <div key={e.id} className="weight-row">
          <span className="w-kg">{formatKg(e.kg)} kg</span>
          <span className="w-when">
            {new Date(e.takenAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {e.source !== 'manual' ? ' · Health' : ''}
          </span>
          <button className="btn ghost weight-del" aria-label="Delete entry" onClick={() => void remove(e.id)}>✕</button>
        </div>
      ))}

      <div className="weight-add">
        <label className="field" style={{ flex: 1 }}>
          <span>kg</span>
          <input
            type="number" inputMode="decimal" step="0.1" min="20" max="400" placeholder="83.4"
            value={kg} onChange={(e) => setKg(e.target.value)}
          />
        </label>
        <label className="field" style={{ flex: 1.4 }}>
          <span>when</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <button className="btn primary weight-add-btn" disabled={busy || !kg} onClick={() => void submit()}>Log</button>
      </div>

      <div className="settings-row" style={{ marginTop: 10 }}>
        <div>
          <strong>Apple Health sync</strong>
          <p className="settings-note">
            {userId
              ? 'An iPhone Shortcut posts your latest Health weight here.'
              : 'Sign in on the Account tab to enable Apple Health sync.'}
          </p>
        </div>
        {userId && (
          <button className="btn" onClick={() => setSyncOpen((o) => !o)}>{syncOpen ? 'Hide' : 'Set up'}</button>
        )}
      </div>

      {userId && syncOpen && (
        <div className="weight-sync">
          <p className="settings-note">
            Your personal ingest token. It goes in the Shortcut from the setup guide - anyone holding it can add
            weight entries, so treat it like a password.
          </p>
          {token ? (
            <>
              <div className="token-box">{showToken ? token : 'rhythm_ingest_••••••••••••••••••••••••'}</div>
              <div className="settings-actions" style={{ marginTop: 8 }}>
                <button className="btn" onClick={() => setShowToken((s) => !s)}>{showToken ? 'Hide' : 'Show'}</button>
                <button className="btn" onClick={() => void copy(token, 'Ingest token')}>Copy</button>
                <button className="btn danger" disabled={busy} onClick={() => void regenToken()}>Regenerate</button>
              </div>
            </>
          ) : (
            <div className="settings-actions" style={{ marginTop: 8 }}>
              <button className="btn primary" disabled={busy} onClick={() => void regenToken()}>Generate token</button>
            </div>
          )}
          <p className="settings-note" style={{ marginTop: 8 }}>
            Endpoint: <code className="weight-endpoint">{ingestUrl}</code>
          </p>
        </div>
      )}
    </section>
  );
}
