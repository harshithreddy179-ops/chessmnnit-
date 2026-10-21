-- ============================================================================
-- 02 · Identity: profiles, student eligibility, Chess.com account ownership
-- ============================================================================
-- Four independent facts are tracked for every player and never conflated:
--   1. Google account authenticated      -> an auth.users row exists
--   2. College eligibility verified      -> profiles.eligibility_status = 'verified'
--   3. Chess.com ownership verified      -> a row in chess_account_links
--   4. Profile complete                  -> profiles.onboarding_completed_at is set
-- A player is "approved" (publicly listed, may play) only when all four hold and the
-- account is not suspended. `profiles.is_approved` is maintained by a trigger.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Profiles (public identity) and private settings
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(btrim(display_name)) between 2 and 40 and display_name !~ '[[:cntrl:]]'),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  bio text check (bio is null or char_length(bio) <= 280),
  preferred_time_classes public.time_class[] not null default '{}',
  open_to_challenges boolean not null default true,
  eligibility_status public.eligibility_status not null default 'unverified',
  eligibility_source text,
  eligibility_verified_at timestamptz,
  account_status public.account_status not null default 'active',
  onboarding_completed_at timestamptz,
  is_approved boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_approved_idx on public.profiles (is_approved) where is_approved;
create index profiles_display_name_trgm_idx on public.profiles using gin (display_name extensions.gin_trgm_ops);

-- Presence preference is private: revealing "invisible" would defeat the setting.
create table public.profile_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  presence_mode public.presence_mode not null default 'available',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Student eligibility (admin-managed allowlist) and review requests
-- ---------------------------------------------------------------------------
create table public.student_eligibility (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('email', 'domain')),
  value text not null check (value = lower(btrim(value)) and char_length(value) between 3 and 254),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  constraint student_eligibility_unique unique (kind, value),
  constraint student_eligibility_shape check (
    (kind = 'email' and value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') or
    (kind = 'domain' and value ~ '^[a-z0-9.-]+\.[a-z]{2,}$')
  )
);

create table public.eligibility_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  claimed_identifier text not null check (char_length(btrim(claimed_identifier)) between 3 and 120),
  note text check (note is null or char_length(note) <= 500),
  status public.request_status not null default 'open',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now()
);
create unique index eligibility_requests_one_open on public.eligibility_requests (user_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- Chess.com ownership
-- ---------------------------------------------------------------------------
-- A *claim* is an attempt to prove ownership. Many users may hold claims on the same
-- username at once (so nobody can squat someone else's username); a claim confers
-- nothing. Only a *link* is ownership, and links are strictly one-to-one.
create table public.chess_link_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  chess_username text not null check (public.is_valid_chess_username(chess_username)),
  chess_player_id bigint,
  method public.verification_method not null default 'profile_code',
  status public.link_claim_status not null default 'pending',
  verification_code text,
  code_expires_at timestamptz,
  attempts integer not null default 0,
  last_checked_at timestamptz,
  last_check_result text,
  evidence jsonb not null default '{}'::jsonb,
  review_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index chess_link_claims_one_open_per_user
  on public.chess_link_claims (user_id) where status in ('pending', 'needs_review');
create index chess_link_claims_review_idx on public.chess_link_claims (status, created_at);
create index chess_link_claims_username_idx on public.chess_link_claims (chess_username);

create table public.chess_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  chess_username text not null,
  chess_player_id bigint,
  verification_method public.verification_method not null,
  claim_id uuid references public.chess_link_claims (id) on delete set null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- ONE Supabase user  <->  ONE Chess.com account. Enforced by the database itself.
  constraint chess_account_links_user_id_key unique (user_id),
  constraint chess_account_links_chess_username_key unique (chess_username),
  constraint chess_account_links_chess_player_id_key unique (chess_player_id),
  constraint chess_account_links_username_valid check (public.is_valid_chess_username(chess_username)),
  constraint chess_account_links_user_fk foreign key (user_id) references public.profiles (id) on delete cascade
);

-- Identity is immutable: a verified link can only be removed (admin function) and
-- re-created through verification, never edited in place.
create function app_private.chess_account_links_immutable() returns trigger
language plpgsql as $$
begin
  -- The player id may be filled in once (null -> value) when the first sync learns it,
  -- but an established identity can never change.
  if new.user_id is distinct from old.user_id
     or new.chess_username is distinct from old.chess_username
     or (old.chess_player_id is not null and new.chess_player_id is distinct from old.chess_player_id) then
    raise exception 'a verified Chess.com link is immutable; unlink and re-verify instead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger chess_account_links_immutable before update on public.chess_account_links
  for each row execute function app_private.chess_account_links_immutable();

-- Past links, kept for audit and dispute resolution.
create table public.chess_link_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                -- intentionally no FK: survives account deletion
  chess_username text not null,
  chess_player_id bigint,
  verification_method public.verification_method,
  verified_at timestamptz,
  unlinked_at timestamptz not null default now(),
  unlinked_by uuid,
  reason text
);
create index chess_link_history_username_idx on public.chess_link_history (chess_username);

