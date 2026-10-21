-- ============================================================================
-- 05 · Read APIs: leaderboards, directory, match history, admin overview, settings
-- ============================================================================
-- The public query functions are SECURITY INVOKER on purpose: they run with the caller's
-- privileges, so row-level security (migration 06) decides what each visitor can see.
-- They add sorting, ranking and pagination in the database so large tables are never
-- shipped to the application.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Leaderboards
-- ---------------------------------------------------------------------------
-- Boards (all rank only approved players with a verified Chess.com link):
--   chesscom_rating  imported Chess.com rating for ONE category (p_time_class)
--   wins             college wins
--   points           college match points
--   elo              college Elo derived from verified college matches
--   games            verified college matches played
--   win_rate         wins / games_played, only players with >= min_games_for_win_rate games
--   activity         verified college matches in the last 30 days
-- Every ordering ends in (chess_username, user_id), so ranks are fully deterministic.
create function public.get_leaderboard(
  p_board text,
  p_time_class public.time_class default 'rapid',
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  rank bigint,
  user_id uuid,
  display_name text,
  avatar_url text,
  chess_username text,
  chess_rating integer,
  ratings_synced_at timestamptz,
  games_played integer,
  wins integer,
  losses integer,
  draws integer,
  points integer,
  win_rate numeric,
  elo numeric,
  matches_30d integer,
  last_match_at timestamptz,
  total_count bigint
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_where text;
  v_order text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_min_games integer := app_private.setting_num('min_games_for_win_rate', 5)::integer;
  v_init numeric := app_private.setting_num('elo_initial_rating', 1000);
begin
  case p_board
    when 'chesscom_rating' then
      v_where := 'chess_rating is not null';
      v_order := 'chess_rating desc, (record_wins + record_losses + record_draws) desc';
    when 'wins' then
      v_where := 'games_played > 0';
      v_order := 'wins desc, losses asc, games_played asc';
    when 'points' then
      v_where := 'games_played > 0';
      v_order := 'points desc, wins desc, games_played asc';
    when 'elo' then
      v_where := 'games_played > 0';
      v_order := 'elo desc, games_played desc, wins desc';
    when 'games' then
      v_where := 'games_played > 0';
      v_order := 'games_played desc, wins desc';
    when 'win_rate' then
      v_where := format('games_played >= %s', greatest(v_min_games, 1));
      v_order := 'win_rate desc, games_played desc, wins desc';
    when 'activity' then
      v_where := 'matches_30d > 0';
      v_order := 'matches_30d desc, last_match_at desc';
    else
      raise exception 'unknown leaderboard: %', p_board using errcode = '22023';
  end case;

  return query execute format($q$
    with base as (
      select p.id as user_id, p.display_name, p.avatar_url, l.chess_username,
             r.rating as chess_rating, r.fetched_at as ratings_synced_at,
             coalesce(r.record_wins, 0) as record_wins, coalesce(r.record_losses, 0) as record_losses,
             coalesce(r.record_draws, 0) as record_draws,
             coalesce(s.games_played, 0) as games_played, coalesce(s.wins, 0) as wins,
             coalesce(s.losses, 0) as losses, coalesce(s.draws, 0) as draws, coalesce(s.points, 0) as points,
             s.win_rate, coalesce(s.elo, $3) as elo, s.last_match_at,
             (select count(*) from public.college_matches m
               where m.status = 'verified' and m.ended_at > now() - interval '30 days'
                 and (m.white_user_id = p.id or m.black_user_id = p.id))::integer as matches_30d
        from public.profiles p
        join public.chess_account_links l on l.user_id = p.id
        left join public.chess_ratings r on r.user_id = p.id and r.time_class = $1
        left join public.player_stats s on s.user_id = p.id
       where p.is_approved
    ), ranked as (
      select b.*, row_number() over (order by %2$s, b.chess_username asc, b.user_id asc) as rn,
             count(*) over () as total
        from base b where %1$s
    )
    select rn, user_id, display_name, avatar_url, chess_username, chess_rating, ratings_synced_at,
           games_played, wins, losses, draws, points, win_rate, elo, matches_30d, last_match_at, total
      from ranked order by rn limit $2 offset %3$s
  $q$, v_where, v_order, v_offset)
  using p_time_class, v_limit, v_init;
end;
$$;

-- ---------------------------------------------------------------------------
-- Player directory
-- ---------------------------------------------------------------------------
create function public.get_player_directory(
  p_search text default null,
  p_time_class public.time_class default 'rapid',
  p_min_rating integer default null,
  p_max_rating integer default null,
  p_preferred public.time_class default null,
  p_open_only boolean default false,
  p_sort text default 'rating',
  p_limit integer default 24,
  p_offset integer default 0
) returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  chess_username text,
  chess_rating integer,
  ratings_synced_at timestamptz,
  games_played integer,
  wins integer,
  losses integer,
  draws integer,
  win_rate numeric,
  elo numeric,
  last_match_at timestamptz,
  open_to_challenges boolean,
  preferred_time_classes public.time_class[],
  total_count bigint
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_order text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 24), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_pattern text;
  v_init numeric := app_private.setting_num('elo_initial_rating', 1000);
