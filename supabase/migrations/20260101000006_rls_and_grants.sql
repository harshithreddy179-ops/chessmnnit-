-- ============================================================================
-- 06 · Row Level Security and privileges
-- ============================================================================
-- Strategy: deny by default, then allow exactly what the product needs.
--   1. REVOKE every privilege on every public object from anon / authenticated.
--   2. ENABLE row level security on every table (no FORCE: SECURITY DEFINER functions,
--      which are the only trusted writers, run as the table owner).
--   3. GRANT back the minimum: SELECT through policies, column-level INSERT/UPDATE
--      where a client is allowed to write at all.
-- Clients can NOT write: ratings, imported games, statistics, verification, eligibility,
-- identity links, matches, roles, audit logs, or anything about another user.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Deny by default
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all tables in schema app_private from anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;

-- Objects created by future migrations start closed as well.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
alter default privileges in schema app_private revoke all on functions from public, anon, authenticated;

-- service_role (trusted server code) keeps full access; it also bypasses RLS.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app_private to service_role;

-- ---------------------------------------------------------------------------
-- 2. Enable RLS on every table
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.admin_roles enable row level security;
alter table public.audit_logs enable row level security;
alter table public.job_runs enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_settings enable row level security;
alter table public.student_eligibility enable row level security;
alter table public.eligibility_requests enable row level security;
alter table public.chess_link_claims enable row level security;
alter table public.chess_account_links enable row level security;
alter table public.chess_link_history enable row level security;
alter table public.account_recovery_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.supported_time_controls enable row level security;
alter table public.chess_sync_state enable row level security;
alter table public.chess_ratings enable row level security;
alter table public.chess_rating_history enable row level security;
alter table public.imported_chess_games enable row level security;
alter table public.chess_archive_state enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_events enable row level security;
alter table public.match_sync_attempts enable row level security;
alter table public.college_matches enable row level security;
alter table public.match_disputes enable row level security;
alter table public.player_stats enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers that RLS policies and invoker-rights triggers/functions need to execute.
-- They are read-only; app_private is not exposed through the Data API.
-- ---------------------------------------------------------------------------
grant execute on function
  app_private.has_any_role(public.app_role[]),
  app_private.is_admin(),
  app_private.demo_enabled(),
  app_private.setting_num(text, numeric),
  app_private.setting_bool(text, boolean),
  app_private.setting_json(text),
  app_private.is_approved(uuid),
  app_private.has_chess_link(uuid),
  app_private.challenge_edge_allowed(public.challenge_status, public.challenge_status)
to anon, authenticated;
grant execute on function public.normalize_chess_username(text), public.is_valid_chess_username(text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policies and grants, table by table
-- ---------------------------------------------------------------------------

-- Reference data ------------------------------------------------------------
create policy supported_time_controls_read on public.supported_time_controls
  for select to anon, authenticated using (true);
grant select on public.supported_time_controls to anon, authenticated;

create policy app_settings_read on public.app_settings
  for select to anon, authenticated using (is_public or (select app_private.is_admin()));
grant select on public.app_settings to anon, authenticated;

-- Profiles ------------------------------------------------------------------
-- Public: approved players only (not suspended, eligible, verified, onboarded).
-- Everyone also sees their own row; admins see all.
create policy profiles_read on public.profiles
  for select to anon, authenticated
  using (
    (is_approved and (not is_demo or (select app_private.demo_enabled())))
    or id = (select auth.uid())
    or (select app_private.is_admin())
  );
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
grant select on public.profiles to anon, authenticated;
-- Only these four columns are writable by a client. Verification, eligibility, status,
-- avatar, approval and demo flags are not.
grant update (display_name, bio, preferred_time_classes, open_to_challenges) on public.profiles to authenticated;

create policy profile_settings_own_read on public.profile_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy profile_settings_own_update on public.profile_settings
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.profile_settings to authenticated;
grant update (presence_mode) on public.profile_settings to authenticated;

-- Roles ---------------------------------------------------------------------
-- Everyone sees their own roles; only super admins can list who holds which role.
create policy admin_roles_read on public.admin_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select app_private.has_any_role(array[]::public.app_role[])));
grant select on public.admin_roles to authenticated;

-- Eligibility ---------------------------------------------------------------
create policy student_eligibility_admin_read on public.student_eligibility
  for select to authenticated
  using ((select app_private.has_any_role(array['verification_admin']::public.app_role[])));
