// Pre-deploy smoke checks against the live Supabase project.
// Uses only the publishable (anon) key - safe to run from CI on every deploy.
// Fails (exit 1) if auth, email-confirmation, recovery, or RLS posture regresses.
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.log('smoke-auth: SUPABASE_URL/ANON_KEY not set (local-only build) - skipping');
  process.exit(0);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures++;
};
const h = { apikey: anon, 'Content-Type': 'application/json' };
const probe = 'rhythm-ci-probe@example.com'; // disposable probe address, never confirmed

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Supabase rate-limits signup/recovery per project+IP; a 429 is infrastructure
// backpressure, not a posture regression. Retry, then accept 429 as alive-but-limited.
async function fetchTolerant(u, opts, tries = 3) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await fetch(u, opts);
    if (r.status !== 429) return r;
    await sleep(15000);
  }
  return r;
}

// 1. Auth server reachable.
const health = await fetch(`${url}/auth/v1/health`, { headers: h });
check('auth health endpoint reachable', health.status === 200, `status ${health.status}`);

// 2. Wrong password is rejected (auth pipeline alive).
const bad = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: h,
  body: JSON.stringify({ email: probe, password: 'definitely-wrong-password' }),
});
check('bad password rejected', bad.status === 400, `status ${bad.status}`);

// Supabase answers the mailer rate limit two ways depending on the error path:
// HTTP 429, or HTTP 400 with a {code:429, error_code:'over_email_send_rate_limit'}
// body. Both mean alive-but-limited - and crucially, neither carries a session.
const emailLimited = (status, body) =>
  status === 429 || (status === 400 && (body?.code === 429 || body?.error_code === 'over_email_send_rate_limit'));

// 3. Signup issues no session (email confirmation stays ON).
const up = await fetchTolerant(`${url}/auth/v1/signup`, {
  method: 'POST', headers: h,
  body: JSON.stringify({ email: probe, password: 'probe-password-123' }),
});
const upBody = await up.json().catch(() => ({}));
check(
  'signup issues no session (email confirmation on)',
  (up.status === 200 && !upBody.access_token) || (emailLimited(up.status, upBody) && !upBody.access_token),
  `status ${up.status}${emailLimited(up.status, upBody) ? ' (email rate-limited; endpoint alive)' : ''}`,
);

// 4. Password recovery endpoint accepts requests (forgot-password flow alive).
const rec = await fetchTolerant(`${url}/auth/v1/recover`, {
  method: 'POST', headers: h, body: JSON.stringify({ email: probe }),
});
const recBody = await rec.clone().json().catch(() => ({}));
check(
  'recovery endpoint accepts reset requests',
  rec.status === 200 || emailLimited(rec.status, recBody),
  `status ${rec.status}${emailLimited(rec.status, recBody) ? ' (email rate-limited; endpoint alive)' : ''}`,
);

// 5. RLS: the publishable key alone reads zero habit rows.
const rls = await fetch(`${url}/rest/v1/habits?select=id`, {
  headers: { apikey: anon, Authorization: `Bearer ${anon}` },
});
const rlsBody = await rls.json().catch(() => null);
check(
  'anon key reads zero habit rows (RLS)',
  rls.status === 200 && Array.isArray(rlsBody) && rlsBody.length === 0,
  `status ${rls.status}, rows ${Array.isArray(rlsBody) ? rlsBody.length : 'n/a'}`,
);

// 6. ingest-weight edge function is deployed and rejects a well-formed but
// unknown token (also proves the ingest tables exist from the function's side).
const ing = await fetch(`${url}/functions/v1/ingest-weight`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: `rhythm_ingest_${'0'.repeat(48)}`, kg: 80 }),
});
check('ingest-weight rejects unknown token', ing.status === 401, `status ${ing.status}`);

// 7. RLS: the publishable key alone reads zero weight rows and zero ingest tokens.
for (const table of ['weight_entries', 'ingest_tokens']) {
  const r = await fetch(`${url}/rest/v1/${table}?select=*`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  const rows = await r.json().catch(() => null);
  check(
    `anon key reads zero ${table} rows (RLS)`,
    r.status === 200 && Array.isArray(rows) && rows.length === 0,
    `status ${r.status}, rows ${Array.isArray(rows) ? rows.length : 'n/a'}`,
  );
}

if (failures) {
  console.error(`smoke-auth: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('smoke-auth: all checks passed');
