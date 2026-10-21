-- ============================================================================
-- OPTIONAL: drive the scheduled jobs from inside Supabase (pg_cron + pg_net).
--
-- Use this when you do not want an external scheduler. It is NOT a migration, because it needs
-- your site URL and CRON_SECRET, which must never be committed. Run it once in the Supabase SQL
-- editor after replacing the two placeholders. Prerequisites: enable the "pg_cron" and "pg_net"
-- extensions (Dashboard → Database → Extensions).
--
-- The CRON_SECRET is stored in Supabase Vault so it does not sit in plain text in cron.job:
--   select vault.create_secret('<the same value as the CRON_SECRET env var>', 'mnnit_cron_secret');
-- ============================================================================

-- Every 10 minutes: expire stale challenges, check accepted games, refresh a batch of players.
select cron.schedule(
  'mnnit-run-all',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-SITE.example.edu/api/cron/run-all',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mnnit_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Inspect / remove:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select cron.unschedule('mnnit-run-all');
