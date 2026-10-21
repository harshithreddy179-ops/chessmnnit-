-- ============================================================================
-- TEST SHIM — NOT A MIGRATION. NEVER APPLY TO A REAL SUPABASE PROJECT.
--
-- Emulates the small part of the Supabase platform that the application
-- migrations depend on, so they can be executed against a plain PostgreSQL
-- server in CI and locally:
--   * the API roles (anon, authenticated, service_role, authenticator)
--   * auth.users, auth.uid(), auth.role(), auth.jwt()
--   * the `extensions` schema
--   * Supabase's permissive default privileges (worst case for our REVOKEs)
--   * the supabase_realtime publication
-- ============================================================================

do $$
begin
  -- Roles are cluster-global; tolerate re-runs against a cluster that already has them.
  begin create role anon nologin noinherit; exception when duplicate_object then null; end;
  begin create role authenticated nologin noinherit; exception when duplicate_object then null; end;
  begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end;
  begin create role authenticator noinherit login password 'authenticator'; exception when duplicate_object then null; end;
end
$$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists extensions;
create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

create function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- Supabase grants everything on new public objects to the API roles by default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create publication supabase_realtime;
