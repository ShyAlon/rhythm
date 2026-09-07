# Rhythm - Daily Habits

An installable PWA for tracking recurring daily and weekly habits: reminders, streaks, and
adherence stats. v2 adds accounts, cross-device cloud sync, and real push notifications -
on a stack designed to cost **$0/month** for the first ~10 users.

![icon](public/icons/icon-192.png)

## Features

- **Today view** - checklist of what's due today with a progress ring and one-tap check-off
- **Full schedule CRUD** - habits with emoji, color, notes, optional target time (e.g. "stop eating by 20:00")
- **Recurrence** - daily, or weekly on specific weekdays
- **Accounts + cloud sync** - email/password sign-in; habits and completions sync across devices
  (last-write-wins, tombstone deletes, offline-first with automatic catch-up)
- **Push reminders** - server-sent Web Push (VAPID) that arrives even when the app is closed,
  per-habit reminder times evaluated in the user's own timezone. Works on installed iOS PWAs (16.4+).
- **Adherence tracking** - current/best streaks, 7- and 30-day adherence, 12-week heatmap per habit
- **Backup** - JSON export/import of all data
- **PWA** - installable, offline-capable, app-badge with today's remaining count

## Architecture (all free tier)

| Piece | Service | Free-tier ceiling (check current numbers) | Headroom at 10 users |
|---|---|---|---|
| Hosting | GitHub Pages | 100 GB/mo bandwidth, public repos | Enormous |
| CI + cron | GitHub Actions | Free for public repos | Enormous |
| Auth | Supabase Auth | 50,000 MAU | 10 users |
| Database | Supabase Postgres | 500 MB | ~1 MB typical |
| Sync realtime | Supabase Realtime | included | trivial |
| Push sender | Supabase Edge Functions | 500k invocations/mo | ~90k/mo at 5-min cron |
| Push transport | Web Push (VAPID) via browser vendors | free | - |

Two free-tier gotchas, both mitigated:

- **Supabase free projects pause after ~7 days of inactivity.** The `dispatch-reminders`
  GitHub Actions cron hits the database every 5 minutes, which keeps the project active.
- **GitHub's scheduled workflows can run a few minutes late under load.** The dispatcher
  uses a 10-minute lookback window with per-day dedupe, so reminders still fire (at most
  once per habit per day).

Guardrails: 100 live habits per user (DB trigger). See `V3-SECURITY.md` for the
security/privacy hardening backlog.

## Repo layout

- `src/` - React app (Today / Schedule / Stats / Account views, sync engine, push client)
- `public/sw.js` - service worker: offline shell + Web Push handlers
- `supabase/schema.sql` - full database schema (tables, RLS, limits) - idempotent
- `supabase/functions/dispatch/index.ts` - reminder dispatcher edge function
- `.github/workflows/deploy.yml` - build + publish to `gh-pages`
- `.github/workflows/dispatch.yml` - every-5-minutes call to the dispatcher

## One-time backend setup

1. Create a Supabase project (supabase.com, free tier). Region closest to your users.
2. Apply the schema: SQL editor -> paste `supabase/schema.sql` -> run.
3. Deploy the edge function (`supabase functions deploy dispatch`) and set its secrets:
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` - the Web Push keypair (generate with `npx web-push generate-vapid-keys`)
   - `VAPID_SUBJECT` - a contact URL, e.g. `https://github.com/<you>/rhythm`
   - `DISPATCH_SECRET` - any long random string
4. In Auth settings, disable "Confirm email" (v2 uses password sign-in without email
   verification; email confirmation is on the v3 list).
5. Set GitHub repo secrets:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - from project settings (build-time, public by design)
   - `SUPABASE_FUNCTION_URL` - `https://<project-ref>.supabase.co/functions/v1/dispatch`
   - `DISPATCH_SECRET` - same value as the edge function secret
6. Push to `main` - the deploy workflow publishes to GitHub Pages.

## Develop

```bash
npm install
npm run dev        # local-only without env keys
```

With a backend, copy the two `VITE_` values into `.env.local`.

## Build & deploy

`npm run build` outputs to `dist/` (base path `/rhythm/`). The `deploy` GitHub Actions
workflow builds and publishes to the `gh-pages` branch on every push to `main`.

Live at https://shyalon.github.io/rhythm/
