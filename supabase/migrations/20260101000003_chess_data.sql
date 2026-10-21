-- ============================================================================
-- 03 · Chess.com data: supported time controls, ratings, imported games, sync state
-- ============================================================================
-- Everything here is IMPORTED data. It is written only by trusted server code
-- (service role) and clearly labelled with its source and fetch time in the UI.
-- ============================================================================

-- Time controls a challenge may use. Chess.com expresses them as "base" or "base+inc"
-- seconds for live games and "1/seconds-per-move" for daily games.
create table public.supported_time_controls (
  time_control text primary key check (time_control ~ '^([0-9]+(\+[0-9]+)?|1/[0-9]+)$'),
  label text not null,
  time_class public.time_class not null,
  sort_order smallint not null default 0,
  active boolean not null default true
);

insert into public.supported_time_controls (time_control, label, time_class, sort_order) values
  ('60',      '1 min',          'bullet', 10),
  ('120+1',   '2 min + 1 sec',  'bullet', 20),
  ('180',     '3 min',          'blitz',  30),
  ('180+2',   '3 min + 2 sec',  'blitz',  40),
  ('300',     '5 min',          'blitz',  50),
  ('600',     '10 min',         'rapid',  60),
  ('900+10',  '15 min + 10 sec','rapid',  70),
  ('1800',    '30 min',         'rapid',  80),
  ('1/86400', '1 day / move',   'daily',  90),
  ('1/259200','3 days / move',  'daily', 100);

-- Per-player synchronisation bookkeeping.
create table public.chess_sync_state (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  profile_synced_at timestamptz,
  stats_synced_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  error_count integer not null default 0,
  next_sync_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chess_sync_state_due_idx on public.chess_sync_state (next_sync_at);

-- Official Chess.com rating per category. Never merged across categories.
create table public.chess_ratings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  time_class public.time_class not null,
  rating integer not null check (rating between 0 and 4000),
  best_rating integer check (best_rating is null or best_rating between 0 and 4000),
  record_wins integer not null default 0,
  record_losses integer not null default 0,
  record_draws integer not null default 0,
  last_game_at timestamptz,
  source text not null default 'chess.com published-data API /stats',
  fetched_at timestamptz not null default now(),
  primary key (user_id, time_class)
);
create index chess_ratings_leaderboard_idx on public.chess_ratings (time_class, rating desc);

create table public.chess_rating_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  time_class public.time_class not null,
  rating integer not null,
  observed_at timestamptz not null default now()
);
create index chess_rating_history_idx on public.chess_rating_history (user_id, time_class, observed_at);

-- Games between two linked members, reconciled from both archives. Each game exists
-- once: Chess.com's game URL (and uuid, when supplied) are unique.
create table public.imported_chess_games (
  id uuid primary key default gen_random_uuid(),
  game_url text not null,
  game_uuid uuid,
  white_username text not null,
  black_username text not null,
  white_rating integer,
  black_rating integer,
  white_result text,
  black_result text,
  winner text not null check (winner in ('white', 'black', 'draw', 'unknown')),
  time_control text,
  time_class public.time_class,
  rules text not null default 'chess',
  rated boolean,
  started_at timestamptz,
  ended_at timestamptz not null,
  archive_month text,
  source text not null default 'chess.com published-data API',
  imported_at timestamptz not null default now(),
  constraint imported_chess_games_url_key unique (game_url),
  constraint imported_chess_games_uuid_key unique (game_uuid),
  constraint imported_chess_games_players_valid check (
    public.is_valid_chess_username(white_username) and public.is_valid_chess_username(black_username)
    and white_username <> black_username
  ),
  constraint imported_chess_games_url_valid check (game_url ~ '^https://www\.chess\.com/')
);
create index imported_chess_games_pair_idx on public.imported_chess_games (white_username, black_username, ended_at);
create index imported_chess_games_black_idx on public.imported_chess_games (black_username, ended_at);
create index imported_chess_games_ended_idx on public.imported_chess_games (ended_at desc);

