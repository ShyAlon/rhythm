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
