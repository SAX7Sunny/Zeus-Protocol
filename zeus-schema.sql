-- ============================================================
-- ZEUS Protocol — Supabase schema
-- Saved in the Supabase SQL Editor as "ZEUS schema".
-- Safe to re-run: create if not exists / drop policy if exists.
-- ============================================================

-- One JSON row per user, mirroring what saveAll() already writes.
-- Biomarker panels are stripped before upload and stay on-device.
create table if not exists app_data (
  user_id    uuid primary key references auth.users on delete cascade,
  payload    jsonb not null,
  updated_at timestamptz not null default now()
);

-- Explicit GDPR consent. `version` lets the prompt reappear when
-- the wording changes.
create table if not exists consents (
  user_id     uuid primary key references auth.users on delete cascade,
  accepted_at timestamptz not null default now(),
  version     text        not null
);

-- Per-user preferences: display name for the header ("Mike's Protocol")
-- and which sections the user wants visible.
create table if not exists profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text,
  sections     jsonb not null default
    '{"agenda":true,"routine":true,"supps":true,"cal":true,"bio":false}'::jsonb,
  created_at   timestamptz not null default now()
);

-- Keeps the free-tier project awake: free projects pause after 7 days
-- without database activity. A scheduled GitHub Action reads this every
-- few days. Public read is fine — it holds no personal data.
create table if not exists heartbeat (
  id        int primary key,
  pinged_at timestamptz not null default now()
);
insert into heartbeat (id) values (1) on conflict (id) do nothing;

-- Row level security. This is the actual protection: even with a bug in
-- the frontend, Postgres refuses to return another user's row.
alter table app_data  enable row level security;
alter table consents  enable row level security;
alter table profiles  enable row level security;
alter table heartbeat enable row level security;

drop policy if exists "own app_data" on app_data;
create policy "own app_data" on app_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own consent" on consents;
create policy "own consent" on consents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "public read heartbeat" on heartbeat;
create policy "public read heartbeat" on heartbeat
  for select using (true);

-- All four tables must come back with rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
