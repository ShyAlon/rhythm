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

// 1. Auth server reachable.
const health = await fetch(`${url}/auth/v1/health`, { headers: h });
check('auth health endpoint reachable', health.status === 200, `status ${health.status}`);

// 2. Wrong password is rejected (auth pipeline alive).
const bad = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: h,
  body: JSON.stringify({ email: probe, password: 'definitely-wrong-password' }),
});
check('bad password rejected', bad.status === 400, `status ${bad.status}`);

// 3. Signup issues no session (email confirmation stays ON).
const up = await fetch(`${url}/auth/v1/signup`, {
  method: 'POST', headers: h,
  body: JSON.stringify({ email: probe, password: 'probe-password-123' }),
});
const upBody = await up.json().catch(() => ({}));
check('signup issues no session (email confirmation on)', up.status === 200 && !upBody.access_token, `status ${up.status}`);

// 4. Password recovery endpoint accepts requests (forgot-password flow alive).
const rec = await fetch(`${url}/auth/v1/recover`, {
  method: 'POST', headers: h, body: JSON.stringify({ email: probe }),
});
check('recovery endpoint accepts reset requests', rec.status === 200, `status ${rec.status}`);

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

if (failures) {
  console.error(`smoke-auth: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('smoke-auth: all checks passed');
