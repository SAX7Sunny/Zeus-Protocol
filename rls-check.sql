-- ============================================================
-- ZEUS Protocol — RLS verification
-- Saved in the Supabase SQL Editor as "RLS check".
--
-- Run ONE BLOCK AT A TIME. The role switch only lasts for its
-- transaction, and the editor shows only the last result.
--
-- Test users:
--   user one   8fb41718-e645-4884-9143-3938cb99a65b
--   user two   c6ebf886-e0a6-4b5d-b45a-d48a902fd060
--
-- Verified 2026-08-17: all three checks passed.
-- ============================================================


-- ---- 1. seed  ->  expect rows_total = 2 ---------------------
-- The editor runs as owner and bypasses RLS, so both rows show.
insert into app_data (user_id, payload) values
  ('8fb41718-e645-4884-9143-3938cb99a65b', '{"test":"user one"}'),
  ('c6ebf886-e0a6-4b5d-b45a-d48a902fd060', '{"test":"user two"}')
on conflict (user_id) do update set payload = excluded.payload;

select count(*) as rows_total from app_data;


-- ---- 2. read as user one  ->  expect visible = 1 ------------
-- uid_seen must show the uuid. If it is null, the claim did not
-- take effect and the result says nothing about the policy.
begin;
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"8fb41718-e645-4884-9143-3938cb99a65b","role":"authenticated"}';
  select auth.uid() as uid_seen, count(*) as visible from app_data;
rollback;


-- ---- 3. write to the other user's row  ->  expect 0 ---------
-- The important one: blocking reads is one thing, preventing a
-- user from overwriting someone else's row is another.
begin;
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"8fb41718-e645-4884-9143-3938cb99a65b","role":"authenticated"}';
  with upd as (
    update app_data set payload = '{"test":"hijacked"}'
     where user_id = 'c6ebf886-e0a6-4b5d-b45a-d48a902fd060'
    returning 1
  )
  select count(*) as rows_changed from upd;
rollback;


-- ---- 4. clean up -------------------------------------------
delete from app_data;
