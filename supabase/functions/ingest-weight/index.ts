// Rhythm weight ingest endpoint - the Apple Health Shortcut bridge.
// Auth: a per-user ingest token in the JSON body (generated and shown in the
// app under Stats > Weight > Apple Health sync; regenerating invalidates it).
// No Supabase JWT: an iOS Shortcut cannot hold a session, so the token IS the
// credential. 192 bits of entropy, exact-match lookup, no user enumeration
// (unknown token and malformed token both return the same 401).
//
// POST { "token": "rhythm_ingest_<48 hex>", "kg": 83.4, "taken_at": "<ISO, optional>" }
// -> { ok: true } | { ok: true, deduped: true } | 4xx/5xx { error }
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const TOKEN_RE = /^rhythm_ingest_[0-9a-f]{48}$/;
const TAKEN_AT_MIN = Date.parse('2020-01-01T00:00:00.000Z');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const token = body?.token;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return json({ error: 'unauthorized' }, 401);

  const kg = Number(body?.kg);
  if (!Number.isFinite(kg) || kg <= 20 || kg >= 400) return json({ error: 'kg out of range (20-400)' }, 400);

  let takenAt = Date.now();
  if (body?.taken_at != null) {
    const t = Date.parse(String(body.taken_at));
    if (!Number.isFinite(t)) return json({ error: 'taken_at is not a date' }, 400);
    takenAt = t;
  }
  if (takenAt > Date.now() + 24 * 3600 * 1000) return json({ error: 'taken_at in the future' }, 400);
  if (takenAt < TAKEN_AT_MIN) return json({ error: 'taken_at too far in the past' }, 400);

  const source =
    typeof body?.source === 'string' && body.source.length > 0 && body.source.length <= 40
      ? body.source
      : 'apple-health';

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: tok, error: tokErr } = await sb
    .from('ingest_tokens')
    .select('user_id')
    .eq('token', token)
    .maybeSingle();
  if (tokErr) return json({ error: tokErr.message }, 500);
  if (!tok) return json({ error: 'unauthorized' }, 401);

  const iso = new Date(takenAt).toISOString();
  const { error } = await sb
    .from('weight_entries')
    .insert({ user_id: tok.user_id, kg, taken_at: iso, source });
  if (error) {
    // Unique (user_id, taken_at): a re-fired Shortcut with the same sample is a no-op.
    if (error.code === '23505') return json({ ok: true, deduped: true });
    return json({ error: error.message }, 500);
  }
  return json({ ok: true });
});
