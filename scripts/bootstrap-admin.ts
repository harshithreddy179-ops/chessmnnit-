/**
 * Makes the very first super admin.
 *
 *   npm run admin:bootstrap -- you@example.com
 *
 * The person must have signed in with Google at least once (that creates their auth user).
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (read from .env.local if present).
 * The database function is executable only by the service role, it is idempotent, and it writes
 * an audit-log entry. After this, super admins manage everyone else in /admin/roles.
 * See docs/ADMIN_BOOTSTRAP.md.
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const email = process.argv[2]?.trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Usage: npm run admin:bootstrap -- you@example.com");
    process.exit(2);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    console.error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (for example in .env.local) and try again.",
    );
    process.exit(2);
  }
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("bootstrap_super_admin", { p_email: email });
  if (error) {
    if (error.code === "P0002") {
      console.error(
        `No account exists for ${email}. Sign in to the site with that Google account once, then run this again.`,
      );
    } else {
      console.error(`Could not bootstrap: ${error.message}`);
    }
    process.exit(1);
  }
  console.log(`${email} is now a super admin (user id ${String(data)}).`);
}

void main();
