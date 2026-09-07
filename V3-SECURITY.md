# V3 security & privacy hardening

Shipped in v3 (verified against the live backend):

- [x] Credential storage audit: no usernames exist; passwords are salted bcrypt
      hashes in Supabase's internal auth.users, never in data tables (live API
      probes: no password column anywhere, auth schema unreachable via REST)
- [x] Token-expiry independence: runtime chain (publishable key, function
      secrets, dispatch secret) has no expiry; setup PATs revoked safely
- [x] Reminder scheduling moved to in-DB pg_cron (kills the GitHub 60-day
      scheduled-workflow auto-disable hole); GitHub cron kept as fallback
- [x] Adversarial RLS audit: cross-user read/write/delete, push_log lockdown,
      anon-key probes - all blocked (10/10)
- [x] Server-side input validation: DB constraints (name/notes/tz length,
      weight bounds, kind enum, recurrence shape function) + dispatcher
      guards against malformed reminder times
- [x] Email confirmation required for signup (site URL points at the app)
- [x] Account self-deletion (edge function + Account tab; cascades all data)
- [x] Hard-delete retention job (monthly pg_cron: tombstoned habits 30d+,
      orphaned completions, old push_log rows)
- [x] Third-party GitHub Actions pinned to commit SHAs
- [x] Rotation runbooks (VAPID, dispatch secret) in RUNBOOKS.md
- [x] Privacy policy page (/rhythm/privacy.html + Account tab link)

Still deferred (revisit before opening beyond the ~10-user circle):

## Auth & access
- [ ] OAuth providers (Google/Apple) + MFA option
- [ ] Session/device management page (list + revoke sessions)
- [ ] CAPTCHA on signup if the app becomes public

## Data protection
- [ ] App-layer encryption of habit names/notes (breaks search/sync simplicity;
      key-management burden - worth it only if the circle widens)
- [ ] Server-side clock authority for updated_at (client clocks still trusted)
- [ ] Push-send rate limiting per user (dispatch trusts schedule data)
- [ ] Storage/completion growth caps beyond the 100-habit limit
