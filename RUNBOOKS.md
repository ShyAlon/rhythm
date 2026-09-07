# Rhythm ops runbooks (v3)

Short, copy-paste runbooks for the rotating parts. Everything here is free-tier.

## What runs where (credential chain)

| Piece | Where it lives | Expires? |
|---|---|---|
| Publishable API key | client bundle (public by design) | No |
| Service-role key | Supabase edge-function secrets (auto-provided) | No |
| VAPID keypair | Supabase edge-function secrets | No (rotate manually, below) |
| DISPATCH_SECRET | Supabase edge-function secrets + `cron.job` row + GitHub repo secret | No (rotate manually, below) |
| Reminder scheduling | pg_cron job `rhythm-dispatch` in the database (primary), GitHub Actions cron (fallback) | n/a |

The setup access tokens (GitHub PAT, Supabase access token) were one-time build
credentials. The running system never uses them. Revoke them at will.

## Reminder scheduling (pg_cron)

Primary: `rhythm-dispatch` pg_cron job, every 5 minutes, calls the `dispatch`
edge function via pg_net with the dispatch secret header. Inspect it:

```sql
select jobname, schedule, active from cron.job;
select status, return_message, start_time from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 'rhythm-dispatch')
  order by start_time desc limit 10;
```

Fallback: `.github/workflows/dispatch.yml` (GitHub cron). GitHub auto-disables
scheduled workflows after 60 days of repo inactivity - that's fine, pg_cron is
primary. Any push to main re-enables it.

## Rotate the dispatch secret

1. Generate: `openssl rand -hex 32`
2. Supabase dashboard - Edge Functions - dispatch - Secrets: update `DISPATCH_SECRET`.
3. Re-point the pg_cron job (SQL editor):

```sql
select cron.unschedule('rhythm-dispatch');
select cron.schedule('rhythm-dispatch', '*/5 * * * *',
  $$select net.http_post(url := 'https://cwwyfmirxdtcfyovdfxt.supabase.co/functions/v1/dispatch',
    headers := '{"Content-Type":"application/json","x-dispatch-secret":"NEW_SECRET"}'::jsonb,
    body := '{}'::jsonb, timeout_milliseconds := 30000)$$);
```

4. GitHub repo - Settings - Secrets - Actions: update `DISPATCH_SECRET` (fallback path).

## Rotate the VAPID keypair

1. Generate: `npx web-push generate-vapid-keys`
2. Supabase dashboard - Edge Functions - dispatch - Secrets: update `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
3. Update `VAPID_PUBLIC_KEY` in `src/supabaseClient.ts`, push to main (deploys automatically).
4. Users re-enable push from the Account tab (old subscriptions die on their own; the dispatcher prunes 404/410 endpoints).

## Free-tier ceilings to watch

- Supabase free: 500 MB database, 50k MAU, 500k edge-function invocations/month
  (the 5-min dispatch schedule uses ~86k), realtime included.
- Project pauses after 7 idle days - the pg_cron dispatch job keeps it warm by
  querying the database every 5 minutes.
- Guardrail: 100 live habits per user (DB trigger).
