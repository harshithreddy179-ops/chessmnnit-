-- ============================================================================
-- 04 · Matchmaking: challenges, verified college matches, disputes, statistics
-- ============================================================================
-- Invariants enforced by the database (not by the UI, not by the API layer):
--   * A challenge can only be created by its challenger, between two *approved* players.
--   * Only the recipient can accept/decline; only the challenger can cancel.
--   * Clients can change nothing on a challenge except `status`, along legal edges.
--   * At most one active challenge exists between any two players.
--   * A Chess.com game belongs to at most one college match, and a challenge produces
--     at most one match.
--   * Statistics are derived from verified matches by a deterministic full recompute,
--     so processing the same result twice cannot change them.
-- ============================================================================

create function app_private.is_approved(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_approved from public.profiles where id = p_user), false)
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  -- Verified Chess.com usernames at creation time (server-populated, never client-supplied).
  challenger_username text not null,
  recipient_username text not null,
  time_control text not null references public.supported_time_controls (time_control),
  time_class public.time_class not null,
  message text check (message is null or char_length(message) <= 280),
  status public.challenge_status not null default 'pending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  responded_at timestamptz,
  closed_at timestamptz,
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid,
  -- result synchronisation
  next_check_at timestamptz,
  last_checked_at timestamptz,
  check_count integer not null default 0,
  settle_until timestamptz,
  giveup_at timestamptz,
  candidate_game_ids uuid[] not null default '{}',
  review_reason text,
  processing_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint challenges_no_self check (challenger_id <> recipient_id)
);

-- Never two active challenges between the same two players, in either direction.
create unique index challenges_one_active_per_pair on public.challenges
  (least(challenger_id, recipient_id), greatest(challenger_id, recipient_id))
  where status in ('pending', 'accepted', 'waiting_for_game', 'checking_result', 'needs_review');
create index challenges_challenger_idx on public.challenges (challenger_id, created_at desc);
create index challenges_recipient_idx on public.challenges (recipient_id, created_at desc);
create index challenges_sync_due_idx on public.challenges (next_check_at)
  where status in ('accepted', 'waiting_for_game', 'checking_result');
create index challenges_pending_expiry_idx on public.challenges (expires_at) where status = 'pending';
create index challenges_review_idx on public.challenges (status) where status = 'needs_review';

create table public.challenge_events (
  id bigint generated always as identity primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  actor_id uuid,
  from_status public.challenge_status,
  to_status public.challenge_status not null,
  detail text,
  created_at timestamptz not null default now()
);
create index challenge_events_challenge_idx on public.challenge_events (challenge_id, id);

create table public.match_sync_attempts (
  id bigint generated always as identity primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome text not null check (outcome in (
    'no_game_found', 'candidate_found', 'settling', 'verified', 'ambiguous', 'unknown_result',
    'archive_unavailable', 'rate_limited', 'error', 'gave_up')),
  candidates integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  error text
);
create index match_sync_attempts_idx on public.match_sync_attempts (challenge_id, attempted_at desc);

create table public.college_matches (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid references public.challenges (id) on delete set null,
  game_id uuid references public.imported_chess_games (id) on delete restrict,
  game_url text not null,
  white_user_id uuid references public.profiles (id) on delete set null,
  black_user_id uuid references public.profiles (id) on delete set null,
  white_username text not null,
  black_username text not null,
  result text not null check (result in ('white', 'black', 'draw')),
  time_control text,
  time_class public.time_class,
  rated boolean,
  ended_at timestamptz not null,
  source public.match_source not null,
  status public.match_status not null default 'verified',
  evidence jsonb not null default '{}'::jsonb,
  verified_at timestamptz not null default now(),
  verified_by uuid,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint college_matches_challenge_key unique (challenge_id),
  constraint college_matches_game_key unique (game_id),
  constraint college_matches_url_key unique (game_url),
  constraint college_matches_players_differ check (white_username <> black_username)
);
create index college_matches_recent_idx on public.college_matches (ended_at desc) where status = 'verified';
create index college_matches_white_idx on public.college_matches (white_user_id, ended_at desc);
create index college_matches_black_idx on public.college_matches (black_user_id, ended_at desc);

