import { apiRoute } from "@/server/api";
import { chessLinkSchema } from "@/lib/schemas";
import { linkOwnChessAccount } from "@/server/chess-link";

/** Link the Chess.com username the signed-in player typed. */
export const POST = apiRoute(
  { schema: chessLinkSchema, requireOnboarded: false },
  async ({ ctx, body }) => linkOwnChessAccount(ctx, body.username),
);