grant select on public.student_eligibility to authenticated;

create policy eligibility_requests_read on public.eligibility_requests
  for select to authenticated
  using (user_id = (select auth.uid())
         or (select app_private.has_any_role(array['verification_admin']::public.app_role[])));
grant select on public.eligibility_requests to authenticated;

-- Chess.com ownership -------------------------------------------------------
create policy chess_link_claims_read on public.chess_link_claims
  for select to authenticated
  using (user_id = (select auth.uid())
         or (select app_private.has_any_role(array['verification_admin']::public.app_role[])));
grant select on public.chess_link_claims to authenticated;

-- No INSERT / UPDATE / DELETE policy or grant on links: ownership is immutable to clients.
create policy chess_account_links_read on public.chess_account_links
  for select to anon, authenticated
  using (
    exists (select 1 from public.profiles p where p.id = user_id and p.is_approved)
    or user_id = (select auth.uid())
    or (select app_private.is_admin())
  );
grant select on public.chess_account_links to anon, authenticated;

create policy chess_link_history_admin_read on public.chess_link_history
  for select to authenticated
  using ((select app_private.has_any_role(array['verification_admin']::public.app_role[])));
grant select on public.chess_link_history to authenticated;

create policy account_recovery_read on public.account_recovery_requests
  for select to authenticated
  using (requester_id = (select auth.uid())
         or (select app_private.has_any_role(array['verification_admin']::public.app_role[])));
grant select on public.account_recovery_requests to authenticated;

-- Imported Chess.com data (read-only for clients) ----------------------------
create policy chess_sync_state_read on public.chess_sync_state
  for select to authenticated
  using (user_id = (select auth.uid()) or (select app_private.is_admin()));
grant select on public.chess_sync_state to authenticated;

create policy chess_ratings_read on public.chess_ratings
  for select to anon, authenticated
  using (
    exists (select 1 from public.profiles p where p.id = user_id and p.is_approved)
    or user_id = (select auth.uid())
    or (select app_private.is_admin())
  );
grant select on public.chess_ratings to anon, authenticated;

create policy chess_rating_history_read on public.chess_rating_history
  for select to anon, authenticated
  using (
    exists (select 1 from public.profiles p where p.id = user_id and p.is_approved)
    or user_id = (select auth.uid())
    or (select app_private.is_admin())
  );
grant select on public.chess_rating_history to anon, authenticated;

create policy imported_chess_games_read on public.imported_chess_games
  for select to authenticated
  using (
    (select app_private.is_admin())
    or exists (
      select 1 from public.chess_account_links l
      where l.user_id = (select auth.uid()) and l.chess_username in (white_username, black_username))
  );
grant select on public.imported_chess_games to authenticated;

-- chess_archive_state: service role only (RLS enabled, no policy, no grant).

-- Challenges ----------------------------------------------------------------
create policy challenges_read on public.challenges
  for select to authenticated
  using (challenger_id = (select auth.uid()) or recipient_id = (select auth.uid()) or (select app_private.is_admin()));
-- Creating: only as yourself, and only as a fresh pending challenge. The BEFORE INSERT
-- trigger then validates eligibility, limits and duplicates and fills server fields.
create policy challenges_create on public.challenges
  for insert to authenticated
  with check (challenger_id = (select auth.uid()) and status = 'pending');