create table public.match_disputes (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  opened_by uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  proposed_game_url text check (proposed_game_url is null or proposed_game_url ~ '^https://www\.chess\.com/'),
  proposed_result text check (proposed_result is null or proposed_result in ('challenger', 'recipient', 'draw')),
  status public.dispute_status not null default 'open',
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);
create unique index match_disputes_one_open on public.match_disputes (challenge_id, opened_by) where status = 'open';
create index match_disputes_open_idx on public.match_disputes (status, created_at);

create table public.player_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  points integer not null default 0,
  win_rate numeric(6, 5),
  elo numeric(8, 1) not null,
  last_match_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger challenges_updated_at before update on public.challenges
  for each row execute function app_private.set_updated_at();
create trigger college_matches_updated_at before update on public.college_matches
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Challenge state machine
-- ---------------------------------------------------------------------------
create function app_private.challenge_edge_allowed(p_from public.challenge_status, p_to public.challenge_status)
returns boolean
language sql immutable as $$
  select (p_from, p_to) in (
    ('pending', 'accepted'), ('pending', 'declined'), ('pending', 'cancelled'), ('pending', 'expired'),
    ('accepted', 'waiting_for_game'), ('accepted', 'checking_result'), ('accepted', 'needs_review'),
    ('accepted', 'result_verified'), ('accepted', 'voided'),
    ('waiting_for_game', 'checking_result'), ('waiting_for_game', 'needs_review'),
    ('waiting_for_game', 'result_verified'), ('waiting_for_game', 'voided'),
    ('checking_result', 'waiting_for_game'), ('checking_result', 'needs_review'),
    ('checking_result', 'result_verified'), ('checking_result', 'voided'),
    ('needs_review', 'waiting_for_game'), ('needs_review', 'result_verified'), ('needs_review', 'voided'),
    -- A moderator may void an already-verified result (wrong account, proven cheating, ...).
    ('result_verified', 'voided')
  )
$$;

-- INSERT: runs as the table owner so it can read both players' private state. The caller's
-- identity still comes from the JWT (auth.uid()), and RLS WITH CHECK independently
-- requires challenger_id = auth.uid().
create function app_private.challenges_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_challenger public.profiles;
  v_recipient public.profiles;
  v_ch_user text;
  v_re_user text;
  v_tc public.supported_time_controls;
  v_pending integer;
begin
  if new.challenger_id = new.recipient_id then
    raise exception 'self_challenge: you cannot challenge yourself' using errcode = 'P0001';
  end if;

  select * into v_challenger from public.profiles where id = new.challenger_id;
  select * into v_recipient from public.profiles where id = new.recipient_id;
  if v_challenger.id is null or not v_challenger.is_approved then
    raise exception 'challenger_not_approved: finish onboarding and Chess.com verification before challenging' using errcode = 'P0001';
  end if;
  if v_recipient.id is null or not v_recipient.is_approved then
    raise exception 'recipient_unavailable: that player is not an approved member' using errcode = 'P0001';
  end if;
  if not v_recipient.open_to_challenges then
    raise exception 'recipient_closed: that player is not accepting challenges' using errcode = 'P0001';
  end if;

  select * into v_tc from public.supported_time_controls where time_control = new.time_control and active;
  if v_tc.time_control is null then
    raise exception 'unsupported_time_control' using errcode = 'P0001';
  end if;

  select chess_username into v_ch_user from public.chess_account_links where user_id = new.challenger_id;
  select chess_username into v_re_user from public.chess_account_links where user_id = new.recipient_id;

  if exists (
    select 1 from public.challenges c
    where least(c.challenger_id, c.recipient_id) = least(new.challenger_id, new.recipient_id)
      and greatest(c.challenger_id, c.recipient_id) = greatest(new.challenger_id, new.recipient_id)
      and c.status in ('pending', 'accepted', 'waiting_for_game', 'checking_result', 'needs_review')
  ) then
    raise exception 'active_challenge_exists: you already have an open challenge with this player' using errcode = 'P0001';
  end if;

  select count(*) into v_pending from public.challenges
   where challenger_id = new.challenger_id and status = 'pending' and expires_at > now();
  if v_pending >= app_private.setting_num('challenge_max_pending_outgoing', 5) then
    raise exception 'too_many_pending: wait for responses before sending more challenges' using errcode = 'P0001';
  end if;
  if not app_private.hit_rate_limit('challenge_create:' || new.challenger_id::text,
        app_private.setting_num('challenge_rate_per_hour', 10)::integer, 3600) then
    raise exception 'rate_limited: too many challenges sent recently' using errcode = '53400';
  end if;

  new.challenger_username := v_ch_user;
  new.recipient_username := v_re_user;
  new.time_class := v_tc.time_class;
  new.message := nullif(btrim(new.message), '');
  new.status := 'pending';
  new.expires_at := now() + make_interval(hours => app_private.setting_num('challenge_expiry_hours', 48)::integer);
  new.accepted_at := null;
  new.responded_at := null;
  new.closed_at := null;
  new.status_changed_at := now();
  new.status_changed_by := new.challenger_id;
  new.next_check_at := null;
  new.check_count := 0;
  new.candidate_game_ids := '{}';
  new.review_reason := null;
  new.processing_until := null;
  return new;
