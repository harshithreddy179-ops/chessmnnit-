import { apiRoute, unwrap } from "@/server/api";
import { challengeCreateSchema } from "@/lib/schemas";
import type { Database } from "@/lib/database.types";

type ChallengeInsert = Database["public"]["Tables"]["challenges"]["Insert"];

/**
 * Create a challenge. Eligibility, duplicates, limits, usernames and expiry are all decided by
 * the database trigger; this route only forwards the three columns a client may set.
 */
export const POST = apiRoute(
  { schema: challengeCreateSchema, requireOnboarded: true },
  async ({ ctx, body }) => {
    // The remaining NOT NULL columns are filled by the BEFORE INSERT trigger (and clients
    // have no INSERT privilege on them), hence the cast.
    const row = {
      recipient_id: body.recipient_id,
      time_control: body.time_control,
      message: body.message ?? null,
    } as ChallengeInsert;
    const created = unwrap(
      await ctx.supabase.from("challenges").insert(row).select("id,status,expires_at").single(),
    );
    return created;
  },
);
