import { describe, expect, it } from "vitest";
import { adminActionSchema, profileUpdateSchema } from "@/lib/schemas";

describe("adminActionSchema: add_eligibility", () => {
  const parse = (values: string[], kind: "email" | "domain" = "email") =>
    adminActionSchema.safeParse({ action: "add_eligibility", kind, values });

  it("normalises case and whitespace", () => {
    const r = parse(["  Student@MNNIT.ac.in "]);
    expect(r.success && r.data.action === "add_eligibility" && r.data.values).toEqual([
      "student@mnnit.ac.in",
    ]);
  });

  it("names every malformed entry by its position, so the whole batch can be fixed in one go", () => {
    const r = parse(["ok@mnnit.ac.in", "not-an-email", "also bad@x", "fine@mnnit.ac.in"]);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      ["values.1", "“not-an-email” is not a valid email address"],
      ["values.2", "“also bad@x” is not a valid email address"],
    ]);
  });

  it("validates domains with the same shape the database enforces", () => {
    expect(parse(["mnnit.ac.in"], "domain").success).toBe(true);
    expect(parse(["localhost"], "domain").success).toBe(false);
    expect(parse(["someone@mnnit.ac.in"], "domain").success).toBe(false);
  });

  it("rejects empty and oversized batches", () => {
    expect(parse([]).success).toBe(false);
    expect(parse(Array.from({ length: 1001 }, (_, i) => `s${i}@mnnit.ac.in`)).success).toBe(false);
  });
});

describe("profileUpdateSchema", () => {
  it("accepts a partial update and strips control characters", () => {
    const r = profileUpdateSchema.safeParse({
      display_name: "  Mia\u0007 Strategist ",
      open_to_challenges: false,
    });
    expect(r.success && r.data).toMatchObject({
      display_name: "Mia Strategist",
      open_to_challenges: false,
    });
  });

  it("rejects unknown time classes and too-short names", () => {
    expect(
      profileUpdateSchema.safeParse({ preferred_time_classes: ["{", "}", "blitz"] }).success,
    ).toBe(false);
    expect(profileUpdateSchema.safeParse({ display_name: "M" }).success).toBe(false);
  });
});
