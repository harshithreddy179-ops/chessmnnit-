import { apiRoute } from "@/server/api";
import { checkClaim } from "@/server/verification";

export const POST = apiRoute({ requireOnboarded: false }, async ({ ctx }) => checkClaim(ctx));