end;
$$;
create trigger challenges_before_insert before insert on public.challenges
  for each row execute function app_private.challenges_before_insert();

-- UPDATE: deliberately SECURITY INVOKER so `current_user` reveals whether a client
-- (PostgREST as authenticated/anon) or trusted code (service_role, or a SECURITY DEFINER
-- function owned by postgres) is making the change.
create function app_private.challenges_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_client boolean := current_user in ('anon', 'authenticated');
  v_actor uuid := auth.uid();
begin
  if new.id is distinct from old.id
     or new.challenger_id is distinct from old.challenger_id
     or new.recipient_id is distinct from old.recipient_id
     or new.challenger_username is distinct from old.challenger_username
     or new.recipient_username is distinct from old.recipient_username
     or new.time_control is distinct from old.time_control
     or new.time_class is distinct from old.time_class
     or new.message is distinct from old.message
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'challenge terms and participants are immutable' using errcode = '42501';
  end if;

  if v_client then
    if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'only the challenge status can be changed' using errcode = '42501';
    end if;
    if new.status is not distinct from old.status then
      return new;
    end if;
    if v_actor is null or not (
         (old.status = 'pending' and new.status in ('accepted', 'declined') and v_actor = old.recipient_id)
      or (old.status = 'pending' and new.status = 'cancelled' and v_actor = old.challenger_id)
    ) then
      raise exception 'invalid_transition: % -> % is not permitted for this user', old.status, new.status using errcode = '42501';
    end if;
    if new.status = 'accepted' then
      if old.expires_at <= now() then
        raise exception 'challenge_expired' using errcode = 'P0001';
      end if;
      if not (app_private.is_approved(old.challenger_id) and app_private.is_approved(old.recipient_id)) then
        raise exception 'participant_unavailable: a participant is no longer eligible to play' using errcode = 'P0001';
      end if;
    end if;
  elsif new.status is distinct from old.status
        and not app_private.challenge_edge_allowed(old.status, new.status) then
    raise exception 'invalid_transition: % -> %', old.status, new.status using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := v_actor;
    if new.status = 'accepted' then
      new.accepted_at := now();
      new.responded_at := now();
      new.next_check_at := now() + interval '5 minutes';
      new.giveup_at := now() + make_interval(hours => app_private.setting_num('match_max_wait_hours', 72)::integer);
    elsif new.status = 'declined' then
      new.responded_at := now();
      new.closed_at := now();
    elsif new.status in ('cancelled', 'expired', 'voided', 'result_verified') then
      new.closed_at := now();
      new.next_check_at := null;
      new.processing_until := null;
    elsif new.status = 'needs_review' then
      new.next_check_at := null;
      new.processing_until := null;
    end if;
  end if;
  return new;
end;
$$;
create trigger challenges_before_update before update on public.challenges
  for each row execute function app_private.challenges_before_update();

