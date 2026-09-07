-- Rhythm v2 schema (Supabase / Postgres)
-- Apply via the Supabase SQL editor or the Management API. Idempotent.

-- ============ habits ============
create table if not exists public.habits (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '',
  emoji text not null default '✅',
  color text not null default '#6c8cff',
  notes text not null default '',
  recurrence jsonb not null default '{"kind":"daily"}',
  target_time text,
  reminder_enabled boolean not null default false,
  reminder_time text,
  archived boolean not null default false,
  deleted boolean not null default false,          -- tombstone for sync
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.habits enable row level security;

drop policy if exists "own habits" on public.habits;
create policy "own habits" on public.habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists habits_user_updated on public.habits (user_id, updated_at);

-- Reasonable free-tier guardrail: max 100 live habits per user.
create or replace function public.enforce_habit_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.habits where user_id = new.user_id and not deleted) >= 100 then
    raise exception 'habit_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists habits_limit on public.habits;
create trigger habits_limit before insert on public.habits
  for each row execute function public.enforce_habit_limit();

-- ============ completions ============
create table if not exists public.completions (
  habit_id text not null references public.habits (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  done boolean not null,
  updated_at timestamptz not null default now(),
  primary key (habit_id, day)
);

alter table public.completions enable row level security;

drop policy if exists "own completions" on public.completions;
create policy "own completions" on public.completions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists completions_user_updated on public.completions (user_id, updated_at);

-- ============ profiles (timezone for server-side reminders) ============
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tz text not null default 'UTC',
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ push subscriptions ============
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  keys jsonb not null,                -- { p256dh, auth }
  tz text not null default 'UTC',
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ push dedupe log (service-role only; no user policies) ============
create table if not exists public.push_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  habit_id text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, habit_id, day)
);

alter table public.push_log enable row level security;
-- Intentionally no policies: only the service role (edge function) touches this table.

-- ============ v3 additions (scoring, validation, in-DB scheduling, retention) ============
-- Rhythm v3 migration: scoring fields, input validation, in-DB scheduling, retention
alter table public.habits add column if not exists kind text not null default 'habit';
alter table public.habits add column if not exists weight numeric not null default 1;

alter table public.habits drop constraint if exists habits_kind_check;
alter table public.habits add constraint habits_kind_check check (kind in ('habit','bonus','penalty'));
alter table public.habits drop constraint if exists habits_weight_check;
alter table public.habits add constraint habits_weight_check check (weight > -1000 and weight < 1000);
alter table public.habits drop constraint if exists habits_name_len;
alter table public.habits add constraint habits_name_len check (char_length(name) <= 200);
alter table public.habits drop constraint if exists habits_notes_len;
alter table public.habits add constraint habits_notes_len check (char_length(notes) <= 2000);
alter table public.profiles drop constraint if exists profiles_tz_len;
alter table public.profiles add constraint profiles_tz_len check (char_length(tz) <= 64);

create or replace function public.valid_recurrence(r jsonb) returns boolean
language plpgsql immutable as $fn$
declare v text;
begin
  if r is null or jsonb_typeof(r) is distinct from 'object' or not (r ? 'kind') then return false; end if;
  if r->>'kind' = 'daily' then return true; end if;
  if r->>'kind' = 'weekly' then
    if jsonb_typeof(r->'days') is distinct from 'array' then return false; end if;
    for v in select jsonb_array_elements_text(r->'days') loop
      if v !~ '^[0-6]$' then return false; end if;
    end loop;
    return true;
  end if;
  return false;
exception when others then return false;
end
$fn$;

alter table public.habits drop constraint if exists habits_recurrence_shape;
alter table public.habits add constraint habits_recurrence_shape check (public.valid_recurrence(recurrence));

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$ begin perform cron.unschedule('rhythm-dispatch'); exception when others then null; end $do$;
do $do$ begin perform cron.unschedule('rhythm-retention'); exception when others then null; end $do$;

select cron.schedule('rhythm-dispatch', '*/5 * * * *', $job$select net.http_post(url := 'https://cwwyfmirxdtcfyovdfxt.supabase.co/functions/v1/dispatch', headers := '{"Content-Type":"application/json","x-dispatch-secret":"2ea91033ff5db2647c7a6037b39755e4e50572c82dacb845d63d3b87f172175e"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 30000);$job$);

create or replace function public.retention_cleanup() returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  delete from public.completions c where not exists (select 1 from public.habits h where h.id = c.habit_id);
  delete from public.habits where deleted and updated_at < now() - interval '30 days';
  delete from public.push_log where day < current_date - 30;
end
$fn$;

select cron.schedule('rhythm-retention', '17 3 1 * *', $job$select public.retention_cleanup()$job$);
