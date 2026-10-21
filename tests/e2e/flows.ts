import type { APIRequestContext } from "@playwright/test";
import type { Player, TestDb } from "../db/helpers";
import type { FakeChessCom } from "../helpers/fake-chesscom";
import { appUrl, E2E } from "./env";

/**
 * Plays one college game start to finish without the UI: challenge, accept, a finished game on
 * the fake Chess.com, then two runs of the real scheduled job (found, then verified after the
 * settle window). Returns the challenge id. Used by specs that need a verified result as a starting point.
 */
export async function playVerifiedMatch(
  ctx: { db: TestDb; chess: FakeChessCom; request: APIRequestContext },
  white: Player,
  black: Player,
  winner: "white" | "black" | "draw" = "white",
): Promise<string> {
  const { db, chess, request } = ctx;
  const challenger = white;
  const recipient = black;
  const id = (await db.as(challenger.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '600') returning id", [recipient.id])).rows[0].id as string;
  await db.as(recipient.id).query("update public.challenges set status = 'accepted' where id = $1", [id]);
  await db.admin.query("update public.challenges set accepted_at = now() - interval '3 hours', next_check_at = now() - interval '1 second' where id = $1", [id]);
  chess.addGame({ white: white.username, black: black.username, winner, endedAt: new Date(Date.now() - 30 * 60_000) });
  const headers = { authorization: `Bearer ${E2E.cronSecret}` };
  const found = await request.post(`${appUrl}/api/cron/sync-challenges`, { headers });
  if (found.status() !== 200) throw new Error(`sync-challenges failed: ${found.status()} ${await found.text()}`);
  await db.admin.query("update public.challenges set settle_until = now() - interval '1 minute', next_check_at = now() - interval '1 second' where id = $1", [id]);
  const verified = await request.post(`${appUrl}/api/cron/sync-challenges`, { headers });
  if (verified.status() !== 200) throw new Error(`sync-challenges failed: ${verified.status()} ${await verified.text()}`);
  const status = (await db.admin.query("select status from public.challenges where id = $1", [id])).rows[0].status;
  if (status !== "result_verified") throw new Error(`expected result_verified, got ${status}`);
  return id;
}