-- Conditional-request cache for monthly archives (ETag / Last-Modified).
create table public.chess_archive_state (
  chess_username text not null,
  archive_month text not null check (archive_month ~ '^[0-9]{4}/[0-9]{2}$'),
  etag text,
  last_modified text,
  checked_at timestamptz not null default now(),
  game_count integer not null default 0,
  primary key (chess_username, archive_month)
);

-- ---------------------------------------------------------------------------
-- Trusted-server functions (service_role only; see migration 07)
-- ---------------------------------------------------------------------------

-- Leases a batch of linked players that are due for a profile/stats refresh.
create function public.claim_players_for_sync(p_limit integer default 20, p_lease_seconds integer default 600)
returns table (user_id uuid, chess_username text, chess_player_id bigint)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select s.user_id
    from public.chess_sync_state s
    join public.chess_account_links l on l.user_id = s.user_id
    join public.profiles p on p.id = s.user_id
    where s.next_sync_at <= now() and p.account_status = 'active'
    order by s.next_sync_at
    limit greatest(1, least(p_limit, 200))
    for update of s skip locked
  ), leased as (
    update public.chess_sync_state s
       set next_sync_at = now() + make_interval(secs => p_lease_seconds)
      from due where s.user_id = due.user_id
    returning s.user_id
  )
  select l.user_id, l.chess_username, l.chess_player_id
  from leased join public.chess_account_links l on l.user_id = leased.user_id;
end;
$$;