-- Audit trail + notifications for every challenge change, whoever made it.
create function app_private.challenges_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ch_name text;
  v_re_name text;
  v_label text;
  v_actor uuid;
  v_data jsonb;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  v_actor := case when tg_op = 'INSERT' then new.challenger_id else new.status_changed_by end;
  insert into public.challenge_events (challenge_id, actor_id, from_status, to_status, detail)
  values (new.id, v_actor, case when tg_op = 'UPDATE' then old.status end, new.status, new.review_reason);

  select display_name into v_ch_name from public.profiles where id = new.challenger_id;
  select display_name into v_re_name from public.profiles where id = new.recipient_id;
  select label into v_label from public.supported_time_controls where time_control = new.time_control;
  v_data := jsonb_build_object('challenge_id', new.id, 'status', new.status);

  case new.status
    when 'pending' then
      perform app_private.notify(new.recipient_id, 'challenge_received', coalesce(v_ch_name, 'A player') || ' challenged you',
        coalesce(v_label, new.time_control) || coalesce(' · "' || new.message || '"', ''), v_data);
    when 'accepted' then
      perform app_private.notify(new.challenger_id, 'challenge_accepted', coalesce(v_re_name, 'Your opponent') || ' accepted your challenge',
        'Play on Chess.com (' || coalesce(v_label, new.time_control) || '). The result is detected automatically.', v_data);
    when 'declined' then
      perform app_private.notify(new.challenger_id, 'challenge_declined', coalesce(v_re_name, 'Your opponent') || ' declined your challenge', '', v_data);
    when 'cancelled' then
      if v_actor = new.challenger_id then
        perform app_private.notify(new.recipient_id, 'challenge_cancelled', coalesce(v_ch_name, 'A player') || ' cancelled their challenge', '', v_data);
      else
        perform app_private.notify(new.challenger_id, 'challenge_cancelled', 'Challenge cancelled', coalesce(new.review_reason, 'It could not continue.'), v_data);
        perform app_private.notify(new.recipient_id, 'challenge_cancelled', 'Challenge cancelled', coalesce(new.review_reason, 'It could not continue.'), v_data);
      end if;
    when 'expired' then
      perform app_private.notify(new.challenger_id, 'challenge_expired', 'Your challenge expired', 'It was not answered in time.', v_data);
      perform app_private.notify(new.recipient_id, 'challenge_expired', 'A challenge expired', 'You did not respond in time.', v_data);
    when 'result_verified' then
      perform app_private.notify(new.challenger_id, 'match_verified', 'Match result verified', 'Your game against ' || new.recipient_username || ' was recorded.', v_data);
      perform app_private.notify(new.recipient_id, 'match_verified', 'Match result verified', 'Your game against ' || new.challenger_username || ' was recorded.', v_data);
    when 'needs_review' then
      perform app_private.notify(new.challenger_id, 'match_needs_review', 'Match needs review',
        'A moderator will check this game. ' || coalesce(new.review_reason, ''), v_data);
      perform app_private.notify(new.recipient_id, 'match_needs_review', 'Match needs review',
        'A moderator will check this game. ' || coalesce(new.review_reason, ''), v_data);
    when 'voided' then
      perform app_private.notify(new.challenger_id, 'dispute_update', 'Challenge closed without a result', coalesce(new.review_reason, ''), v_data);
      perform app_private.notify(new.recipient_id, 'dispute_update', 'Challenge closed without a result', coalesce(new.review_reason, ''), v_data);
    else
      null;
  end case;
  return null;
end;
$$;
create trigger challenges_after_write after insert or update on public.challenges
  for each row execute function app_private.challenges_after_write();

