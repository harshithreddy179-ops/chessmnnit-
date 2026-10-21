import { describe, expect, it } from "vitest";
import { aggregatePresence, applyGrace, displayStatus, type PresenceState } from "@/lib/presence";
import { chartGeometry, hasEnoughHistory } from "@/lib/rating-history";
import { formatPercent, formatRelative, initials } from "@/lib/utils";

describe("presence aggregation", () => {
  it("treats a user as online while any tab is connected", () => {
    const state: PresenceState = {
      u1: [{ status: "busy" }],
      u2: [],
      u3: [{ status: "available" }, { status: "available" }],
    };
    const agg = aggregatePresence(state);
    expect([...agg.keys()].sort()).toEqual(["u1", "u3"]);
  });

  it("handles multiple tabs and devices: available wins over busy", () => {
    const agg = aggregatePresence({
      u1: [
        { status: "busy", tab_id: "a" },
        { status: "available", tab_id: "b" },
      ],
    });
    expect(agg.get("u1")).toBe("available");
    expect(aggregatePresence({ u1: [{ status: "busy" }, { status: "busy" }] }).get("u1")).toBe(
      "busy",
    );
  });

  it("goes offline only when the last tab closes", () => {
    const withTwo = aggregatePresence({ u1: [{ status: "available" }, { status: "available" }] });
    expect(withTwo.has("u1")).toBe(true);
    const withOne = aggregatePresence({ u1: [{ status: "available" }] });
    expect(withOne.has("u1")).toBe(true);
    expect(aggregatePresence({}).has("u1")).toBe(false);
  });

  it("ignores malformed entries", () => {
    expect(aggregatePresence({ u1: null as never, u2: "x" as never }).size).toBe(0);
  });
});

describe("reconnect grace", () => {
  const t0 = 1_000_000;
  it("keeps a user visible through a brief disconnect, then drops them", () => {
    const online = applyGrace(new Map(), new Map([["u1", "available" as const]]), t0, 8000);
    // network blip: u1 missing from the next sync
    const blip = applyGrace(online, new Map(), t0 + 3000, 8000);
    expect(blip.get("u1")).toMatchObject({ status: "available" });
    // still gone after the grace period
    const gone = applyGrace(blip, new Map(), t0 + 9000, 8000);
    expect(gone.has("u1")).toBe(false);
  });

  it("refreshes the timer when the user comes back, so a flaky connection never sticks offline", () => {
    let known = applyGrace(new Map(), new Map([["u1", "busy" as const]]), t0, 8000);
    known = applyGrace(known, new Map(), t0 + 5000, 8000); // dropped
    known = applyGrace(known, new Map([["u1", "available" as const]]), t0 + 6000, 8000); // reconnected
    known = applyGrace(known, new Map(), t0 + 12_000, 8000); // dropped again, 6s after last seen
    expect(known.get("u1")).toMatchObject({ status: "available", lastSeen: t0 + 6000 });
  });

  it("does not resurrect users forever", () => {
    let known = applyGrace(new Map(), new Map([["u1", "available" as const]]), t0, 8000);
    for (let i = 1; i <= 5; i++) known = applyGrace(known, new Map(), t0 + i * 10_000, 8000);
    expect(known.size).toBe(0);
  });
});

describe("displayStatus", () => {
  const tracked = new Map([["u1", { status: "busy" as const, lastSeen: 1 }]]);
  it("reports offline only when connected; otherwise the honest answer is unknown", () => {
    expect(displayStatus(tracked, "u1", "connected")).toBe("busy");
    expect(displayStatus(tracked, "u2", "connected")).toBe("offline");
    expect(displayStatus(tracked, "u2", "connecting")).toBe("unknown");
    expect(displayStatus(tracked, "u2", "unavailable")).toBe("unknown");
  });
});

describe("rating history", () => {
  const pt = (t: string, rating: number) => ({ t, rating });
  it("needs three points over two different days before charting", () => {
    expect(hasEnoughHistory([])).toBe(false);
    expect(
      hasEnoughHistory([pt("2026-10-01T10:00:00Z", 1500), pt("2026-10-02T10:00:00Z", 1510)]),
    ).toBe(false);
    expect(
      hasEnoughHistory([
        pt("2026-10-01T10:00:00Z", 1500),
        pt("2026-10-01T11:00:00Z", 1505),
        pt("2026-10-01T12:00:00Z", 1510),
      ]),
    ).toBe(false);
    expect(
      hasEnoughHistory([
        pt("2026-10-01T10:00:00Z", 1500),
        pt("2026-10-01T11:00:00Z", 1505),
        pt("2026-10-03T12:00:00Z", 1510),
      ]),
    ).toBe(true);
  });

  it("maps points into the viewBox in time order and never collapses a flat series", () => {
    const g = chartGeometry(
      [
        pt("2026-10-03T00:00:00Z", 1520),
        pt("2026-10-01T00:00:00Z", 1500),
        pt("2026-10-02T00:00:00Z", 1500),
      ],
      300,
      100,
    );
    expect(g.dots.map((d) => d.rating)).toEqual([1500, 1500, 1520]);
    expect(g.dots[0]!.x).toBeLessThan(g.dots[2]!.x);
    expect(g.dots.every((d) => d.x >= 0 && d.x <= 300 && d.y >= 0 && d.y <= 100)).toBe(true);
    const flat = chartGeometry(
      [
        pt("2026-10-01T00:00:00Z", 1500),
        pt("2026-10-02T00:00:00Z", 1500),
        pt("2026-10-03T00:00:00Z", 1500),
      ],
      300,
      100,
    );
    expect(flat.max - flat.min).toBeGreaterThan(0);
    expect(Number.isFinite(flat.dots[0]!.y)).toBe(true);
  });
});

describe("formatting helpers", () => {
  it("formats relative times and percentages", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    expect(formatRelative("2026-10-21T11:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-10-21T11:30:00Z", now)).toBe("30 minutes ago");
    expect(formatRelative("2026-10-19T12:00:00Z", now)).toBe("2 days ago");
    expect(formatRelative(null, now)).toBe("never");
    expect(formatPercent(0.756, 1)).toBe("75.6%");
    expect(formatPercent(null)).toBe("—");
  });
  it("derives initials safely", () => {
    expect(initials("Asha Verma")).toBe("AV");
    expect(initials("  single ")).toBe("SI");
    expect(initials("")).toBe("?");
    expect(initials(null)).toBe("?");
  });
});