-- Stores the outcome of one player's refresh. `p_ratings` is an array of
-- { time_class, rating, best_rating, wins, losses, draws, last_game_at }.
create function public.record_player_sync(
  p_user uuid,
  p_ok boolean,
  p_error text default null,
  p_observed_player_id bigint default null,
  p_observed_username text default null,
  p_avatar_url text default null,
  p_ratings jsonb default '[]'::jsonb,
  p_next_sync_seconds integer default 21600
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.chess_account_links;
  v_item jsonb;
  v_class public.time_class;
  v_rating integer;
  v_last integer;
  v_anomaly text;
  v_errors integer;
begin
  select * into v_link from public.chess_account_links where user_id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;

  if p_ok then
    -- Identity is never changed by a sync. A mismatch is surfaced for a human instead.
    if p_observed_player_id is not null and v_link.chess_player_id is not null
       and p_observed_player_id <> v_link.chess_player_id then
      v_anomaly := 'player_id_changed';
    elsif p_observed_username is not null
       and public.normalize_chess_username(p_observed_username) <> v_link.chess_username then
      v_anomaly := 'username_changed_at_chesscom';
    end if;

    if v_anomaly is null then
      if v_link.chess_player_id is null and p_observed_player_id is not null then
        update public.chess_account_links set chess_player_id = p_observed_player_id
         where id = v_link.id and not exists (
           select 1 from public.chess_account_links o where o.chess_player_id = p_observed_player_id);
      end if;

      if p_avatar_url is not null and p_avatar_url ~ '^https://' then
        update public.profiles set avatar_url = p_avatar_url where id = p_user and avatar_url is distinct from p_avatar_url;
      end if;

      for v_item in select * from jsonb_array_elements(coalesce(p_ratings, '[]'::jsonb)) loop
        v_class := (v_item ->> 'time_class')::public.time_class;
        v_rating := (v_item ->> 'rating')::integer;
        continue when v_rating is null;

        insert into public.chess_ratings as r (user_id, time_class, rating, best_rating, record_wins, record_losses, record_draws, last_game_at, fetched_at)
        values (p_user, v_class, v_rating, nullif(v_item ->> 'best_rating', '')::integer,
                coalesce((v_item ->> 'wins')::integer, 0), coalesce((v_item ->> 'losses')::integer, 0),
                coalesce((v_item ->> 'draws')::integer, 0), nullif(v_item ->> 'last_game_at', '')::timestamptz, now())
        on conflict (user_id, time_class) do update
          set rating = excluded.rating, best_rating = excluded.best_rating,
              record_wins = excluded.record_wins, record_losses = excluded.record_losses,
              record_draws = excluded.record_draws, last_game_at = excluded.last_game_at, fetched_at = now();

        select h.rating into v_last from public.chess_rating_history h
         where h.user_id = p_user and h.time_class = v_class order by h.observed_at desc, h.id desc limit 1;
        if v_last is null or v_last <> v_rating then
          insert into public.chess_rating_history (user_id, time_class, rating) values (p_user, v_class, v_rating);
        end if;
      end loop;
    end if;

    insert into public.chess_sync_state as s (user_id, profile_synced_at, stats_synced_at, last_success_at, last_error, last_error_at, error_count, next_sync_at)
    values (p_user, now(), now(), case when v_anomaly is null then now() end, v_anomaly,
            case when v_anomaly is null then null else now() end, case when v_anomaly is null then 0 else 1 end,
            now() + make_interval(secs => greatest(300, p_next_sync_seconds)))
    on conflict (user_id) do update
      set profile_synced_at = now(), stats_synced_at = now(),
          last_success_at = case when v_anomaly is null then now() else s.last_success_at end,
          last_error = v_anomaly, last_error_at = case when v_anomaly is null then null else now() end,
          error_count = case when v_anomaly is null then 0 else s.error_count + 1 end,
          next_sync_at = now() + make_interval(secs => greatest(300, p_next_sync_seconds)),
          updated_at = now();
    return jsonb_build_object('ok', v_anomaly is null, 'anomaly', v_anomaly);
  end if;

  insert into public.chess_sync_state as s (user_id, last_error, last_error_at, error_count, next_sync_at)
  values (p_user, left(coalesce(p_error, 'unknown error'), 500), now(), 1, now() + interval '10 minutes')
  on conflict (user_id) do update
    set last_error = left(coalesce(p_error, 'unknown error'), 500), last_error_at = now(),
        error_count = s.error_count + 1,
        -- exponential backoff: 10m, 20m, 40m ... capped at 6h
        next_sync_at = now() + make_interval(mins => least(360, 10 * power(2, least(s.error_count, 6))::integer)),
        updated_at = now()
  returning error_count into v_errors;
  return jsonb_build_object('ok', false, 'error_count', v_errors);
end;
$$;

-- Bulk, idempotent import. Duplicates (same URL or uuid) are ignored, which is also how
-- a game that appears in both players' archives is reconciled into a single row.
create function public.import_chess_games(p_games jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if jsonb_typeof(p_games) <> 'array' then
    raise exception 'p_games must be a JSON array' using errcode = '22023';
  end if;
  insert into public.imported_chess_games
    (game_url, game_uuid, white_username, black_username, white_rating, black_rating, white_result, black_result,
     winner, time_control, time_class, rules, rated, started_at, ended_at, archive_month)
  select g.game_url, g.game_uuid, public.normalize_chess_username(g.white_username), public.normalize_chess_username(g.black_username),
         g.white_rating, g.black_rating, g.white_result, g.black_result,
         case when g.winner in ('white', 'black', 'draw') then g.winner else 'unknown' end,
         g.time_control,
         case when g.time_class in ('bullet', 'blitz', 'rapid', 'daily') then g.time_class::public.time_class end,
         coalesce(nullif(g.rules, ''), 'chess'), g.rated, g.started_at, g.ended_at, g.archive_month
  from jsonb_to_recordset(p_games) as g(
    game_url text, game_uuid uuid, white_username text, black_username text, white_rating integer, black_rating integer,
    white_result text, black_result text, winner text, time_control text, time_class text, rules text, rated boolean,
    started_at timestamptz, ended_at timestamptz, archive_month text)
  -- Rows that could never be valid are skipped rather than failing the whole batch.
  where g.game_url ~ '^https://www\.chess\.com/'
    and g.ended_at is not null
    and public.is_valid_chess_username(public.normalize_chess_username(g.white_username))
    and public.is_valid_chess_username(public.normalize_chess_username(g.black_username))
    and public.normalize_chess_username(g.white_username) <> public.normalize_chess_username(g.black_username)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- A new verified link is due for its first sync immediately.
create function app_private.seed_sync_state() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chess_sync_state (user_id, next_sync_at) values (new.user_id, now())
  on conflict (user_id) do nothing;
  return null;
end;
$$;
create trigger chess_account_links_seed_sync after insert on public.chess_account_links
  for each row execute function app_private.seed_sync_state();