begin
  v_order := case p_sort
    when 'rating' then 'chess_rating desc nulls last'
    when 'wins' then 'wins desc'
    when 'games' then 'games_played desc'
    when 'recent' then 'last_match_at desc nulls last'
    when 'name' then 'lower(display_name) asc'
    else null end;
  if v_order is null then
    raise exception 'unknown sort: %', p_sort using errcode = '22023';
  end if;

  if p_search is not null and btrim(p_search) <> '' then
    v_pattern := '%' || replace(replace(replace(lower(btrim(left(p_search, 60))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query execute format($q$
    with base as (
      select p.id as user_id, p.display_name, p.avatar_url, l.chess_username,
             r.rating as chess_rating, r.fetched_at as ratings_synced_at,
             coalesce(s.games_played, 0) as games_played, coalesce(s.wins, 0) as wins,
             coalesce(s.losses, 0) as losses, coalesce(s.draws, 0) as draws,
             s.win_rate, coalesce(s.elo, $7) as elo, s.last_match_at,
             p.open_to_challenges, p.preferred_time_classes
        from public.profiles p
        join public.chess_account_links l on l.user_id = p.id
        left join public.chess_ratings r on r.user_id = p.id and r.time_class = $1
        left join public.player_stats s on s.user_id = p.id
       where p.is_approved
         and ($2::text is null or lower(p.display_name) like $2 escape '\' or l.chess_username like $2 escape '\')
         and ($3::integer is null or r.rating >= $3)
         and ($4::integer is null or r.rating <= $4)
         and ($5::public.time_class is null or $5 = any (p.preferred_time_classes))
         and (not $6 or p.open_to_challenges)
    )
    select b.*, count(*) over () as total_count
      from base b
     order by %1$s, b.chess_username asc, b.user_id asc
     limit %2$s offset %3$s
  $q$, v_order, v_limit, v_offset)
  using p_time_class, v_pattern, p_min_rating, p_max_rating, p_preferred, coalesce(p_open_only, false), v_init;
end;
$$;

-- ---------------------------------------------------------------------------
-- Match history (public: verified matches only)
-- ---------------------------------------------------------------------------
create function public.get_recent_matches(
  p_limit integer default 20,
  p_offset integer default 0,
  p_time_class public.time_class default null,
  p_username text default null,
  p_outcome text default null          -- 'win' | 'loss' | 'draw' from p_username's point of view
) returns table (
  id uuid,
  game_url text,
  white_username text,
  black_username text,
  white_display_name text,
  black_display_name text,
  result text,
  time_control text,
  time_class public.time_class,
  rated boolean,
  ended_at timestamptz,
  source public.match_source,
  total_count bigint
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_name text := public.normalize_chess_username(p_username);
begin
  if p_outcome is not null and p_outcome not in ('win', 'loss', 'draw') then
    raise exception 'invalid outcome filter' using errcode = '22023';
  end if;
  if p_outcome is not null and v_name is null then
    raise exception 'an outcome filter needs a player' using errcode = '22023';
  end if;

  return query
  select m.id, m.game_url, m.white_username, m.black_username, wp.display_name, bp.display_name,
         m.result, m.time_control, m.time_class, m.rated, m.ended_at, m.source,
         count(*) over () as total_count
    from public.college_matches m
    left join public.profiles wp on wp.id = m.white_user_id
    left join public.profiles bp on bp.id = m.black_user_id
   where m.status = 'verified'
     and (p_time_class is null or m.time_class = p_time_class)
     and (v_name is null or m.white_username = v_name or m.black_username = v_name)
     and (p_outcome is null
          or (p_outcome = 'draw' and m.result = 'draw')
          or (p_outcome = 'win' and ((m.white_username = v_name and m.result = 'white') or (m.black_username = v_name and m.result = 'black')))
          or (p_outcome = 'loss' and ((m.white_username = v_name and m.result = 'black') or (m.black_username = v_name and m.result = 'white'))))
   order by m.ended_at desc, m.id desc
   limit greatest(1, least(coalesce(p_limit, 20), 100)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create function public.get_public_summary() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'verified_players', (select count(*) from public.profiles where is_approved),
    'verified_matches', (select count(*) from public.college_matches where status = 'verified'),
    'matches_30d', (select count(*) from public.college_matches where status = 'verified' and ended_at > now() - interval '30 days'),
    'last_match_at', (select max(ended_at) from public.college_matches where status = 'verified')
  )
$$;

-- ---------------------------------------------------------------------------
-- Settings (super admin)
-- ---------------------------------------------------------------------------
create function public.admin_update_setting(p_key text, p_value jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_old jsonb;
begin
  v_actor := app_private.require_role(array[]::public.app_role[]);   -- super_admin only
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select value into v_old from public.app_settings where key = p_key for update;
  if not found then raise exception 'unknown setting' using errcode = 'P0002'; end if;
  if jsonb_typeof(v_old) <> jsonb_typeof(p_value) then
    raise exception 'setting % expects a % value', p_key, jsonb_typeof(v_old) using errcode = '22023';
  end if;
  if jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric < 0 then
    raise exception 'numeric settings cannot be negative' using errcode = '22023';
  end if;
  update public.app_settings set value = p_value, updated_by = v_actor, updated_at = now() where key = p_key;
  perform app_private.write_audit(v_actor, 'admin', 'setting.updated', 'app_setting', p_key, btrim(p_reason),
    jsonb_build_object('value', v_old), jsonb_build_object('value', p_value));
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin analytics (aggregates only; any admin role, including the read-only analyst)
-- ---------------------------------------------------------------------------
create function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_admin() then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'players', jsonb_build_object(
      'accounts', (select count(*) from public.profiles),
      'eligible', (select count(*) from public.profiles where eligibility_status = 'verified'),
      'chess_verified', (select count(*) from public.chess_account_links),
      'approved', (select count(*) from public.profiles where is_approved),
      'suspended', (select count(*) from public.profiles where account_status = 'suspended'),
      'new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days')
    ),
    'queues', jsonb_build_object(
      'claims_needing_review', (select count(*) from public.chess_link_claims where status = 'needs_review'),
      'eligibility_requests', (select count(*) from public.eligibility_requests where status = 'open'),
      'recovery_requests', (select count(*) from public.account_recovery_requests where status = 'open'),
      'challenges_needing_review', (select count(*) from public.challenges where status = 'needs_review'),
      'open_disputes', (select count(*) from public.match_disputes where status = 'open')
    ),
    'challenges', jsonb_build_object(
      'created_7d', (select count(*) from public.challenges where created_at > now() - interval '7 days'),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.challenges group by status) s), '{}'::jsonb)
    ),
    'matches', jsonb_build_object(
      'verified_total', (select count(*) from public.college_matches where status = 'verified'),
      'verified_7d', (select count(*) from public.college_matches where status = 'verified' and ended_at > now() - interval '7 days'),
      'disputed', (select count(*) from public.college_matches where status = 'disputed')
    ),
    'sync', jsonb_build_object(
      'players_with_errors', (select count(*) from public.chess_sync_state where error_count > 0),
      'players_never_synced', (select count(*) from public.chess_sync_state where last_success_at is null),
      'last_runs', coalesce((
        select jsonb_agg(jsonb_build_object('job', j.job, 'status', j.status, 'started_at', j.started_at, 'finished_at', j.finished_at))
        from (select distinct on (job) job, status, started_at, finished_at from public.job_runs order by job, started_at desc) j
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Admin: force a player's next profile/stats refresh.
create function public.admin_retry_player_sync(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := app_private.require_role(array['verification_admin', 'match_moderator']::public.app_role[]);
  update public.chess_sync_state set next_sync_at = now(), error_count = 0 where user_id = p_user;
  if not found then raise exception 'player has no sync state' using errcode = 'P0002'; end if;
  perform app_private.write_audit(v_actor, 'admin', 'player_sync.retried', 'profile', p_user::text, null);
end;
$$;

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

create function public.start_job_run(p_job text) returns bigint
language sql security definer set search_path = '' as $$
  insert into public.job_runs (job) values (p_job) returning id
$$;

create function public.finish_job_run(p_id bigint, p_status text, p_stats jsonb default '{}'::jsonb, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update public.job_runs set finished_at = now(), status = p_status, stats = coalesce(p_stats, '{}'::jsonb), error = left(p_error, 1000)
   where id = p_id
$$;
