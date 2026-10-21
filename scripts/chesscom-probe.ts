/**
 * Operator probe for the live Chess.com Published-Data API.
 *
 * This project was built and tested against a local stand-in modelled on Chess.com's
 * documentation, because the build environment could not reach api.chess.com. Run this once
 * from a machine that can, to check that the real responses match what the code expects BEFORE
 * relying on automatic verification and result sync:
 *
 *   npm run chesscom:probe -- <username> [YYYY/MM] [--code MNNIT-XXXXXXXX] [--contact you@example.com]
 *
 *   <username>  any public Chess.com account (yours is fine)
 *   YYYY/MM     a month to read the game archive for (default: the current month)
 *   --code      a verification code you have typed into your own Location/Name field, to
 *               confirm the profile-code round trip works (and see how long Chess.com's
 *               cache takes to show an edit)
 *
 * It only makes read-only, documented GET requests, one at a time, with the same User-Agent
 * format as the app. It prints a report and exits non-zero if anything the app relies on is
 * missing or shaped differently. Paste the report into docs/CHESSCOM_INTEGRATION.md.
 */
import { ChessComClient, buildUserAgent } from "@/lib/chess/client";
import { currentMonth, normalizeArchiveGame } from "@/lib/chess/games";
import { isValidChessUsername, normalizeChessUsername } from "@/lib/chess/username";
import { profileContainsCode } from "@/lib/chess/verification/profile-code";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  return value;
};
const code = flag("--code");
const contact = flag("--contact") ?? process.env.CHESSCOM_CONTACT_EMAIL ?? null;
const [rawUser, rawMonth] = args;

const results: { check: string; ok: boolean; detail: string }[] = [];
const record = (check: string, ok: boolean, detail: string) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${check}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  if (!rawUser) {
    console.error(
      "Usage: npm run chesscom:probe -- <username> [YYYY/MM] [--code CODE] [--contact EMAIL]",
    );
    process.exit(2);
  }
  const username = normalizeChessUsername(rawUser);
  if (!isValidChessUsername(username)) {
    console.error(`"${rawUser}" is not a valid Chess.com username.`);
    process.exit(2);
  }
  const month = rawMonth ?? currentMonth(new Date());
  const userAgent = buildUserAgent("https://example.invalid", contact);
  console.log(`User-Agent: ${userAgent}\n`);

  // 1. Raw reachability and headers (what the cache looks like).
  const base = "https://api.chess.com/pub";
  for (const path of [
    `/player/${username}`,
    `/player/${username}/stats`,
    `/player/${username}/games/${month}`,
  ]) {
    try {
      const res = await fetch(base + path, {
        headers: { "User-Agent": userAgent, Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      const h = (n: string) => res.headers.get(n) ?? "-";
      record(
        `GET ${path}`,
        res.status === 200,
        `HTTP ${res.status}; etag=${h("etag")}; last-modified=${h("last-modified")}; cache-control=${h("cache-control")}; age=${h("age")}`,
      );
      await res.arrayBuffer();
    } catch (error) {
      record(`GET ${path}`, false, `${(error as Error).name}: ${(error as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // 2. The application's own client and schemas against the same data.
  const client = new ChessComClient({ userAgent, minIntervalMs: 500, maxRetries: 1 });
  try {
    const profile = await client.getProfile(username);
    record(
      "profile parses with the app's schema",
      true,
      `player_id=${profile.player_id ?? "MISSING"}, username=${profile.username}`,
    );
    record(
      "profile has player_id (needed to detect renames)",
      typeof profile.player_id === "number",
      "",
    );
    record(
      "profile exposes 'location' or 'name' (needed by the profile-code check)",
      "location" in profile || "name" in profile,
      `location=${JSON.stringify(profile.location ?? null)} name=${JSON.stringify(profile.name ?? null)}`,
    );
    if (code) {
      const seen = profileContainsCode(profile, code);
      record(
        "profile-code round trip",
        seen,
        seen
          ? "the code is visible through the public API: automatic verification will work"
          : "the code is NOT visible yet. Chess.com caches profiles; wait and re-run to measure the delay. If it never appears, set CHESSCOM_PROFILE_CODE_VERIFICATION=false and use administrator review",
      );
    }
  } catch (error) {
    record("profile parses with the app's schema", false, String(error));
  }

  try {
    const stats = await client.getStats(username);
    record(
      "stats parse with the app's schema",
      true,
      `keys: ${
        Object.keys(stats)
          .filter((k) => k.startsWith("chess_"))
          .join(", ") || "(no rated categories)"
      }`,
    );
  } catch (error) {
    record("stats parse with the app's schema", false, String(error));
  }

  try {
    const archive = await client.getMonthlyArchive(username, month);
    const games = archive.data?.games ?? [];
    let normalised = 0;
    const problems = new Map<string, number>();
    for (const g of games) {
      const r = normalizeArchiveGame(g, month);
      if (r.game) normalised++;
      else {
        const why = r.skipped ?? "unknown";
        problems.set(why, (problems.get(why) ?? 0) + 1);
      }
    }
    record(
      `archive ${month} normalises`,
      games.length === 0 || normalised > 0,
      `${games.length} games, ${normalised} usable${problems.size ? `; skipped: ${[...problems].map(([k, v]) => `${k}×${v}`).join(", ")}` : ""}`,
    );
    const again = await client.getMonthlyArchive(username, month, {
      etag: archive.etag,
      lastModified: archive.lastModified,
    });
    record(
      "conditional request (ETag / Last-Modified) is honoured",
      again.status === 304 || (archive.etag === null && archive.lastModified === null),
      archive.etag || archive.lastModified
        ? `second request answered ${again.status}`
        : "the server sent no validators; the app will simply re-read the archive each time",
    );
  } catch (error) {
    record(`archive ${month} normalises`, false, String(error));
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
}

void main();
