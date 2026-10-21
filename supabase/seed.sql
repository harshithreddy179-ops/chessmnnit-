-- ============================================================================
-- DEMO DATA — LOCAL DEVELOPMENT ONLY.  NEVER RUN THIS AGAINST PRODUCTION.
--
-- Creates a handful of clearly fictional players (usernames demo_*, emails
-- @demo.invalid, display names ending "(demo)"), some ratings and a few college
-- matches, so the directory, profiles, leaderboards and match history have
-- something to show on a developer's machine. Every row is flagged is_demo and is
-- invisible in public lists unless the include_demo_data setting is on, which this
-- script turns on for the local database it runs against.
--
-- Nothing here is real, and none of it is ever shown on a site whose database has
-- include_demo_data = false (the default). The script refuses to run if the database
-- already contains real (non-demo) members.
--
-- It goes through the same functions the application uses (eligibility, claims,
-- link confirmation, onboarding), so every invariant is exercised, not bypassed.
-- Run with:  npm run db:local -- --seed      (or: psql "$LOCAL_DATABASE_URL" -f supabase/seed.sql)
-- ============================================================================

do $seed$
declare
  r record;
  v_uid uuid;
  v_claim uuid;
  v_w uuid;
  v_b uuid;
  v_n integer := 0;
begin
  if exists (select 1 from public.profiles where not is_demo) then
    raise exception 'seed refused: this database already has real (non-demo) members. The demo seed is for empty local databases only.';
  end if;

  -- Players: username, Chess.com player id, display name, rapid, blitz.
  for r in
    select * from (values
      ('demo_aditi',   900001, 'Aditi Rao (demo)',     1820, 1710),
      ('demo_bharat',  900002, 'Bharat Menon (demo)',  1695, 1640),
      ('demo_chitra',  900003, 'Chitra Nair (demo)',   1560, 1590),
      ('demo_dev',     900004, 'Dev Malhotra (demo)',  1480, 1405),
      ('demo_esha',    900005, 'Esha Kulkarni (demo)', 1330, 1275),
      ('demo_farhan',  900006, 'Farhan Qureshi (demo)',1215, 1180)
    ) as t(username, player_id, display_name, rapid, blitz)
  loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    values (v_uid, r.username || '@demo.invalid', now(), jsonb_build_object('full_name', r.display_name));
    insert into public.student_eligibility (kind, value, note)
    values ('email', r.username || '@demo.invalid', 'DEMO seed') on conflict do nothing;

    -- Act as the member for the member-level steps, exactly as the app would.
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.claim_eligibility();
    select id into v_claim from public.start_chess_claim(r.username);
    reset role;

    -- Link confirmation is a trusted (service) step. The method is honest: nobody here owns
    -- these fictional accounts, so this is recorded as an administrator confirmation.
    perform public.confirm_chess_link(v_claim, r.username, r.player_id, 'admin_review');

    set local role authenticated;
    update public.profiles set display_name = r.display_name, bio = 'Fictional demo player. Not a real person.' where id = v_uid;
    perform public.complete_onboarding();
    reset role;

    perform public.record_player_sync(v_uid, true, null, r.player_id, r.username, null,
      jsonb_build_array(
        jsonb_build_object('time_class', 'rapid', 'rating', r.rapid, 'best_rating', r.rapid + 60, 'wins', 40, 'losses', 28, 'draws', 6),
        jsonb_build_object('time_class', 'blitz', 'rating', r.blitz, 'best_rating', r.blitz + 45, 'wins', 55, 'losses', 49, 'draws', 4)),
      21600);
    v_n := v_n + 1;
  end loop;

  update public.profiles set is_demo = true where id in (select user_id from public.chess_account_links where chess_username like 'demo\_%');

  -- A few verified college matches (game links are placeholders and deliberately not real games).
  for r in
    select * from (values
      ('demo_aditi',  'demo_bharat', 'white', 'rapid', 200),
      ('demo_bharat', 'demo_chitra', 'draw',  'rapid', 150),
      ('demo_chitra', 'demo_aditi',  'black', 'rapid', 100),
      ('demo_dev',    'demo_esha',   'white', 'blitz',  60),
      ('demo_esha',   'demo_farhan', 'white', 'blitz',  40),
      ('demo_aditi',  'demo_dev',    'white', 'blitz',  20)
    ) as t(white, black, result, time_class, hours_ago)
  loop
    select user_id into v_w from public.chess_account_links where chess_username = r.white;
    select user_id into v_b from public.chess_account_links where chess_username = r.black;
    insert into public.college_matches
      (game_url, white_user_id, black_user_id, white_username, black_username, result, time_control, time_class, rated, ended_at, source, evidence)
    values
      ('https://www.chess.com/game/live/demo-' || r.white || '-' || r.black, v_w, v_b, r.white, r.black, r.result,
       case r.time_class when 'rapid' then '600' else '180' end, r.time_class::public.time_class, true,
       now() - (r.hours_ago || ' hours')::interval, 'admin', jsonb_build_object('demo', true, 'note', 'fictional demo match'));
  end loop;

  -- Show demo rows on this (local) database only.
  update public.app_settings set value = 'true'::jsonb where key = 'include_demo_data';

  raise notice 'Seeded % DEMO players and 6 DEMO matches. include_demo_data is now ON for this database.', v_n;
end
$seed$;
