# V3 backlog - security & privacy hardening

Deliberately deferred from v2 (per product decision). Nothing here is forgotten;
review before opening the app beyond the initial ~10-user circle.

## Auth & access
- [ ] Turn on email confirmation (currently autoconfirm) and rate-limit signups
- [ ] Add OAuth providers (Google/Apple) + MFA option
- [ ] Session/device management page (list + revoke sessions)

## Data protection
- [ ] Audit RLS policies with adversarial tests (v2 ships minimal per-user isolation only)
- [ ] Server-side input validation (habit fields, recurrence shape, tz strings)
- [ ] Consider encrypting notes/habit names at the application layer
- [ ] Hard-delete flow for tombstoned habits and orphaned completions (retention job)
- [ ] Account self-deletion endpoint (GDPR "right to erasure") + data export already in app

## Abuse & limits
- [ ] Push-send rate limiting per user (dispatch currently trusts schedule data)
- [ ] Storage/completion growth caps beyond the 100-habit limit
- [ ] CAPTCHA on signup if the app becomes public

## Secrets & infra
- [ ] Rotate VAPID keypair and document the rotation runbook
- [ ] Pin third-party GitHub Actions to commit SHAs (peaceiris/actions-gh-pages)
- [ ] Move dispatch secret rotation into a documented process
- [ ] Server-side clock authority for updated_at (client clocks are trusted in v2)

## Compliance-ish
- [ ] Privacy policy page (data stored: email, habit names/notes, push endpoints)
- [ ] Data-processing note for push payload content transiting push services (Apple/Google/Mozilla)
