import { describe, expect, it } from "vitest";
import { evaluateChallenge, nextCheckDelayMs, type ChallengeInput, type GameInput } from "@/lib/matching/matcher";

const T0 = new Date("2026-10-20T10:00:00Z"); // challenge accepted
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const challenge = (over: Partial<ChallengeInput> = {}): ChallengeInput => ({
  id: "c1",
  challengerUsername: "alice_s",
  recipientUsername: "bob_s",
  timeControl: "600",
  acceptedAt: T0,
  giveupAt: at(72 * 60),
  settleUntil: null,
  priorCandidateIds: [],
  checkCount: 0,
  ...over,
});

let n = 0;
const game = (over: Partial<GameInput> = {}): GameInput => ({
  id: `g${++n}`,
  whiteUsername: "alice_s",
  blackUsername: "bob_s",
  winner: "white",
  timeControl: "600",
  rules: "chess",
  startedAt: at(5),
  endedAt: at(20),
  url: `https://www.chess.com/game/live/${n}`,
  ...over,
});

const opts = (now: Date, attached: string[] = []) => ({ now, settleMinutes: 60, attachedGameIds: new Set(attached) });

describe("evaluateChallenge — finding the game", () => {
  it("reports no game yet, and backs off between checks", () => {
    const d = evaluateChallenge(challenge(), [], opts(at(30)));
    expect(d.kind).toBe("no_game");
    if (d.kind === "no_game") expect(d.nextCheckAt.getTime() - at(30).getTime()).toBe(10 * 60_000);
    expect(nextCheckDelayMs(0)).toBe(10 * 60_000);
    expect(nextCheckDelayMs(1)).toBe(15 * 60_000);
    expect(nextCheckDelayMs(3)).toBe(30 * 60_000);
    expect(nextCheckDelayMs(4)).toBe(60 * 60_000);
    expect(nextCheckDelayMs(99)).toBe(60 * 60_000);
  });

  it("gives up for manual review once the window has passed — never marks anything complete", () => {
    const d = evaluateChallenge(challenge(), [], opts(at(72 * 60 + 1)));
    expect(d.kind).toBe("give_up");
  });

  it("ignores games between other players", () => {
    const d = evaluateChallenge(challenge(), [game({ blackUsername: "carol_s" }), game({ whiteUsername: "dave_s" })], opts(at(30)));
    expect(d.kind).toBe("no_game");
    expect(d.rejected).toEqual([]);
  });

  it("accepts either colour assignment", () => {
    const d = evaluateChallenge(challenge(), [game({ whiteUsername: "bob_s", blackUsername: "alice_s", winner: "black" })], opts(at(30)));
    expect(d.kind).toBe("settling");
  });
});

describe("evaluateChallenge — rejecting games that cannot be the match", () => {
  it.each([
    ["ended before acceptance", { endedAt: at(-30), startedAt: at(-60) }, "ended_before_acceptance"],
    ["started before acceptance", { startedAt: at(-30) }, "started_before_acceptance"],
    ["different time control", { timeControl: "180" }, "time_control_mismatch"],
    ["a variant", { rules: "chess960" }, "unsupported_variant"],
  ] as const)("rejects a game that %s", (_label, over, reason) => {
    const g = game(over);
    const d = evaluateChallenge(challenge(), [g], opts(at(30)));
    expect(d.kind).toBe("no_game");
    expect(d.rejected).toEqual([{ gameId: g.id, reason }]);
  });

  it("tolerates a small clock difference at the start boundary", () => {
    expect(evaluateChallenge(challenge(), [game({ startedAt: at(-1) })], opts(at(30))).kind).toBe("settling");
    expect(evaluateChallenge(challenge(), [game({ startedAt: at(-3) })], opts(at(30))).kind).toBe("no_game");
  });

  it("treats a missing time control or start time as not determinable, not as a mismatch", () => {
    expect(evaluateChallenge(challenge(), [game({ timeControl: null, startedAt: null })], opts(at(30))).kind).toBe("settling");
  });

  it("never reuses a game already attached to a match", () => {
    const g = game();
    const d = evaluateChallenge(challenge(), [g], opts(at(30), [g.id]));
    expect(d.kind).toBe("no_game");
    expect(d.rejected).toEqual([{ gameId: g.id, reason: "already_counted" }]);
  });
});

