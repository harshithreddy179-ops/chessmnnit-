-- ============================================================================
-- 01 · Foundation: schemas, enums, settings, rate limiting, audit log, admin roles
-- ============================================================================
-- Conventions used by every migration in this project
--   * Ownership keys are Supabase Auth UUIDs (auth.users.id). Emails are never keys.
--   * `public` holds API-visible objects. `app_private` holds internal helpers that
--     are NOT exposed through the Data API (only `public` is exposed by default).
--   * Every table has RLS enabled in migration 07; privileges are REVOKEd from the
--     API roles first and then granted back explicitly, column by column where needed.
--   * SECURITY DEFINER functions always pin `search_path = ''` and schema-qualify
--     every reference.
-- ============================================================================

create schema if not exists app_private;
create schema if not exists extensions;

comment on schema app_private is 'Internal helpers and tables. Not exposed through the Supabase Data API.';

grant usage on schema app_private to anon, authenticated, service_role;

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('super_admin', 'verification_admin', 'match_moderator', 'analyst');
create type public.eligibility_status as enum ('unverified', 'verified', 'revoked');
create type public.account_status as enum ('active', 'suspended');
create type public.time_class as enum ('bullet', 'blitz', 'rapid', 'daily');
create type public.presence_mode as enum ('available', 'busy', 'invisible');
create type public.verification_method as enum ('profile_code', 'oauth', 'admin_review');
create type public.link_claim_status as enum ('pending', 'needs_review', 'approved', 'rejected', 'expired', 'cancelled');
create type public.request_status as enum ('open', 'approved', 'rejected');
create type public.recovery_kind as enum ('change_username', 'transfer_username');
create type public.challenge_status as enum (
  'pending', 'accepted', 'declined', 'cancelled', 'expired',
  'waiting_for_game', 'checking_result', 'result_verified', 'needs_review', 'voided'
);
create type public.match_status as enum ('verified', 'disputed', 'voided');
create type public.match_source as enum ('automatic', 'admin');
create type public.dispute_status as enum ('open', 'resolved', 'rejected');
create type public.notification_type as enum (
  'challenge_received', 'challenge_accepted', 'challenge_declined', 'challenge_cancelled',
  'challenge_expired', 'match_verified', 'match_needs_review', 'verification_result',
  'recovery_decision', 'eligibility_result', 'dispute_update', 'account_notice'
);

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create function app_private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Chess.com usernames: 3-25 chars of letters, digits, underscore, hyphen; case-insensitive.
create function public.normalize_chess_username(p_username text) returns text
language sql immutable parallel safe as $$
  select lower(btrim(p_username))
$$;

create function public.is_valid_chess_username(p_username text) returns boolean
language sql immutable parallel safe as $$
  select p_username is not null and p_username ~ '^[a-z0-9_-]{3,25}$'
$$;

-- ---------------------------------------------------------------------------
-- Global settings (super-admin managed, documented in docs/SCORING.md)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  is_public boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value, description, is_public) values
  ('registration_open',        'true'::jsonb,  'Whether new students may complete onboarding.', true),
  ('include_demo_data',        'false'::jsonb, 'Show rows flagged is_demo in public lists. Only ever true in local development.', true),
  ('challenge_expiry_hours',   '48'::jsonb,    'Hours before an unanswered pending challenge expires.', true),
  ('challenge_max_pending_outgoing', '5'::jsonb, 'Maximum simultaneously pending challenges a player may have sent.', true),
  ('challenge_rate_per_hour',  '10'::jsonb,    'Maximum challenges a player may create per hour.', false),
  ('match_settle_minutes',     '20'::jsonb,    'After a single candidate game is found, wait this long and re-check for competing games before verifying.', true),
  ('match_max_wait_hours',     '72'::jsonb,    'Hours after acceptance before an unresolved challenge moves to manual review.', true),
  ('min_games_for_win_rate',   '5'::jsonb,     'Minimum verified college matches before a player appears on the win-rate leaderboard.', true),
  ('points_per_win',           '3'::jsonb,     'College match points awarded for a win.', true),
  ('points_per_draw',          '1'::jsonb,     'College match points awarded for a draw.', true),
  ('elo_initial_rating',       '1000'::jsonb,  'Starting college Elo.', true),
  ('elo_k_factor',             '32'::jsonb,    'K-factor used for the college Elo.', true),
  ('elo_provisional_games',    '10'::jsonb,    'Players with fewer verified matches are labelled provisional.', true);

