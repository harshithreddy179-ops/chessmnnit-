-- ============================================================================
-- 08 · Open registration and self-declared Chess.com links
-- ============================================================================
-- Two policy changes, both reversible and both visible in the admin UI:
--
--   1. The approved student list is no longer a gate. Every Google account is eligible when it
--      signs up, unless an administrator turns on the setting `require_student_eligibility`
--      (then the original flow applies to accounts created from that moment on).
--
--   2. A player links a Chess.com username by typing it. There is no ownership proof, so the
--      link is recorded with method 'self_declared' and is NOT presented as verified. The
--      one-to-one rule is unchanged (a username can belong to one member). Administrators can
--      always replace a link (`admin_set_chess_link`), and the existing recovery request flow
--      still lets a player ask for a change.
--
-- The older claim machinery (start_chess_claim, confirm_chess_link, admin_review_claim) is left
-- in place so existing claims stay reviewable; the app no longer starts new ones.
-- ============================================================================

alter type public.verification_method add value if not exists 'self_declared';

insert into public.app_settings (key, value, description, is_public) values
  ('require_student_eligibility', 'false'::jsonb,
   'When true, accounts created from now on must match the approved student list (Admin → Eligibility list) before they can link a Chess.com account. When false, every signed-in Google account is eligible.',
   true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- New accounts start eligible unless the setting says otherwise
-- ---------------------------------------------------------------------------
create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_open boolean := not app_private.setting_bool('require_student_eligibility', false);
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

  insert into public.profiles (id, display_name, eligibility_status, eligibility_source, eligibility_verified_at)
  values (
    new.id, v_name,
    case when v_open then 'verified'::public.eligibility_status else 'unverified'::public.eligibility_status end,
    case when v_open then 'open_registration' end,
    case when v_open then now() end
  )
  on conflict (id) do nothing;
  insert into public.profile_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Accounts that signed up before this change are eligible too.
update public.profiles
   set eligibility_status = 'verified', eligibility_source = 'open_registration', eligibility_verified_at = now()
 where eligibility_status = 'unverified'
   and not app_private.setting_bool('require_student_eligibility', false);

-- ---------------------------------------------------------------------------
-- Player: link the Chess.com username you typed
-- ---------------------------------------------------------------------------
create function public.link_my_chess_account(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.normalize_chess_username(p_username);
  v_profile public.profiles;
  v_constraint text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
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
    raise exception 'already_linked: ask an administrator to change your Chess.com account' using errcode = 'P0001';
  end if;
  if not app_private.hit_rate_limit('link_self:' || v_uid::text, 10, 3600) then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  begin
    insert into public.chess_account_links (user_id, chess_username, verification_method)
    values (v_uid, v_name, 'self_declared');
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    return jsonb_build_object('ok', false, 'reason',
      case v_constraint when 'chess_account_links_user_id_key' then 'user_already_linked'
        else 'chess_account_already_linked' end);
  end;

  -- A claim left over from the older flow can no longer be completed.
  update public.chess_link_claims
     set status = 'cancelled', review_reason = 'superseded by a direct link'
   where user_id = v_uid and status in ('pending', 'needs_review');

  perform app_private.write_audit(v_uid, 'user', 'chess_link.self_declared', 'profile', v_uid::text, null, null,
    jsonb_build_object('chess_username', v_name));
  return jsonb_build_object('ok', true, 'chess_username', v_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrator: set or replace a player's Chess.com account
-- ---------------------------------------------------------------------------
-- Covers every "something went wrong" case in one action: a typo, someone who linked another
-- person's username, a renamed account. If another member currently holds the username they are
-- unlinked (and told), the player's previous link is archived, then the new link is created.
-- `p_player_id` is whatever the server observed from the public API (may be null).
create function public.admin_set_chess_link(p_user uuid, p_username text, p_reason text, p_player_id bigint default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_name text := public.normalize_chess_username(p_username);
  v_before text;
  v_holder uuid;
begin
  v_actor := app_private.require_role(array['verification_admin']::public.app_role[]);
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if not public.is_valid_chess_username(v_name) then
    raise exception 'invalid_username' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  select chess_username into v_before from public.chess_account_links where user_id = p_user;
  if v_before = v_name then
    raise exception 'unchanged: that account is already linked to this member' using errcode = 'P0001';
  end if;

  select user_id into v_holder from public.chess_account_links where chess_username = v_name;
  if v_holder is not null then
    perform app_private.unlink_chess_account(v_holder, v_actor, 'reassigned by an administrator: ' || btrim(p_reason));
    perform app_private.notify(v_holder, 'recovery_decision', 'Chess.com link removed',
      'An administrator reassigned the Chess.com username ' || v_name || '. Link your own account again from your settings.',
      '{}'::jsonb);
  end if;
  if v_before is not null then
    perform app_private.unlink_chess_account(p_user, v_actor, 'changed by an administrator: ' || btrim(p_reason));
  end if;

  insert into public.chess_account_links (user_id, chess_username, chess_player_id, verification_method)
  values (p_user, v_name, p_player_id, 'admin_review');

  update public.chess_link_claims
     set status = 'cancelled', review_reason = 'superseded by an administrator'
   where user_id = p_user and status in ('pending', 'needs_review');

  perform app_private.write_audit(v_actor, 'admin', 'chess_link.set_by_admin', 'profile', p_user::text, btrim(p_reason),
    jsonb_build_object('chess_username', v_before),
    jsonb_build_object('chess_username', v_name, 'chess_player_id', p_player_id, 'taken_from', v_holder));
  perform app_private.notify(p_user, 'recovery_decision', 'Chess.com account updated',
    'An administrator linked your account to ' || v_name || ' on Chess.com. ' || btrim(p_reason), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'chess_username', v_name, 'previous', v_before);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges (new functions are executable by PUBLIC until revoked)
-- ---------------------------------------------------------------------------
revoke all on function
  public.link_my_chess_account(text),
  public.admin_set_chess_link(uuid, text, text, bigint)
from public, anon, authenticated;

grant execute on function
  public.link_my_chess_account(text),
  public.admin_set_chess_link(uuid, text, text, bigint)
to authenticated, service_role;