-- Called when a participant stops being eligible (unlinked, suspended, de-listed).
create function app_private.detach_player_from_challenges(p_user uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.challenges
     set status = case when status = 'pending' then 'cancelled'::public.challenge_status
                       else 'needs_review'::public.challenge_status end,
         review_reason = p_reason
   where (challenger_id = p_user or recipient_id = p_user)
     and status in ('pending', 'accepted', 'waiting_for_game', 'checking_result');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Scheduled: expire unanswered challenges.
create function public.expire_stale_challenges() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.challenges set status = 'expired' where status = 'pending' and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Result-synchronisation worker interface (service_role only)
-- ---------------------------------------------------------------------------
create function public.claim_challenges_for_sync(p_limit integer default 10, p_lease_seconds integer default 300)
returns table (
  id uuid, status public.challenge_status, challenger_id uuid, recipient_id uuid,
  challenger_username text, recipient_username text, time_control text, time_class public.time_class,
  accepted_at timestamptz, giveup_at timestamptz, settle_until timestamptz, check_count integer,
  candidate_game_ids uuid[]
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select c.id from public.challenges c
    where c.status in ('accepted', 'waiting_for_game', 'checking_result')
      and c.next_check_at <= now()
      and (c.processing_until is null or c.processing_until < now())
    order by c.next_check_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  ), leased as (
    update public.challenges c
       set processing_until = now() + make_interval(secs => p_lease_seconds)
      from due where c.id = due.id
    returning c.*
  )
  select l.id, l.status, l.challenger_id, l.recipient_id, l.challenger_username, l.recipient_username,
         l.time_control, l.time_class, l.accepted_at, l.giveup_at, l.settle_until, l.check_count, l.candidate_game_ids
  from leased l;
end;
$$;

-- Records one synchronisation attempt and moves the challenge along. It can never mark a
-- result verified; that requires finalize_challenge_match with an actual game.
create function public.record_challenge_check(
  p_challenge_id uuid,
  p_outcome text,
  p_new_status public.challenge_status,
  p_next_check_at timestamptz default null,
  p_settle_until timestamptz default null,
  p_candidates uuid[] default '{}',
  p_detail jsonb default '{}'::jsonb,
  p_error text default null,
  p_review_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_ch public.challenges;
begin
  if p_new_status in ('result_verified', 'accepted', 'pending', 'declined', 'cancelled', 'expired') then
    raise exception 'record_challenge_check cannot set status %', p_new_status using errcode = '42501';
  end if;
  select * into v_ch from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'challenge not found' using errcode = 'P0002'; end if;
  if v_ch.status not in ('accepted', 'waiting_for_game', 'checking_result') then
    -- Resolved or reviewed by someone else while we were working: record nothing.
    update public.challenges set processing_until = null where id = p_challenge_id;
    return;
  end if;

  insert into public.match_sync_attempts (challenge_id, outcome, candidates, detail, error)
  values (p_challenge_id, p_outcome, coalesce(array_length(p_candidates, 1), 0), coalesce(p_detail, '{}'::jsonb), left(p_error, 500));

  update public.challenges
     set status = p_new_status,
         check_count = check_count + 1,
         last_checked_at = now(),
         next_check_at = case when p_new_status = 'needs_review' then null else p_next_check_at end,
         settle_until = p_settle_until,
         candidate_game_ids = coalesce(p_candidates, '{}'),
         review_reason = coalesce(p_review_reason, review_reason),
         processing_until = null
   where id = p_challenge_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Match creation
-- ---------------------------------------------------------------------------
create function app_private.finalize_match(
  p_challenge_id uuid,
  p_game_id uuid,
  p_source public.match_source,
  p_actor uuid,
  p_evidence jsonb,
  p_relax_timing boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ch public.challenges;
  v_g public.imported_chess_games;
  v_white uuid;
  v_black uuid;
  v_match uuid;
begin
  select * into v_ch from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'challenge_not_found' using errcode = 'P0002'; end if;
  if v_ch.status not in ('accepted', 'waiting_for_game', 'checking_result', 'needs_review') then
    raise exception 'challenge_not_open: status is %', v_ch.status using errcode = 'P0001';
  end if;

  select * into v_g from public.imported_chess_games where id = p_game_id for update;
  if not found then raise exception 'game_not_found' using errcode = 'P0002'; end if;

  if not ((v_g.white_username = v_ch.challenger_username and v_g.black_username = v_ch.recipient_username)
       or (v_g.white_username = v_ch.recipient_username and v_g.black_username = v_ch.challenger_username)) then
    raise exception 'game_players_mismatch: the game was not played between the two challenge participants' using errcode = 'P0001';
  end if;
  if v_g.winner = 'unknown' then
    raise exception 'result_unknown: Chess.com did not report a decisive or drawn result' using errcode = 'P0001';
  end if;
  if v_g.rules <> 'chess' then
    raise exception 'unsupported_variant: only standard chess counts' using errcode = 'P0001';
  end if;
  if not p_relax_timing then
    if v_g.ended_at < v_ch.accepted_at then
      raise exception 'game_before_acceptance: the game ended before the challenge was accepted' using errcode = 'P0001';
    end if;
    if v_g.started_at is not null and v_g.started_at < v_ch.accepted_at - interval '2 minutes' then
      raise exception 'game_before_acceptance: the game started before the challenge was accepted' using errcode = 'P0001';
    end if;
    if v_g.time_control is not null and v_g.time_control <> v_ch.time_control then
      raise exception 'time_control_mismatch' using errcode = 'P0001';
    end if;
  end if;
  if exists (select 1 from public.college_matches where game_id = p_game_id or game_url = v_g.game_url) then
    raise exception 'game_already_counted: this game is already attached to a match' using errcode = '23505';
  end if;

  v_white := case when v_g.white_username = v_ch.challenger_username then v_ch.challenger_id else v_ch.recipient_id end;
  v_black := case when v_white = v_ch.challenger_id then v_ch.recipient_id else v_ch.challenger_id end;

  insert into public.college_matches
    (challenge_id, game_id, game_url, white_user_id, black_user_id, white_username, black_username, result,
     time_control, time_class, rated, ended_at, source, evidence, verified_by)
  values (p_challenge_id, p_game_id, v_g.game_url, v_white, v_black, v_g.white_username, v_g.black_username, v_g.winner,
          v_g.time_control, v_g.time_class, v_g.rated, v_g.ended_at, p_source, coalesce(p_evidence, '{}'::jsonb), p_actor)
  returning id into v_match;

  update public.challenges
     set status = 'result_verified', candidate_game_ids = array[p_game_id], review_reason = null,
         settle_until = null, processing_until = null
   where id = p_challenge_id;

  if p_actor is not null then
    perform app_private.write_audit(p_actor, 'admin', 'match.resolved_with_game', 'challenge', p_challenge_id::text,
      p_evidence ->> 'reason', null, jsonb_build_object('match_id', v_match, 'game_url', v_g.game_url, 'result', v_g.winner));
  end if;
  return v_match;
end;
$$;

-- Automatic path: called by the worker only after it has weighed the evidence.
create function public.finalize_challenge_match(p_challenge_id uuid, p_game_id uuid, p_evidence jsonb default '{}'::jsonb)
returns uuid
language sql security definer set search_path = '' as $$
  select app_private.finalize_match(p_challenge_id, p_game_id, 'automatic', null, p_evidence, false)
$$;

-- Moderator path: pick the correct imported game for an ambiguous / stuck challenge.
create function public.admin_resolve_challenge_with_game(p_challenge_id uuid, p_game_url text, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_game uuid;
begin
  v_actor := app_private.require_role(array['match_moderator']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select id into v_game from public.imported_chess_games where game_url = btrim(p_game_url);
  if v_game is null then
    raise exception 'game_not_imported: the game was not found in the players'' Chess.com archives' using errcode = 'P0002';
  end if;
  return app_private.finalize_match(p_challenge_id, v_game, 'admin', v_actor,
    jsonb_build_object('reason', btrim(p_reason), 'resolved_by_moderator', true), true);
end;
$$;

-- Last resort when Chess.com data cannot confirm the game: a moderator records the result
-- by hand. The match is flagged as admin-sourced and never presented as API-verified.
create function public.admin_record_manual_result(
  p_challenge_id uuid, p_game_url text, p_winner text, p_white_is_challenger boolean, p_ended_at timestamptz, p_reason text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_ch public.challenges;
  v_white uuid;
  v_black uuid;
  v_wu text;
  v_bu text;
  v_result text;
  v_match uuid;
begin
  v_actor := app_private.require_role(array['match_moderator']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'explain the evidence for this result (10+ characters)' using errcode = '22023'; end if;
  if p_game_url is null or p_game_url !~ '^https://www\.chess\.com/(game|analysis)/' then
    raise exception 'a chess.com game URL is required' using errcode = '22023';
  end if;
  if p_winner not in ('challenger', 'recipient', 'draw') then raise exception 'invalid winner' using errcode = '22023'; end if;

  select * into v_ch from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'challenge_not_found' using errcode = 'P0002'; end if;
  if v_ch.status not in ('accepted', 'waiting_for_game', 'checking_result', 'needs_review') then
    raise exception 'challenge_not_open: status is %', v_ch.status using errcode = 'P0001';
  end if;

  v_white := case when p_white_is_challenger then v_ch.challenger_id else v_ch.recipient_id end;
  v_black := case when p_white_is_challenger then v_ch.recipient_id else v_ch.challenger_id end;
  v_wu := case when p_white_is_challenger then v_ch.challenger_username else v_ch.recipient_username end;
  v_bu := case when p_white_is_challenger then v_ch.recipient_username else v_ch.challenger_username end;
  v_result := case
    when p_winner = 'draw' then 'draw'
    when (p_winner = 'challenger') = p_white_is_challenger then 'white'
    else 'black' end;

  insert into public.college_matches
    (challenge_id, game_id, game_url, white_user_id, black_user_id, white_username, black_username, result,
     time_control, time_class, ended_at, source, evidence, verified_by)
  values (p_challenge_id, null, btrim(p_game_url), v_white, v_black, v_wu, v_bu, v_result,
          v_ch.time_control, v_ch.time_class, coalesce(p_ended_at, now()), 'admin',
          jsonb_build_object('reason', btrim(p_reason), 'manual_entry', true, 'api_verified', false), v_actor)
  returning id into v_match;

  update public.challenges
     set status = 'result_verified', review_reason = null, settle_until = null, processing_until = null
   where id = p_challenge_id;
  perform app_private.write_audit(v_actor, 'admin', 'match.manual_result', 'challenge', p_challenge_id::text, btrim(p_reason), null,
    jsonb_build_object('match_id', v_match, 'game_url', btrim(p_game_url), 'result', v_result));
  return v_match;
end;
$$;

create function public.admin_void_challenge(p_challenge_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_ch public.challenges;
begin
  v_actor := app_private.require_role(array['match_moderator']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into v_ch from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'challenge_not_found' using errcode = 'P0002'; end if;
  update public.college_matches set status = 'voided', verified_by = v_actor where challenge_id = p_challenge_id;
  update public.challenges set status = 'voided', review_reason = btrim(p_reason) where id = p_challenge_id;
  update public.match_disputes set status = 'resolved', resolved_by = v_actor, resolved_at = now(), resolution_note = btrim(p_reason)
   where challenge_id = p_challenge_id and status = 'open';
  perform app_private.write_audit(v_actor, 'admin', 'challenge.voided', 'challenge', p_challenge_id::text, btrim(p_reason),
    jsonb_build_object('status', v_ch.status), jsonb_build_object('status', 'voided'));
end;
$$;

create function public.admin_correct_match(p_match_id uuid, p_result text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_m public.college_matches;
begin
  v_actor := app_private.require_role(array['match_moderator']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_result not in ('white', 'black', 'draw') then raise exception 'invalid result' using errcode = '22023'; end if;
  select * into v_m from public.college_matches where id = p_match_id for update;
  if not found then raise exception 'match not found' using errcode = 'P0002'; end if;
  update public.college_matches
     set result = p_result, status = 'verified', verified_by = v_actor, source = 'admin',
         evidence = evidence || jsonb_build_object('corrected', jsonb_build_object('from', v_m.result, 'to', p_result, 'reason', btrim(p_reason), 'by', v_actor))
   where id = p_match_id;
  update public.match_disputes set status = 'resolved', resolved_by = v_actor, resolved_at = now(), resolution_note = btrim(p_reason)
   where challenge_id = v_m.challenge_id and status = 'open';
  perform app_private.write_audit(v_actor, 'admin', 'match.corrected', 'college_match', p_match_id::text, btrim(p_reason),
    jsonb_build_object('result', v_m.result, 'status', v_m.status), jsonb_build_object('result', p_result, 'status', 'verified'));
  perform app_private.notify(v_m.white_user_id, 'dispute_update', 'Match result corrected', btrim(p_reason), jsonb_build_object('match_id', p_match_id));
  perform app_private.notify(v_m.black_user_id, 'dispute_update', 'Match result corrected', btrim(p_reason), jsonb_build_object('match_id', p_match_id));
end;
$$;

create function public.admin_retry_challenge_sync(p_challenge_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := app_private.require_role(array['match_moderator']::public.app_role[]);
  update public.challenges
     set status = 'waiting_for_game', next_check_at = now(), check_count = 0, review_reason = null,
         giveup_at = now() + make_interval(hours => app_private.setting_num('match_max_wait_hours', 72)::integer),
         candidate_game_ids = '{}', settle_until = null
   where id = p_challenge_id and status = 'needs_review';
  if not found then raise exception 'only challenges awaiting review can be retried' using errcode = 'P0001'; end if;
  perform app_private.write_audit(v_actor, 'admin', 'challenge.sync_retried', 'challenge', p_challenge_id::text, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------
create function public.open_match_dispute(
  p_challenge_id uuid, p_reason text, p_game_url text default null, p_result text default null
) returns public.match_disputes
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ch public.challenges;
  v_row public.match_disputes;
  v_other uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_ch from public.challenges where id = p_challenge_id for update;
  if not found or v_uid not in (v_ch.challenger_id, v_ch.recipient_id) then
    raise exception 'challenge not found' using errcode = 'P0002';
  end if;
  if v_ch.status not in ('waiting_for_game', 'checking_result', 'needs_review', 'result_verified') then
    raise exception 'this challenge cannot be disputed in its current state' using errcode = 'P0001';
  end if;
  if not app_private.hit_rate_limit('dispute:' || v_uid::text, 5, 86400) then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  insert into public.match_disputes (challenge_id, opened_by, reason, proposed_game_url, proposed_result)
  values (p_challenge_id, v_uid, btrim(p_reason), nullif(btrim(p_game_url), ''), nullif(p_result, ''))
  returning * into v_row;

  if v_ch.status = 'result_verified' then
    -- A disputed result stops counting until a moderator rules on it.
    update public.college_matches set status = 'disputed' where challenge_id = p_challenge_id and status = 'verified';
  elsif v_ch.status in ('waiting_for_game', 'checking_result') then
    update public.challenges set status = 'needs_review', review_reason = 'dispute opened by a participant' where id = p_challenge_id;
  end if;

  v_other := case when v_uid = v_ch.challenger_id then v_ch.recipient_id else v_ch.challenger_id end;
  perform app_private.notify(v_other, 'dispute_update', 'A result was disputed', 'A moderator will review this match.', jsonb_build_object('challenge_id', p_challenge_id));
  perform app_private.write_audit(v_uid, 'user', 'dispute.opened', 'challenge', p_challenge_id::text, btrim(p_reason));
  return v_row;
exception when unique_violation then
  raise exception 'you already have an open dispute for this challenge' using errcode = 'P0001';
end;
$$;

create function public.admin_resolve_dispute(p_dispute_id uuid, p_status public.dispute_status, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_d public.match_disputes;
begin
  v_actor := app_private.require_role(array['match_moderator']::public.app_role[]);
  if p_status = 'open' then raise exception 'invalid status' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'a note is required' using errcode = '22023'; end if;
  select * into v_d from public.match_disputes where id = p_dispute_id for update;
  if not found then raise exception 'dispute not found' using errcode = 'P0002'; end if;
  if v_d.status <> 'open' then raise exception 'dispute already closed' using errcode = 'P0001'; end if;
  update public.match_disputes
     set status = p_status, resolved_by = v_actor, resolved_at = now(), resolution_note = btrim(p_note)
   where id = p_dispute_id;
  -- If the match is still on hold, the ruling releases it again (corrections and voids
  -- were already applied by their own audited functions).
  update public.college_matches set status = 'verified'
   where challenge_id = v_d.challenge_id and status = 'disputed';
  perform app_private.write_audit(v_actor, 'admin', 'dispute.' || p_status::text, 'match_dispute', p_dispute_id::text, btrim(p_note));
  perform app_private.notify(v_d.opened_by, 'dispute_update', 'Your dispute was ' || p_status::text, btrim(p_note),
    jsonb_build_object('challenge_id', v_d.challenge_id));
end;
$$;

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