-- Updating: only participants may touch a row; the BEFORE UPDATE trigger limits them to
-- status changes along legal edges (recipient accepts/declines, challenger cancels).
create policy challenges_respond on public.challenges
  for update to authenticated
  using (challenger_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  with check (challenger_id = (select auth.uid()) or recipient_id = (select auth.uid()));
grant select on public.challenges to authenticated;
grant insert (recipient_id, time_control, message) on public.challenges to authenticated;
grant update (status) on public.challenges to authenticated;

create policy challenge_events_read on public.challenge_events
  for select to authenticated
  using (
    (select app_private.is_admin())
    or exists (select 1 from public.challenges c where c.id = challenge_id
               and (select auth.uid()) in (c.challenger_id, c.recipient_id))
  );
grant select on public.challenge_events to authenticated;

create policy match_sync_attempts_read on public.match_sync_attempts
  for select to authenticated
  using (
    (select app_private.is_admin())
    or exists (select 1 from public.challenges c where c.id = challenge_id
               and (select auth.uid()) in (c.challenger_id, c.recipient_id))
  );
grant select on public.match_sync_attempts to authenticated;

-- Matches, disputes, statistics ----------------------------------------------
create policy college_matches_read on public.college_matches
  for select to anon, authenticated
  using (
    (status = 'verified' and (not is_demo or (select app_private.demo_enabled())))
    or white_user_id = (select auth.uid())
    or black_user_id = (select auth.uid())
    or (select app_private.is_admin())
  );
grant select on public.college_matches to anon, authenticated;

create policy match_disputes_read on public.match_disputes
  for select to authenticated
  using (
    opened_by = (select auth.uid())
    or (select app_private.has_any_role(array['match_moderator']::public.app_role[]))
    or exists (select 1 from public.challenges c where c.id = challenge_id
               and (select auth.uid()) in (c.challenger_id, c.recipient_id))
  );
grant select on public.match_disputes to authenticated;

create policy player_stats_read on public.player_stats
  for select to anon, authenticated
  using (
    exists (select 1 from public.profiles p where p.id = user_id and p.is_approved)
    or user_id = (select auth.uid())
    or (select app_private.is_admin())
  );
grant select on public.player_stats to anon, authenticated;

-- Notifications -------------------------------------------------------------
create policy notifications_read on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Operations ----------------------------------------------------------------
create policy audit_logs_admin_read on public.audit_logs
  for select to authenticated using ((select app_private.is_admin()));
grant select on public.audit_logs to authenticated;

create policy job_runs_admin_read on public.job_runs
  for select to authenticated using ((select app_private.is_admin()));
grant select on public.job_runs to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Function privileges
-- ---------------------------------------------------------------------------
-- Player-facing RPCs (each checks auth.uid() internally).
grant execute on function
  public.consume_rate_limit(text, integer, integer),
  public.claim_eligibility(),
  public.request_eligibility_review(text, text),
  public.start_chess_claim(text, public.verification_method),
  public.cancel_chess_claim(),
  public.submit_claim_for_review(text),
  public.complete_onboarding(),
  public.request_account_recovery(public.recovery_kind, text, text),
  public.open_match_dispute(uuid, text, text, text)
to authenticated;

-- Public read APIs (security invoker: RLS decides what is visible).
grant execute on function
  public.get_leaderboard(text, public.time_class, integer, integer),
  public.get_player_directory(text, public.time_class, integer, integer, public.time_class, boolean, text, integer, integer),
  public.get_recent_matches(integer, integer, public.time_class, text, text),
  public.get_public_summary()
to anon, authenticated;

-- Administrator RPCs: callable by signed-in users but each one calls
-- app_private.require_role(...) first, so non-admins are rejected inside the database.
grant execute on function
  public.admin_unlink_chess_account(uuid, text),
  public.admin_resolve_recovery(uuid, boolean, text),
  public.admin_add_eligibility(text, text[], text),
  public.admin_remove_eligibility(uuid, text),
  public.admin_set_user_eligibility(uuid, public.eligibility_status, text),
  public.admin_review_eligibility_request(uuid, boolean, text),
  public.admin_review_claim(uuid, boolean, text, bigint),
  public.admin_set_account_status(uuid, boolean, text),
  public.admin_set_role(uuid, public.app_role, boolean, text),
  public.admin_resolve_challenge_with_game(uuid, text, text),
  public.admin_record_manual_result(uuid, text, text, boolean, timestamptz, text),
  public.admin_void_challenge(uuid, text),
  public.admin_correct_match(uuid, text, text),
  public.admin_retry_challenge_sync(uuid),
  public.admin_resolve_dispute(uuid, public.dispute_status, text),
  public.admin_update_setting(text, jsonb, text),
  public.admin_overview(),
  public.admin_retry_player_sync(uuid)
to authenticated;

-- Everything else stays service_role-only (granted above), notably:
--   confirm_chess_link, record_claim_check, bootstrap_super_admin, claim_players_for_sync,
--   record_player_sync, import_chess_games, expire_stale_challenges, claim_challenges_for_sync,
--   record_challenge_check, finalize_challenge_match, recompute_all_stats, run_housekeeping,
--   start_job_run, finish_job_run.