describe("evaluateChallenge — never guessing", () => {
  it("treats several qualifying games as ambiguous instead of picking the first", () => {
    const first = game({ endedAt: at(20) });
    const second = game({ endedAt: at(50), winner: "black" });
    const d = evaluateChallenge(challenge(), [first, second], opts(at(90)));
    expect(d.kind).toBe("ambiguous");
    if (d.kind === "ambiguous") expect(d.candidates.map((c) => c.id)).toEqual([first.id, second.id]);
  });

  it("becomes ambiguous if a second game shows up while the first is settling", () => {
    const first = game();
    const settling = evaluateChallenge(challenge(), [first], opts(at(30)));
    expect(settling.kind).toBe("settling");
    const later = evaluateChallenge(
      challenge({ priorCandidateIds: [first.id], settleUntil: at(90) }),
      [first, game({ endedAt: at(70) })],
      opts(at(95)),
    );
    expect(later.kind).toBe("ambiguous");
  });

  it("an extra game that does not qualify (other time control) does not create ambiguity", () => {
    const real = game();
    const blitz = game({ timeControl: "180", endedAt: at(40) });
    const d = evaluateChallenge(challenge(), [real, blitz], opts(at(30)));
    expect(d.kind).toBe("settling");
    expect(d.rejected.map((r) => r.reason)).toEqual(["time_control_mismatch"]);
  });

  it("sends an unrecognised result to review rather than counting it", () => {
    const d = evaluateChallenge(challenge(), [game({ winner: "unknown" })], opts(at(30)));
    expect(d.kind).toBe("unknown_result");
  });
});

describe("evaluateChallenge — the settle window", () => {
  it("does not verify on first sight: it starts a settle window", () => {
    const g = game();
    const d = evaluateChallenge(challenge(), [g], opts(at(30)));
    expect(d.kind).toBe("settling");
    if (d.kind === "settling") {
      expect(d.settleUntil.getTime()).toBe(at(90).getTime());
      expect(d.nextCheckAt.getTime()).toBeGreaterThan(d.settleUntil.getTime());
    }
  });

  it("keeps waiting while the window is open and the candidate is unchanged", () => {
    const g = game();
    const d = evaluateChallenge(challenge({ priorCandidateIds: [g.id], settleUntil: at(90) }), [g], opts(at(60)));
    expect(d.kind).toBe("settling");
    if (d.kind === "settling") expect(d.settleUntil.getTime()).toBe(at(90).getTime()); // window is not extended
  });

  it("verifies only after the window, with auditable evidence", () => {
    const g = game();
    const d = evaluateChallenge(challenge({ priorCandidateIds: [g.id], settleUntil: at(90), checkCount: 3 }), [g], opts(at(95)));
    expect(d.kind).toBe("verified");
    if (d.kind === "verified") {
      expect(d.game.id).toBe(g.id);
      expect(d.evidence).toMatchObject({
        rules_version: 1,
        game_url: g.url,
        checks: { players_match: true, only_candidate: true, settle_minutes: 60, time_control: "match" },
      });
    }
  });

  it("restarts the window if the candidate changed", () => {
    const g = game();
    const d = evaluateChallenge(challenge({ priorCandidateIds: ["some-other-game"], settleUntil: at(40) }), [g], opts(at(95)));
    expect(d.kind).toBe("settling");
    if (d.kind === "settling") expect(d.settleUntil.getTime()).toBe(at(95 + 60).getTime());
  });

  it("is a pure function: identical inputs always give identical decisions", () => {
    const g = game();
    const c = challenge({ priorCandidateIds: [g.id], settleUntil: at(90) });
    expect(evaluateChallenge(c, [g], opts(at(95)))).toEqual(evaluateChallenge(c, [g], opts(at(95))));
  });

  it("copes with a delayed archive: no game early, then the game appears and goes through the window", () => {
    const g = game({ endedAt: at(25) });
    expect(evaluateChallenge(challenge(), [], opts(at(40))).kind).toBe("no_game");
    expect(evaluateChallenge(challenge({ checkCount: 1 }), [], opts(at(55))).kind).toBe("no_game");
    const seen = evaluateChallenge(challenge({ checkCount: 2 }), [g], opts(at(80)));
    expect(seen.kind).toBe("settling");
    const done = evaluateChallenge(
      challenge({ checkCount: 3, priorCandidateIds: [g.id], settleUntil: seen.kind === "settling" ? seen.settleUntil : null }),
      [g],
      opts(at(80 + 61)),
    );
    expect(done.kind).toBe("verified");
  });
});
