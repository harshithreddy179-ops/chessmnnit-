import { describe, expect, it } from "vitest";
import { ChessComError } from "@/lib/chess/client";
import { checkProfileCode, profileContainsCode } from "@/lib/chess/verification/profile-code";
import { describeProviders } from "@/lib/chess/verification/providers";

const CODE = "MNNIT-K7Q2M9XA";
const client = (impl: () => Promise<unknown>) => ({ getProfile: impl }) as never;

describe("profile code verification", () => {
  it("verifies when the code is in the Location field, case- and spacing-tolerant", async () => {
    const r = await checkProfileCode(
      client(async () => ({
        username: "Alice_S",
        player_id: 99,
        location: `Prayagraj ${CODE.toLowerCase()} `,
      })),
      { username: "alice_s", code: CODE },
    );
    expect(r).toEqual({ verified: true, username: "alice_s", playerId: 99 });
  });

  it("also accepts the code in the Name field", async () => {
    const r = await checkProfileCode(
      client(async () => ({ username: "alice_s", name: `Alice ${CODE}` })),
      { username: "alice_s", code: CODE },
    );
    expect(r).toMatchObject({ verified: true, playerId: null });
  });

  it("does not verify when the code is absent, different, or the profile has no editable text", async () => {
    for (const profile of [
      { username: "alice_s" },
      { username: "alice_s", location: "Prayagraj" },
      { username: "alice_s", location: "MNNIT-AAAAAAAA" },
      { username: "alice_s", name: "Alice" },
    ]) {
      expect(
        await checkProfileCode(
          client(async () => profile),
          { username: "alice_s", code: CODE },
        ),
      ).toMatchObject({ verified: false, reason: "code_not_found" });
    }
  });

  it("refuses to verify when the API returns a different account than the one claimed", async () => {
    const r = await checkProfileCode(
      client(async () => ({ username: "someone_else", location: CODE })),
      { username: "alice_s", code: CODE },
    );
    expect(r).toMatchObject({ verified: false, reason: "username_mismatch" });
  });

  it("refuses closed accounts", async () => {
    for (const status of ["closed", "closed:fair_play_violations"]) {
      const r = await checkProfileCode(
        client(async () => ({ username: "alice_s", location: CODE, status })),
        { username: "alice_s", code: CODE },
      );
      expect(r).toMatchObject({ verified: false, reason: "account_closed" });
    }
  });

  it("never verifies because of an upstream failure", async () => {
    const cases: [ChessComError, string][] = [
      [new ChessComError("not_found", "x", 404), "profile_not_found"],
      [new ChessComError("gone", "x", 410), "profile_not_found"],
      [new ChessComError("moved", "x", 301), "renamed"],
      [new ChessComError("rate_limited", "x", 429), "rate_limited"],
      [new ChessComError("timeout", "x"), "unavailable"],
      [new ChessComError("invalid_response", "x"), "unavailable"],
    ];
    for (const [error, reason] of cases) {
      const r = await checkProfileCode(
        client(async () => {
          throw error;
        }),
        { username: "alice_s", code: CODE },
      );
      expect(r).toMatchObject({ verified: false, reason });
    }
    expect(
      await checkProfileCode(
        client(async () => {
          throw new Error("boom");
        }),
        { username: "alice_s", code: CODE },
      ),
    ).toMatchObject({ verified: false, reason: "unavailable" });
  });

  it("will not match on trivially short or empty codes", () => {
    expect(profileContainsCode({ location: "abc" }, "abc")).toBe(false);
    expect(profileContainsCode({ location: "anything" }, "")).toBe(false);
  });

  it("cannot be satisfied by a code the profile merely resembles", () => {
    expect(profileContainsCode({ location: "MNNIT K7Q2M9XA" }, CODE)).toBe(false);
    expect(profileContainsCode({ location: "MNNIT-K7Q2M9X" }, CODE)).toBe(false);
  });
});

describe("provider status (honest about what works)", () => {
  it("reports OAuth as awaiting approval and never as available", () => {
    for (const oauthCredentialsPresent of [false, true]) {
      const oauth = describeProviders({ profileCodeEnabled: true, oauthCredentialsPresent }).find(
        (p) => p.id === "oauth",
      )!;
      expect(oauth.state).toBe("awaiting_approval");
    }
  });

  it("explains an adapter gap when credentials exist but no adapter does", () => {
    const oauth = describeProviders({
      profileCodeEnabled: true,
      oauthCredentialsPresent: true,
    }).find((p) => p.id === "oauth")!;
    expect(oauth.description).toMatch(/not been implemented/i);
  });

  it("reflects configuration for the profile-code route and always offers administrator review", () => {
    const off = describeProviders({ profileCodeEnabled: false, oauthCredentialsPresent: false });
    expect(off.find((p) => p.id === "profile_code")!.state).toBe("unavailable");
    expect(off.find((p) => p.id === "admin_review")!.state).toBe("available");
  });
});