create function app_private.setting_json(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from public.app_settings where key = p_key
$$;

create function app_private.setting_num(p_key text, p_default numeric) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select value into v from public.app_settings where key = p_key;
  if v is null or jsonb_typeof(v) <> 'number' then return p_default; end if;
  return (v #>> '{}')::numeric;
end;
$$;

create function app_private.setting_bool(p_key text, p_default boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select value into v from public.app_settings where key = p_key;
  if v is null or jsonb_typeof(v) <> 'boolean' then return p_default; end if;
  return (v #>> '{}')::boolean;
end;
$$;

create function app_private.demo_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.setting_bool('include_demo_data', false)
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window, atomic)
-- ---------------------------------------------------------------------------
create table app_private.rate_limit_buckets (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table app_private.rate_limit_buckets enable row level security;

-- Returns true while the caller is within the limit and false once it is exceeded.
create function app_private.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_max <= 0 or p_window_seconds <= 0 then
    raise exception 'invalid rate limit parameters';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into app_private.rate_limit_buckets as b (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = b.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

-- Callable by signed-in users for their own route-level limits; the key is always
-- namespaced with auth.uid() so one user can never consume another user's budget.
create function public.consume_rate_limit(p_action text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_action !~ '^[a-z0-9_.:-]{1,64}$' or p_max > 1000 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit request' using errcode = '22023';
  end if;
  return app_private.hit_rate_limit('u:' || v_uid::text || ':' || p_action, p_max, p_window_seconds);
end;
$$;

create function app_private.purge_rate_limits() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_count bigint;
begin
  delete from app_private.rate_limit_buckets where window_start < now() - interval '2 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrator roles
-- ---------------------------------------------------------------------------
-- Rows are written only by SECURITY DEFINER functions (admin_set_role) or by the
-- documented bootstrap procedure (scripts/bootstrap-admin.ts). Clients cannot write.
create table public.admin_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
create index admin_roles_role_idx on public.admin_roles (role);

-- super_admin implicitly satisfies every role requirement.
create function app_private.has_any_role(p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_roles r
    where r.user_id = (select auth.uid())
      and (r.role = 'super_admin' or r.role = any (p_roles))
  )
$$;

create function app_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_roles r where r.user_id = (select auth.uid()))
$$;

-- Raises 42501 unless the caller holds one of the roles; returns the caller's id.
create function app_private.require_role(p_roles public.app_role[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not app_private.has_any_role(p_roles) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,               -- no FK: the record must outlive the account
  actor_kind text not null default 'user' check (actor_kind in ('user', 'admin', 'system')),
  action text not null,
  target_type text not null,
  target_id text,
  reason text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_type, target_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id);
create index audit_logs_action_idx on public.audit_logs (action);

create function app_private.audit_logs_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function app_private.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function app_private.audit_logs_immutable();

create function app_private.write_audit(
  p_actor uuid,
  p_kind text,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, actor_kind, action, target_type, target_id, reason, before_data, after_data, metadata)
  values (p_actor, p_kind, p_action, p_target_type, p_target_id, p_reason, p_before, p_after, coalesce(p_metadata, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Background job bookkeeping
-- ---------------------------------------------------------------------------
create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'error')),
  stats jsonb not null default '{}'::jsonb,
  error text
);
create index job_runs_job_started_idx on public.job_runs (job, started_at desc);
