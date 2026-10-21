-- ============================================================================
-- FOLLOW-UP for the remote Supabase project (dqvjhrytejtpyxmellbd)
--
-- The first deployment applied everything in supabase/migrations EXCEPT the eight
-- functions below, because the Supabase MCP tool holds back any statement containing
-- `delete from public.<table>` for explicit confirmation, and that confirmation did not
-- come through. This file contains those functions, copied verbatim from the migrations,
-- plus the EXECUTE grants that migration 06 could not issue yet. Run it ONCE in the Supabase
-- SQL editor (Dashboard -> SQL Editor), as one script.
--
-- Until it is run, the site is NOT ready for real use: without recompute_player_stats and its
-- triggers, verified matches would not update statistics; without admin_set_role and
-- admin_unlink_chess_account, roles cannot be managed and links cannot be removed.
-- ============================================================================

begin;

-- from 02_identity: unlink a Chess.com account (contains DELETE)
create function app_private.unlink_chess_account(p_user uuid, p_actor uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_link public.chess_account_links;
begin
  select * into v_link from public.chess_account_links where user_id = p_user for update;
  if not found then return false; end if;
  insert into public.chess_link_history (user_id, chess_username, chess_player_id, verification_method, verified_at, unlinked_by, reason)
  values (v_link.user_id, v_link.chess_username, v_link.chess_player_id, v_link.verification_method, v_link.verified_at, p_actor, p_reason);
  delete from public.chess_account_links where id = v_link.id;
  -- Games already verified stay (they record the usernames used at the time); anything
  -- still in flight can no longer be attributed safely and is handed to a moderator.
  perform app_private.detach_player_from_challenges(p_user, 'participant Chess.com link removed');
  perform app_private.write_audit(p_actor, 'admin', 'chess_link.unlinked', 'profile', p_user::text, p_reason,
    jsonb_build_object('chess_username', v_link.chess_username, 'chess_player_id', v_link.chess_player_id), null);
  return true;
end;
$$;

create function public.admin_unlink_chess_account(p_user uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := app_private.require_role(array['verification_admin']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if not app_private.unlink_chess_account(p_user, v_actor, btrim(p_reason)) then
    return false;
  end if;
  perform app_private.notify(p_user, 'recovery_decision', 'Chess.com link removed',
    'An administrator removed the link to your Chess.com account. Reason: ' || btrim(p_reason), '{}'::jsonb);
  return true;
end;
$$;

-- from 02_identity: role management (contains DELETE)
-- Role management. Only super admins; the last super admin cannot be removed and
-- nobody can change their own roles (prevents accidental lock-out and self-escalation).
create function public.admin_set_role(p_user uuid, p_role public.app_role, p_grant boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
begin
  v_actor := app_private.require_role(array[]::public.app_role[]);   -- super_admin only
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_user = v_actor then raise exception 'you cannot change your own roles' using errcode = 'P0001'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'user not found' using errcode = 'P0002'; end if;

  if p_grant then
    insert into public.admin_roles (user_id, role, granted_by) values (p_user, p_role, v_actor) on conflict do nothing;
  else
    if p_role = 'super_admin' and (select count(*) from public.admin_roles where role = 'super_admin') <= 1 then
      raise exception 'cannot remove the last super admin' using errcode = 'P0001';
    end if;
    delete from public.admin_roles where user_id = p_user and role = p_role;
  end if;
  perform app_private.write_audit(v_actor, 'admin', case when p_grant then 'role.granted' else 'role.revoked' end,
    'profile', p_user::text, btrim(p_reason), null, jsonb_build_object('role', p_role));
end;
$$;

-- from 04_matchmaking: statistics recompute and its triggers (contains DELETE)
-- ---------------------------------------------------------------------------
-- Statistics: deterministic full recompute from verified matches
-- ---------------------------------------------------------------------------
-- Rules (documented in docs/SCORING.md):
--   result: win / draw / loss from each player's side
--   points: points_per_win (3) per win, points_per_draw (1) per draw, 0 per loss
--   win rate: wins / games_played (draws are in the denominator)
--   Elo: everyone starts at elo_initial_rating (1000); matches are replayed in
--        (ended_at, id) order with the standard expected-score formula and
--        K = elo_k_factor (32). A deleted player's matches still move their opponent's
--        rating, keyed by Chess.com username, so history is stable under deletions.
-- Only matches with status = 'verified' count; disputed and voided matches are excluded.
create function app_private.recompute_player_stats() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_k numeric := app_private.setting_num('elo_k_factor', 32);
  v_init numeric := app_private.setting_num('elo_initial_rating', 1000);
  v_win integer := app_private.setting_num('points_per_win', 3)::integer;
  v_draw integer := app_private.setting_num('points_per_draw', 1)::integer;
  r record;
  v_wk text;
  v_bk text;
  v_we numeric;
  v_be numeric;
  v_exp numeric;
  v_score numeric;
begin
  perform pg_advisory_xact_lock(hashtext('mnnit.recompute_player_stats'));

  create temporary table if not exists _elo (k text primary key, elo numeric not null) on commit drop;
  truncate _elo;

  for r in
    select white_user_id, black_user_id, white_username, black_username, result
    from public.college_matches where status = 'verified'
    order by ended_at, id
  loop
    v_wk := coalesce(r.white_user_id::text, 'u:' || r.white_username);
    v_bk := coalesce(r.black_user_id::text, 'u:' || r.black_username);
    insert into _elo values (v_wk, v_init) on conflict (k) do nothing;
    insert into _elo values (v_bk, v_init) on conflict (k) do nothing;
    select elo into v_we from _elo where k = v_wk;
    select elo into v_be from _elo where k = v_bk;
    v_exp := 1 / (1 + power(10::numeric, (v_be - v_we) / 400));
    v_score := case r.result when 'white' then 1 when 'black' then 0 else 0.5 end;
    update _elo set elo = elo + v_k * (v_score - v_exp) where k = v_wk;
    update _elo set elo = elo + v_k * ((1 - v_score) - (1 - v_exp)) where k = v_bk;
  end loop;

  with sides as (
    select white_user_id as user_id,
           case result when 'white' then 'w' when 'black' then 'l' else 'd' end as outcome, ended_at
      from public.college_matches where status = 'verified' and white_user_id is not null
    union all
    select black_user_id,
           case result when 'black' then 'w' when 'white' then 'l' else 'd' end, ended_at
      from public.college_matches where status = 'verified' and black_user_id is not null
  ), agg as (
    select user_id,
           count(*)::integer as games,
           count(*) filter (where outcome = 'w')::integer as wins,
           count(*) filter (where outcome = 'l')::integer as losses,
           count(*) filter (where outcome = 'd')::integer as draws,
           max(ended_at) as last_at
      from sides group by user_id
  )
  insert into public.player_stats as s (user_id, games_played, wins, losses, draws, points, win_rate, elo, last_match_at, updated_at)
  select a.user_id, a.games, a.wins, a.losses, a.draws,
         a.wins * v_win + a.draws * v_draw,
         case when a.games > 0 then round(a.wins::numeric / a.games, 5) end,
         round(coalesce(e.elo, v_init), 1), a.last_at, now()
    from agg a
    join public.profiles p on p.id = a.user_id
    left join _elo e on e.k = a.user_id::text
  on conflict (user_id) do update
    set games_played = excluded.games_played, wins = excluded.wins, losses = excluded.losses,
        draws = excluded.draws, points = excluded.points, win_rate = excluded.win_rate,
        elo = excluded.elo, last_match_at = excluded.last_match_at, updated_at = now();

  delete from public.player_stats ps
   where not exists (
     select 1 from public.college_matches m
      where m.status = 'verified' and (m.white_user_id = ps.user_id or m.black_user_id = ps.user_id));
end;
$$;

create function app_private.college_matches_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.is_demo := coalesce((select is_demo from public.profiles where id = new.white_user_id), false)
              or coalesce((select is_demo from public.profiles where id = new.black_user_id), false);
  return new;
end;
$$;
create trigger college_matches_before_write before insert on public.college_matches
  for each row execute function app_private.college_matches_before_write();

create function app_private.college_matches_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.recompute_player_stats();
  return null;
end;
$$;
create trigger college_matches_recompute after insert or update or delete on public.college_matches
  for each statement execute function app_private.college_matches_changed();

-- Admin / maintenance entry point (e.g. after changing scoring settings).
create function public.recompute_all_stats() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.recompute_player_stats();
end;
$$;

-- from 05_queries: scheduled housekeeping (contains DELETE)
-- ---------------------------------------------------------------------------
-- Scheduled maintenance (service_role)
-- ---------------------------------------------------------------------------
create function public.run_housekeeping() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_buckets bigint;
  v_notifications integer;
  v_attempts integer;
  v_jobs integer;
begin
  v_buckets := app_private.purge_rate_limits();
  delete from public.notifications where read_at is not null and read_at < now() - interval '90 days';
  get diagnostics v_notifications = row_count;
  delete from public.match_sync_attempts where attempted_at < now() - interval '180 days';
  get diagnostics v_attempts = row_count;
  delete from public.job_runs where started_at < now() - interval '90 days';
  get diagnostics v_jobs = row_count;
  -- A leased row whose worker died is released automatically when the lease expires.
  return jsonb_build_object('rate_limit_buckets', v_buckets, 'notifications', v_notifications,
                            'sync_attempts', v_attempts, 'job_runs', v_jobs);
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE privileges (the equivalents of what migration 06 does for the other functions)
-- ---------------------------------------------------------------------------
-- Postgres gives every NEW function EXECUTE for PUBLIC. Migration 06 closed the functions that
-- existed when it ran; these eight were created afterwards, so close them the same way first.
revoke all on function
  app_private.unlink_chess_account(uuid, uuid, text),
  app_private.recompute_player_stats(),
  app_private.college_matches_before_write(),
  app_private.college_matches_changed(),
  public.recompute_all_stats(),
  public.run_housekeeping(),
  public.admin_unlink_chess_account(uuid, text),
  public.admin_set_role(uuid, public.app_role, boolean, text)
from public, anon, authenticated;

-- Administrator RPCs: each calls app_private.require_role(...) first.
grant execute on function
  public.admin_unlink_chess_account(uuid, text),
  public.admin_set_role(uuid, public.app_role, boolean, text)
to authenticated;

-- Trusted server only.
grant execute on function
  app_private.unlink_chess_account(uuid, uuid, text),
  app_private.recompute_player_stats(),
  app_private.college_matches_before_write(),
  app_private.college_matches_changed(),
  public.recompute_all_stats(),
  public.run_housekeeping()
to service_role;

commit;
