-- ============================================================================
-- 07 · Realtime: change feeds for notifications / challenges, presence authorization
-- ============================================================================

-- Postgres Changes are filtered by RLS for each subscriber: a client only ever receives
-- rows it could SELECT (its own notifications, challenges it takes part in).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'challenges') then
      alter publication supabase_realtime add table public.challenges;
    end if;
  end if;
end
$$;

-- Presence runs on a PRIVATE channel ("presence:community"). Realtime Authorization
-- evaluates these policies on realtime.messages, so only signed-in members can listen to
-- or track presence; anonymous visitors cannot see who is online.
-- (The realtime schema only exists on Supabase, so this block is a no-op elsewhere.)
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy "members can listen to community presence"
      on realtime.messages for select to authenticated
      using (
        realtime.messages.extension in ('presence')
        and (select realtime.topic()) = 'presence:community'
        and exists (select 1 from public.profiles pr where pr.id = (select auth.uid()))
      )
    $p$;
    execute $p$
      create policy "members can track community presence"
      on realtime.messages for insert to authenticated
      with check (
        realtime.messages.extension in ('presence')
        and (select realtime.topic()) = 'presence:community'
        and exists (select 1 from public.profiles pr where pr.id = (select auth.uid()))
      )
    $p$;
  end if;
end
$$;