create table public.account_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  kind public.recovery_kind not null,
  requested_username text not null check (public.is_valid_chess_username(requested_username)),
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  status public.request_status not null default 'open',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now()
);
create unique index account_recovery_one_open on public.account_recovery_requests (requester_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- Triggers: new-user bootstrap, approval maintenance, profile guard
-- ---------------------------------------------------------------------------
create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  -- Never derive the default display name from the email address (it would leak the
  -- student's roll number); fall back to a neutral label the user replaces at onboarding.
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
  );
  v_name := left(btrim(regexp_replace(coalesce(v_name, ''), '[[:cntrl:]]', '', 'g')), 40);
  if char_length(v_name) < 2 then
    v_name := 'New player';
  end if;

  insert into public.profiles (id, display_name) values (new.id, v_name) on conflict (id) do nothing;
  insert into public.profile_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- RLS-independent existence check, so approval is computed from ground truth even when
-- the trigger runs with a client role's privileges.
create function app_private.has_chess_link(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chess_account_links l where l.user_id = p_user)
$$;

create function app_private.profiles_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_user in ('anon', 'authenticated') then
    -- Column privileges already prevent this; the trigger is defence in depth.
    if new.id is distinct from old.id
       or new.avatar_url is distinct from old.avatar_url
       or new.eligibility_status is distinct from old.eligibility_status
       or new.eligibility_source is distinct from old.eligibility_source
       or new.eligibility_verified_at is distinct from old.eligibility_verified_at
       or new.account_status is distinct from old.account_status
       or new.onboarding_completed_at is distinct from old.onboarding_completed_at
       or new.is_approved is distinct from old.is_approved
       or new.is_demo is distinct from old.is_demo
       or new.created_at is distinct from old.created_at then
      raise exception 'protected profile column' using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  new.is_approved := (
    new.eligibility_status = 'verified'
    and new.account_status = 'active'
    and new.onboarding_completed_at is not null
    and app_private.has_chess_link(new.id)
  );
  return new;
end;
$$;
create trigger profiles_before_write before insert or update on public.profiles
  for each row execute function app_private.profiles_before_write();

-- Re-evaluate approval whenever a player's link appears or disappears.
create function app_private.refresh_profile_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set updated_at = now() where id = coalesce(new.user_id, old.user_id);
  return null;
end;
$$;
create trigger chess_account_links_refresh_approval after insert or delete on public.chess_account_links
  for each row execute function app_private.refresh_profile_approval();

create trigger profile_settings_updated_at before update on public.profile_settings
  for each row execute function app_private.set_updated_at();
create trigger chess_link_claims_updated_at before update on public.chess_link_claims
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Notifications (needed by the functions below)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create function app_private.notify(
  p_user uuid, p_type public.notification_type, p_title text, p_body text default '', p_data jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications (user_id, type, title, body, data)
  select p_user, p_type, p_title, coalesce(p_body, ''), coalesce(p_data, '{}'::jsonb)
  where exists (select 1 from public.profiles where id = p_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- Eligibility
-- ---------------------------------------------------------------------------
-- Matches the signed-in user's *verified* Google email against the admin allowlist.
-- The email comes from auth.users (set by Supabase Auth), never from client input.
create function public.claim_eligibility() returns public.eligibility_status
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_status public.eligibility_status;
  v_source text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at into v_email, v_confirmed
  from auth.users u where u.id = v_uid;

  select eligibility_status into v_status from public.profiles where id = v_uid for update;
  if v_status is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if v_status in ('verified', 'revoked') then
    return v_status;
  end if;
  if v_email is null or v_confirmed is null then
    return v_status;
  end if;

  select case when e.kind = 'email' then 'allowlist_email' else 'allowlist_domain' end
    into v_source
  from public.student_eligibility e
  where e.revoked_at is null
    and ((e.kind = 'email' and e.value = v_email)
      or (e.kind = 'domain' and e.value = split_part(v_email, '@', 2)))
  order by (e.kind = 'email') desc
  limit 1;

  if v_source is null then
    return v_status;
  end if;

  update public.profiles
     set eligibility_status = 'verified', eligibility_source = v_source, eligibility_verified_at = now()
   where id = v_uid;
  perform app_private.write_audit(v_uid, 'system', 'eligibility.auto_verified', 'profile', v_uid::text, null,
    jsonb_build_object('eligibility_status', v_status), jsonb_build_object('eligibility_status', 'verified', 'source', v_source));
  perform app_private.notify(v_uid, 'eligibility_result', 'College eligibility verified',
    'Your account is on the approved MNNIT student list.', '{}'::jsonb);
  return 'verified';
end;
$$;

create function public.request_eligibility_review(p_identifier text, p_note text default null)
returns public.eligibility_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.eligibility_requests;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app_private.hit_rate_limit('eligibility_request:' || v_uid::text, 5, 86400) then
    raise exception 'rate_limited' using errcode = '53400';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and eligibility_status <> 'unverified') then
    raise exception 'eligibility is already decided for this account' using errcode = 'P0001';
  end if;
  insert into public.eligibility_requests (user_id, claimed_identifier, note)
  values (v_uid, btrim(p_identifier), nullif(btrim(p_note), ''))
  returning * into v_row;
  return v_row;
exception when unique_violation then
  raise exception 'you already have an open eligibility request' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Chess.com claims
-- ---------------------------------------------------------------------------
-- The verification code is generated HERE, never accepted from the client. If a client
-- could choose the code it could pick a string already present on someone else's public
-- profile and be "verified" as that player.
create function app_private.generate_verification_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
  i integer;
begin
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
  end loop;
  return 'MNNIT-' || v_code;
end;
$$;

create function public.start_chess_claim(p_username text, p_method public.verification_method default 'profile_code')
returns public.chess_link_claims
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.normalize_chess_username(p_username);
  v_profile public.profiles;
  v_claim public.chess_link_claims;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_method = 'oauth' then
    raise exception 'oauth_unavailable: Chess.com OAuth has not been approved for this application' using errcode = 'P0001';
  end if;
  if not public.is_valid_chess_username(v_name) then
    raise exception 'invalid_username' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  if v_profile.account_status <> 'active' then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  if v_profile.eligibility_status <> 'verified' then
    raise exception 'eligibility_required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.chess_account_links where user_id = v_uid) then
    raise exception 'already_linked: use account recovery to change a verified Chess.com account' using errcode = 'P0001';
  end if;
  if not app_private.hit_rate_limit('claim_start:' || v_uid::text, 10, 3600) then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  update public.chess_link_claims
     set status = 'cancelled', review_reason = 'superseded by a newer claim'
   where user_id = v_uid and status in ('pending', 'needs_review');

  insert into public.chess_link_claims (user_id, chess_username, method, verification_code, code_expires_at)
  values (v_uid, v_name, p_method, app_private.generate_verification_code(), now() + interval '48 hours')
  returning * into v_claim;

  perform app_private.write_audit(v_uid, 'user', 'chess_claim.started', 'chess_link_claim', v_claim.id::text, null, null,
    jsonb_build_object('chess_username', v_name, 'method', p_method));
  return v_claim;
end;
$$;

create function public.cancel_chess_claim() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  update public.chess_link_claims
     set status = 'cancelled', review_reason = 'cancelled by the player'
   where user_id = v_uid and status in ('pending', 'needs_review');
end;
$$;

-- Player asks a human to verify ownership (used when the automatic check cannot).
create function public.submit_claim_for_review(p_note text) returns public.chess_link_claims
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.chess_link_claims;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 or char_length(p_note) > 1000 then
    raise exception 'explain how a reviewer can confirm you own this account (10-1000 characters)' using errcode = '22023';
  end if;
  if not app_private.hit_rate_limit('claim_review:' || v_uid::text, 5, 86400) then
    raise exception 'rate_limited' using errcode = '53400';
  end if;
  update public.chess_link_claims
     set status = 'needs_review', method = 'admin_review',
         evidence = evidence || jsonb_build_object('player_note', btrim(p_note), 'submitted_at', now())
   where user_id = v_uid and status = 'pending'
   returning * into v_claim;
  if not found then
    raise exception 'no pending claim to submit' using errcode = 'P0002';
  end if;
  return v_claim;
end;
$$;

-- Shared by the automatic (service role) and manual (admin) approval paths. Runs in the
-- caller's transaction; the UNIQUE constraints on chess_account_links arbitrate races.
create function app_private.finalize_claim(
  p_claim_id uuid,
  p_method public.verification_method,
  p_player_id bigint,
  p_reviewer uuid,
  p_note text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_claim public.chess_link_claims;
  v_constraint text;
  v_reason text;
begin
  select * into v_claim from public.chess_link_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim_not_found' using errcode = 'P0002';
  end if;
  if v_claim.status not in ('pending', 'needs_review') then
    return jsonb_build_object('ok', false, 'reason', 'claim_not_open', 'status', v_claim.status);
  end if;
  if p_method = 'profile_code' and v_claim.code_expires_at is not null and v_claim.code_expires_at < now() then
    update public.chess_link_claims set status = 'expired' where id = p_claim_id;
    return jsonb_build_object('ok', false, 'reason', 'claim_expired');
  end if;

  begin
    insert into public.chess_account_links (user_id, chess_username, chess_player_id, verification_method, claim_id)
    values (v_claim.user_id, v_claim.chess_username, p_player_id, p_method, v_claim.id);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_reason := case v_constraint
      when 'chess_account_links_user_id_key' then 'user_already_linked'
      else 'chess_account_already_linked'
    end;
    update public.chess_link_claims
       set status = 'rejected', review_reason = v_reason, reviewed_at = now(), reviewed_by = p_reviewer
     where id = p_claim_id;
    perform app_private.write_audit(coalesce(p_reviewer, v_claim.user_id), case when p_reviewer is null then 'system' else 'admin' end,
      'chess_claim.duplicate_blocked', 'chess_link_claim', p_claim_id::text, v_reason, null,
      jsonb_build_object('chess_username', v_claim.chess_username, 'constraint', v_constraint));
    perform app_private.notify(v_claim.user_id, 'verification_result', 'Chess.com account could not be linked',
      case v_reason when 'user_already_linked' then 'Your account already has a verified Chess.com link.'
        else 'That Chess.com username is already linked to another member. Request account recovery if it is yours.' end,
      jsonb_build_object('claim_id', p_claim_id, 'reason', v_reason));
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end;

  update public.chess_link_claims
     set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer,
         chess_player_id = coalesce(p_player_id, chess_player_id),
         review_reason = coalesce(p_note, review_reason)
   where id = p_claim_id;

  perform app_private.write_audit(coalesce(p_reviewer, v_claim.user_id), case when p_reviewer is null then 'system' else 'admin' end,
    'chess_link.verified', 'chess_link_claim', p_claim_id::text, p_note, null,
    jsonb_build_object('user_id', v_claim.user_id, 'chess_username', v_claim.chess_username, 'method', p_method, 'chess_player_id', p_player_id));
  perform app_private.notify(v_claim.user_id, 'verification_result', 'Chess.com account verified',
    'You are now linked to ' || v_claim.chess_username || ' on Chess.com.',
    jsonb_build_object('claim_id', p_claim_id, 'chess_username', v_claim.chess_username));
  return jsonb_build_object('ok', true, 'user_id', v_claim.user_id, 'chess_username', v_claim.chess_username);
end;
$$;

-- Trusted-server entry point. The Next.js route fetches the public Chess.com profile,
-- checks the code, and only then calls this with the *observed* username / player id.
create function public.confirm_chess_link(
  p_claim_id uuid,
  p_observed_username text,
  p_observed_player_id bigint,
  p_method public.verification_method default 'profile_code'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_claim public.chess_link_claims;
begin
  select * into v_claim from public.chess_link_claims where id = p_claim_id;
  if not found then raise exception 'claim_not_found' using errcode = 'P0002'; end if;
  if public.normalize_chess_username(p_observed_username) <> v_claim.chess_username then
    return jsonb_build_object('ok', false, 'reason', 'username_mismatch');
  end if;
  if p_method = 'oauth' then
    raise exception 'oauth_unavailable' using errcode = 'P0001';
  end if;
  return app_private.finalize_claim(p_claim_id, p_method, p_observed_player_id, null, null);
end;
$$;

-- Records a failed automatic check (for UX feedback and attempt limiting).
create function public.record_claim_check(p_claim_id uuid, p_result text) returns void
language sql security definer set search_path = '' as $$
  update public.chess_link_claims
     set attempts = attempts + 1, last_checked_at = now(), last_check_result = left(p_result, 200)
   where id = p_claim_id and status in ('pending', 'needs_review')
$$;

create function public.complete_onboarding() returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_done timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not app_private.setting_bool('registration_open', true) then
    raise exception 'registration_closed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.chess_account_links where user_id = v_uid)
     and not exists (select 1 from public.chess_link_claims where user_id = v_uid and status in ('pending', 'needs_review')) then
    raise exception 'submit a Chess.com username before finishing onboarding' using errcode = 'P0001';
  end if;
  update public.profiles
     set onboarding_completed_at = coalesce(onboarding_completed_at, now())
   where id = v_uid
   returning onboarding_completed_at into v_done;
  return v_done;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: unlink + account recovery (audit-logged, role-checked inside the database)
-- ---------------------------------------------------------------------------
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

create function public.request_account_recovery(p_kind public.recovery_kind, p_username text, p_reason text)
returns public.account_recovery_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.normalize_chess_username(p_username);
  v_row public.account_recovery_requests;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_valid_chess_username(v_name) then
    raise exception 'invalid_username' using errcode = '22023';
  end if;
  if not app_private.hit_rate_limit('recovery_request:' || v_uid::text, 3, 86400) then
    raise exception 'rate_limited' using errcode = '53400';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and eligibility_status = 'verified') then
    raise exception 'eligibility_required' using errcode = 'P0001';
  end if;
  insert into public.account_recovery_requests (requester_id, kind, requested_username, reason)
  values (v_uid, p_kind, v_name, btrim(p_reason))
  returning * into v_row;
  perform app_private.write_audit(v_uid, 'user', 'recovery.requested', 'account_recovery_request', v_row.id::text, btrim(p_reason), null,
    jsonb_build_object('kind', p_kind, 'requested_username', v_name));
  return v_row;
exception when unique_violation then
  raise exception 'you already have an open recovery request' using errcode = 'P0001';
end;
$$;

-- Approval does NOT hand anyone a username. It removes the obstacle (the old link) and
-- the requester must still pass normal ownership verification afterwards.
create function public.admin_resolve_recovery(p_request_id uuid, p_approve boolean, p_reason text)
returns public.account_recovery_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_req public.account_recovery_requests;
  v_holder uuid;
begin
  v_actor := app_private.require_role(array['verification_admin']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into v_req from public.account_recovery_requests where id = p_request_id for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_req.status <> 'open' then raise exception 'request already resolved' using errcode = 'P0001'; end if;

  if p_approve then
    if v_req.kind = 'change_username' then
      perform app_private.unlink_chess_account(v_req.requester_id, v_actor, 'recovery approved: ' || btrim(p_reason));
    else
      select user_id into v_holder from public.chess_account_links where chess_username = v_req.requested_username;
      if v_holder is not null then
        if v_holder = v_req.requester_id then
          raise exception 'requester already holds this username' using errcode = 'P0001';
        end if;
        perform app_private.unlink_chess_account(v_holder, v_actor, 'recovery approved for another member: ' || btrim(p_reason));
        perform app_private.notify(v_holder, 'recovery_decision', 'Chess.com link removed',
          'An administrator reassigned the Chess.com username ' || v_req.requested_username || ' after a recovery request.', '{}'::jsonb);
      end if;
    end if;
  end if;

  update public.account_recovery_requests
     set status = case when p_approve then 'approved'::public.request_status else 'rejected'::public.request_status end,
         reviewed_by = v_actor, reviewed_at = now(), review_reason = btrim(p_reason)
   where id = p_request_id returning * into v_req;

  perform app_private.write_audit(v_actor, 'admin', case when p_approve then 'recovery.approved' else 'recovery.rejected' end,
    'account_recovery_request', p_request_id::text, btrim(p_reason), null,
    jsonb_build_object('kind', v_req.kind, 'requested_username', v_req.requested_username, 'requester_id', v_req.requester_id));
  perform app_private.notify(v_req.requester_id, 'recovery_decision',
    case when p_approve then 'Account recovery approved' else 'Account recovery declined' end,
    case when p_approve then 'Start Chess.com verification again to link ' || v_req.requested_username || '. ' || btrim(p_reason)
         else btrim(p_reason) end,
    jsonb_build_object('request_id', p_request_id, 'approved', p_approve));
  return v_req;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: eligibility, claim review, suspension, roles
-- ---------------------------------------------------------------------------
create function public.admin_add_eligibility(p_kind text, p_values text[], p_note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_value text;
  v_count integer := 0;
  v_inserted integer;
begin
  if p_kind = 'domain' then
    v_actor := app_private.require_role(array[]::public.app_role[]);   -- super_admin only
  else
    v_actor := app_private.require_role(array['verification_admin']::public.app_role[]);
  end if;
  if p_kind not in ('email', 'domain') then raise exception 'invalid kind' using errcode = '22023'; end if;
  if coalesce(array_length(p_values, 1), 0) = 0 or array_length(p_values, 1) > 1000 then
    raise exception 'provide between 1 and 1000 values' using errcode = '22023';
  end if;
  foreach v_value in array p_values loop
    v_value := lower(btrim(v_value));
    continue when v_value = '';
    insert into public.student_eligibility (kind, value, note, created_by)
    values (p_kind, v_value, nullif(btrim(p_note), ''), v_actor)
    on conflict (kind, value) do update
      set revoked_at = null, revoked_by = null, note = coalesce(excluded.note, public.student_eligibility.note)
      where public.student_eligibility.revoked_at is not null;
    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;
  perform app_private.write_audit(v_actor, 'admin', 'eligibility.entries_added', 'student_eligibility', null, p_note, null,
    jsonb_build_object('kind', p_kind, 'added', v_count));
  return v_count;
end;
$$;

create function public.admin_remove_eligibility(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := app_private.require_role(array['verification_admin']::public.app_role[]);
  update public.student_eligibility set revoked_at = now(), revoked_by = v_actor where id = p_id and revoked_at is null;
  if not found then raise exception 'entry not found' using errcode = 'P0002'; end if;
  perform app_private.write_audit(v_actor, 'admin', 'eligibility.entry_revoked', 'student_eligibility', p_id::text, p_reason);
end;
$$;

create function public.admin_set_user_eligibility(p_user uuid, p_status public.eligibility_status, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_before public.eligibility_status;
begin
  v_actor := app_private.require_role(array['verification_admin']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select eligibility_status into v_before from public.profiles where id = p_user for update;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  update public.profiles
     set eligibility_status = p_status,
         eligibility_source = case when p_status = 'verified' then 'admin_approval' else eligibility_source end,
         eligibility_verified_at = case when p_status = 'verified' then now() else eligibility_verified_at end
   where id = p_user;
  if p_status <> 'verified' then
    perform app_private.detach_player_from_challenges(p_user, 'participant eligibility changed');
  end if;
  perform app_private.write_audit(v_actor, 'admin', 'eligibility.user_set', 'profile', p_user::text, btrim(p_reason),
    jsonb_build_object('eligibility_status', v_before), jsonb_build_object('eligibility_status', p_status));
  perform app_private.notify(p_user, 'eligibility_result',
    case p_status when 'verified' then 'College eligibility verified' else 'College eligibility updated' end,
    btrim(p_reason), '{}'::jsonb);
end;
$$;

create function public.admin_review_eligibility_request(p_id uuid, p_approve boolean, p_reason text)
returns public.eligibility_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_req public.eligibility_requests;
begin
  v_actor := app_private.require_role(array['verification_admin']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into v_req from public.eligibility_requests where id = p_id for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_req.status <> 'open' then raise exception 'request already resolved' using errcode = 'P0001'; end if;

  update public.eligibility_requests
     set status = case when p_approve then 'approved'::public.request_status else 'rejected'::public.request_status end,
         reviewed_by = v_actor, reviewed_at = now(), review_reason = btrim(p_reason)
   where id = p_id returning * into v_req;

  if p_approve then
    update public.profiles
       set eligibility_status = 'verified', eligibility_source = 'admin_approval', eligibility_verified_at = now()
     where id = v_req.user_id and eligibility_status <> 'revoked';
  end if;
  perform app_private.write_audit(v_actor, 'admin', case when p_approve then 'eligibility_request.approved' else 'eligibility_request.rejected' end,
    'eligibility_request', p_id::text, btrim(p_reason), null, jsonb_build_object('user_id', v_req.user_id));
  perform app_private.notify(v_req.user_id, 'eligibility_result',
    case when p_approve then 'College eligibility approved' else 'College eligibility request declined' end,
    btrim(p_reason), '{}'::jsonb);
  return v_req;
end;
$$;

-- Manual verification of a Chess.com claim. `p_player_id` is whatever the server observed
-- from the public API when the reviewer opened the claim (may be null if unavailable).
create function public.admin_review_claim(p_claim_id uuid, p_approve boolean, p_player_id bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_claim public.chess_link_claims;
  v_result jsonb;
begin
  v_actor := app_private.require_role(array['verification_admin']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into v_claim from public.chess_link_claims where id = p_claim_id;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;

  if p_approve then
    return app_private.finalize_claim(p_claim_id, 'admin_review', p_player_id, v_actor, btrim(p_reason));
  end if;

  update public.chess_link_claims
     set status = 'rejected', reviewed_by = v_actor, reviewed_at = now(), review_reason = btrim(p_reason)
   where id = p_claim_id and status in ('pending', 'needs_review');
  perform app_private.write_audit(v_actor, 'admin', 'chess_claim.rejected', 'chess_link_claim', p_claim_id::text, btrim(p_reason), null,
    jsonb_build_object('user_id', v_claim.user_id, 'chess_username', v_claim.chess_username));
  perform app_private.notify(v_claim.user_id, 'verification_result', 'Chess.com verification declined', btrim(p_reason),
    jsonb_build_object('claim_id', p_claim_id));
  return jsonb_build_object('ok', true, 'rejected', true);
end;
$$;

create function public.admin_set_account_status(p_user uuid, p_suspend boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_before public.account_status;
begin
  v_actor := app_private.require_role(array['verification_admin', 'match_moderator']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_user = v_actor then raise exception 'you cannot suspend your own account' using errcode = 'P0001'; end if;
  select account_status into v_before from public.profiles where id = p_user for update;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  update public.profiles
     set account_status = case when p_suspend then 'suspended'::public.account_status else 'active'::public.account_status end
   where id = p_user;
  if p_suspend then
    perform app_private.detach_player_from_challenges(p_user, 'participant suspended');
  end if;
  perform app_private.write_audit(v_actor, 'admin', case when p_suspend then 'user.suspended' else 'user.reinstated' end,
    'profile', p_user::text, btrim(p_reason), jsonb_build_object('account_status', v_before),
    jsonb_build_object('account_status', case when p_suspend then 'suspended' else 'active' end));
  perform app_private.notify(p_user, 'account_notice',
    case when p_suspend then 'Account suspended' else 'Account reinstated' end, btrim(p_reason), '{}'::jsonb);
end;
$$;

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

-- Bootstrap for the very first super admin. Executable only by service_role / postgres
-- (see migration 07). Documented in docs/ADMIN_BOOTSTRAP.md.
create function public.bootstrap_super_admin(p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email)) order by created_at limit 1;
  if v_user is null then
    raise exception 'no auth user with that email; the person must sign in with Google once first' using errcode = 'P0002';
  end if;
  insert into public.admin_roles (user_id, role, granted_by) values (v_user, 'super_admin', null) on conflict do nothing;
  perform app_private.write_audit(null, 'system', 'role.bootstrap_super_admin', 'profile', v_user::text,
    'initial administrator bootstrap', null, jsonb_build_object('role', 'super_admin'));
  return v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Account deletion bookkeeping (the auth user itself is deleted by the server)
-- ---------------------------------------------------------------------------
create function app_private.audit_account_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.write_audit(old.id, 'user', 'account.deleted', 'profile', old.id::text, null, null, null);
  return old;
end;
$$;
create trigger profiles_audit_delete before delete on public.profiles
  for each row execute function app_private.audit_account_deleted();
