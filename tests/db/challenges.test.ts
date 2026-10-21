import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqlError, type Player, type TestDb } from "./helpers";

let db: TestDb;
let alice: Player;
let bob: Player;
let carol: Player;

beforeAll(async () => {
  db = await createTestDb();
  alice = await db.onboard({ username: "alice_ch", name: "Alice" });
  bob = await db.onboard({ username: "bob_ch", name: "Bob" });
  carol = await db.onboard({ username: "carol_ch", name: "Carol" });
});
afterAll(async () => {
  await db.close();
});

/** Clears all challenge-related state so each test starts from a clean slate. */
async function reset() {
  await db.admin.query("delete from public.college_matches");
  await db.admin.query("delete from public.challenges");
  await db.admin.query("delete from public.notifications");
  await db.admin.query("delete from app_private.rate_limit_buckets");
  await db.admin.query("update public.profiles set open_to_challenges = true");
  await db.admin.query("update public.app_settings set value = '5'::jsonb where key = 'challenge_max_pending_outgoing'");
  await db.admin.query("update public.app_settings set value = '10'::jsonb where key = 'challenge_rate_per_hour'");
}

/**
 * Arranges time-dependent state. Challenge terms (including expires_at) are immutable even
 * to trusted roles, so the guard trigger is disabled just for this superuser statement.
 */
async function backdate(id: string, setClause: string) {
  const c = await db.admin.connect();
  try {
    await c.query("begin");
    await c.query("alter table public.challenges disable trigger challenges_before_update");
    await c.query(`update public.challenges set ${setClause} where id = $1`, [id]);
    await c.query("alter table public.challenges enable trigger challenges_before_update");
    await c.query("commit");
  } catch (error) {
    await c.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    c.release();
  }
}

async function create(from: Player, to: Player, tc = "600", message: string | null = null) {
  const r = await db.as(from.id).query(
    "insert into public.challenges (recipient_id, time_control, message) values ($1, $2, $3) returning *",
    [to.id, tc, message],
  );
  return r.rows[0] as {
    id: string; status: string; challenger_id: string; recipient_id: string; challenger_username: string;
    recipient_username: string; time_class: string; expires_at: Date; accepted_at: Date | null; next_check_at: Date | null;
    giveup_at: Date | null; message: string | null;
  };
}

const setStatus = (who: Player, id: string, status: string) =>
  db.as(who.id).query("update public.challenges set status = $1 where id = $2 returning *", [status, id]);

describe("creating challenges", () => {
  it("creates a pending challenge with server-populated fields and notifies the recipient", async () => {
    await reset();
    const c = await create(alice, bob, "600", "  Rapid game after class?  ");
    expect(c).toMatchObject({
      status: "pending", challenger_id: alice.id, recipient_id: bob.id,
      challenger_username: "alice_ch", recipient_username: "bob_ch", time_class: "rapid", message: "Rapid game after class?",
    });
    expect(c.expires_at.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000);

    const note = await db.as(bob.id).query("select type, title, data from public.notifications where type = 'challenge_received'");
    expect(note.rows.at(-1)).toMatchObject({ type: "challenge_received" });
    expect(note.rows.at(-1).data.challenge_id).toBe(c.id);
    const events = await db.as(alice.id).query("select to_status, actor_id from public.challenge_events where challenge_id = $1", [c.id]);
    expect(events.rows).toEqual([{ to_status: "pending", actor_id: alice.id }]);
  });

  it("derives the time class from the supported control", async () => {
    await reset();
    expect((await create(alice, bob, "180+2")).time_class).toBe("blitz");
    await reset();
    expect((await create(alice, bob, "1/86400")).time_class).toBe("daily");
  });

  it("does not let a client choose server-controlled columns", async () => {
    await reset();
    for (const sql of [
      "insert into public.challenges (recipient_id, time_control, status) values ($1, '600', 'accepted')",
      "insert into public.challenges (recipient_id, time_control, challenger_id) values ($1, '600', $2)",
      "insert into public.challenges (recipient_id, time_control, challenger_username) values ($1, '600', 'forged')",
      "insert into public.challenges (recipient_id, time_control, expires_at) values ($1, '600', now() + interval '99 days')",
    ]) {
      const err = await sqlError(db.as(alice.id).query(sql, sql.includes("$2") ? [bob.id, carol.id] : [bob.id]));
      expect(err.code, sql).toBe("42501");
    }
  });

  it("cannot be created on behalf of another user", async () => {
    await reset();
    // challenger_id defaults to auth.uid() and cannot be supplied, so a forged id has no path in.
    const c = await create(alice, bob);
    expect(c.challenger_id).toBe(alice.id);
  });

  it("rejects self-challenges, unapproved players and unsupported controls", async () => {
    await reset();
    expect((await sqlError(db.as(alice.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '600')", [alice.id]))).message).toMatch(/self_challenge/);

    const ghost = await db.createUser();
    expect((await sqlError(db.as(alice.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '600')", [ghost.id]))).message).toMatch(/recipient_unavailable/);
    expect((await sqlError(db.as(ghost.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '600')", [alice.id]))).message).toMatch(/challenger_not_approved/);
    expect((await sqlError(db.as(alice.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '45')", [bob.id]))).message).toMatch(/unsupported_time_control/);
  });

  it("respects a recipient who is not accepting challenges", async () => {
    await reset();
    await db.admin.query("update public.profiles set open_to_challenges = false where id = $1", [bob.id]);
    expect((await sqlError(db.as(alice.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '600')", [bob.id]))).message).toMatch(/recipient_closed/);
  });

  it("allows only one active challenge per pair, in either direction", async () => {
    await reset();
    await create(alice, bob);
    expect((await sqlError(db.as(alice.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '300')", [bob.id]))).message).toMatch(/active_challenge_exists/);
    expect((await sqlError(db.as(bob.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '300')", [alice.id]))).message).toMatch(/active_challenge_exists/);
  });

  it("holds the one-active-per-pair rule under concurrent creation (unique index backstop)", async () => {
    await reset();
    const results = await Promise.allSettled([
      db.as(alice.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '600')", [bob.id]),
      db.as(bob.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '600')", [alice.id]),
      db.as(alice.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '300')", [bob.id]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const n = await db.admin.query("select count(*)::int as n from public.challenges where status = 'pending'");
    expect(n.rows[0].n).toBe(1);
  });

  it("lets players challenge again after a terminal outcome", async () => {
    await reset();
    const c = await create(alice, bob);
    await setStatus(bob, c.id, "declined");
    expect((await create(alice, bob)).status).toBe("pending");
  });

  it("caps simultaneously pending outgoing challenges", async () => {
    await reset();
    await db.admin.query("update public.app_settings set value = '1'::jsonb where key = 'challenge_max_pending_outgoing'");
    await create(alice, bob);
    expect((await sqlError(db.as(alice.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '600')", [carol.id]))).message).toMatch(/too_many_pending/);
  });

  it("rate limits challenge creation per hour", async () => {
    await reset();
    await db.admin.query("update public.app_settings set value = '2'::jsonb where key = 'challenge_rate_per_hour'");
    for (let i = 0; i < 2; i++) {
      const c = await create(alice, bob);
      await setStatus(alice, c.id, "cancelled");
    }
    const err = await sqlError(db.as(alice.id).query("insert into public.challenges (recipient_id, time_control) values ($1, '600')", [bob.id]));
    expect(err.message).toMatch(/rate_limited/);
    expect(err.code).toBe("53400");
  });
});

describe("responding to challenges", () => {
  it("lets only the recipient accept, which starts result tracking", async () => {
    await reset();
    const c = await create(alice, bob);
    const before = Date.now();
    const accepted = (await setStatus(bob, c.id, "accepted")).rows[0];
    expect(accepted.status).toBe("accepted");
    expect(new Date(accepted.accepted_at).getTime()).toBeGreaterThanOrEqual(before - 2000);
    expect(new Date(accepted.next_check_at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(accepted.giveup_at).getTime()).toBeGreaterThan(Date.now() + 71 * 3600_000);
    expect(accepted.status_changed_by).toBe(bob.id);

    const note = await db.as(alice.id).query("select title from public.notifications where type = 'challenge_accepted'");
    expect(note.rowCount).toBe(1);
  });

  it("refuses acceptance by the challenger or by a third party", async () => {
    await reset();
    const c = await create(alice, bob);
    expect((await sqlError(setStatus(alice, c.id, "accepted"))).code).toBe("42501");
    // Carol cannot even see the row, so her update touches nothing.
    expect((await setStatus(carol, c.id, "accepted")).rowCount).toBe(0);
    expect((await db.admin.query("select status from public.challenges where id = $1", [c.id])).rows[0].status).toBe("pending");
  });

  it("refuses declining by the challenger and cancelling by the recipient", async () => {
    await reset();
    const c = await create(alice, bob);
    expect((await sqlError(setStatus(alice, c.id, "declined"))).code).toBe("42501");
    expect((await sqlError(setStatus(bob, c.id, "cancelled"))).code).toBe("42501");
    await setStatus(alice, c.id, "cancelled");
    const row = (await db.admin.query("select status, closed_at, status_changed_by from public.challenges where id = $1", [c.id])).rows[0];
    expect(row).toMatchObject({ status: "cancelled", status_changed_by: alice.id });
    expect(row.closed_at).not.toBeNull();
    expect((await db.as(bob.id).query("select type from public.notifications where type = 'challenge_cancelled'")).rowCount).toBe(1);
  });

  it("allows the recipient to decline and tells the challenger", async () => {
    await reset();
    const c = await create(alice, bob);
    await setStatus(bob, c.id, "declined");
    expect((await db.as(alice.id).query("select type from public.notifications where type = 'challenge_declined'")).rowCount).toBe(1);
  });

  it("forbids clients from jumping states", async () => {
    await reset();
    const c = await create(alice, bob);
    for (const [who, status] of [
      [bob, "result_verified"], [alice, "result_verified"], [bob, "waiting_for_game"], [alice, "expired"], [bob, "voided"], [alice, "needs_review"],
    ] as const) {
      expect((await sqlError(setStatus(who, c.id, status))).code, `${who.username} -> ${status}`).toBe("42501");
    }
    await setStatus(bob, c.id, "accepted");
    // Once accepted, the participants have no further moves: result tracking is server-side.
    for (const [who, status] of [[bob, "cancelled"], [alice, "cancelled"], [bob, "declined"], [alice, "result_verified"]] as const) {
      expect((await sqlError(setStatus(who, c.id, status))).code).toBe("42501");
    }
  });

  it("forbids rewriting challenge terms or participants", async () => {
    await reset();
    const c = await create(alice, bob);
    for (const col of ["recipient_id = $2", "time_control = '60'", "expires_at = now() + interval '30 days'", "next_check_at = now()", "candidate_game_ids = array[gen_random_uuid()]"]) {
      const err = await sqlError(db.as(bob.id).query(`update public.challenges set ${col} where id = $1`, [c.id, carol.id].slice(0, col.includes("$2") ? 2 : 1)));
      expect(err.code, col).toBe("42501");
    }
    // Even a status change cannot smuggle other columns through a client update.
    const hostile = await sqlError(
      db.as(bob.id).query("update public.challenges set status = 'accepted', accepted_at = now() - interval '5 days' where id = $1", [c.id]),
    );
    expect(hostile.code).toBe("42501");
  });

  it("will not accept an expired challenge", async () => {
    await reset();
    const c = await create(alice, bob);
    await backdate(c.id, "expires_at = now() - interval '1 minute'");
    expect((await sqlError(setStatus(bob, c.id, "accepted"))).message).toMatch(/challenge_expired/);
  });

  it("will not accept when a participant has since become ineligible", async () => {
    await reset();
    const c = await create(alice, bob);
    await db.admin.query("update public.profiles set account_status = 'suspended' where id = $1", [alice.id]);
    try {
      expect((await sqlError(setStatus(bob, c.id, "accepted"))).message).toMatch(/participant_unavailable/);
    } finally {
      await db.admin.query("update public.profiles set account_status = 'active' where id = $1", [alice.id]);
    }
  });

  it("hides other people's challenges", async () => {
    await reset();
    await create(alice, bob);
    expect((await db.as(carol.id).query("select * from public.challenges")).rowCount).toBe(0);
    expect((await db.as(carol.id).query("select * from public.challenge_events")).rowCount).toBe(0);
    expect((await db.as(bob.id).query("select * from public.challenges")).rowCount).toBe(1);
  });
});

describe("expiry and the result-sync worker interface", () => {
  it("expires stale pending challenges via the scheduled job only", async () => {
    await reset();
    const stale = await create(alice, bob);
    await backdate(stale.id, "expires_at = now() - interval '1 hour'");
    expect((await sqlError(db.as(alice.id).query("select public.expire_stale_challenges()"))).code).toBe("42501");
    const n = (await db.service.query("select public.expire_stale_challenges() as n")).rows[0].n;
    expect(n).toBe(1);
    expect((await db.admin.query("select status from public.challenges where id = $1", [stale.id])).rows[0].status).toBe("expired");
    for (const p of [alice, bob]) {
      expect((await db.as(p.id).query("select 1 from public.notifications where type = 'challenge_expired'")).rowCount).toBeGreaterThan(0);
    }
    // Running the job again changes nothing (idempotent).
    expect((await db.service.query("select public.expire_stale_challenges() as n")).rows[0].n).toBe(0);
  });

  it("leases due challenges so two workers never process the same one", async () => {
    await reset();
    const c = await create(alice, bob);
    await setStatus(bob, c.id, "accepted");
    await db.admin.query("update public.challenges set next_check_at = now() - interval '1 second' where id = $1", [c.id]);

    const first = await db.service.query("select * from public.claim_challenges_for_sync(10, 300)");
    expect(first.rows.map((r) => r.id)).toEqual([c.id]);
    expect(first.rows[0]).toMatchObject({ challenger_username: "alice_ch", recipient_username: "bob_ch", time_control: "600" });
    const second = await db.service.query("select * from public.claim_challenges_for_sync(10, 300)");
    expect(second.rowCount).toBe(0);
  });

  it("moves along the documented states and can never mark a result verified", async () => {
    await reset();
    const c = await create(alice, bob);
    await setStatus(bob, c.id, "accepted");
    await db.service.query("select public.record_challenge_check($1, 'no_game_found', 'waiting_for_game', now() + interval '10 minutes')", [c.id]);
    let row = (await db.admin.query("select status, check_count from public.challenges where id = $1", [c.id])).rows[0];
    expect(row).toMatchObject({ status: "waiting_for_game", check_count: 1 });

    await db.service.query("select public.record_challenge_check($1, 'candidate_found', 'checking_result', now() + interval '20 minutes', now() + interval '20 minutes')", [c.id]);
    row = (await db.admin.query("select status, check_count from public.challenges where id = $1", [c.id])).rows[0];
    expect(row).toMatchObject({ status: "checking_result", check_count: 2 });

    const err = await sqlError(db.service.query("select public.record_challenge_check($1, 'verified', 'result_verified')", [c.id]));
    expect(err.code).toBe("42501");

    await db.service.query("select public.record_challenge_check($1, 'ambiguous', 'needs_review', null, null, '{}', '{}', null, 'two candidate games')", [c.id]);
    row = (await db.admin.query("select status, next_check_at, review_reason from public.challenges where id = $1", [c.id])).rows[0];
    expect(row).toMatchObject({ status: "needs_review", next_check_at: null, review_reason: "two candidate games" });
    const attempts = await db.as(alice.id).query("select outcome from public.match_sync_attempts where challenge_id = $1 order by id", [c.id]);
    expect(attempts.rows.map((r) => r.outcome)).toEqual(["no_game_found", "candidate_found", "ambiguous"]);
  });

  it("does not let the worker overwrite a challenge a moderator already resolved", async () => {
    await reset();
    const c = await create(alice, bob);
    await setStatus(bob, c.id, "accepted");
    await db.admin.query("update public.challenges set status = 'voided' where id = $1", [c.id]);
    await db.service.query("select public.record_challenge_check($1, 'no_game_found', 'waiting_for_game', now())", [c.id]);
    expect((await db.admin.query("select status, check_count from public.challenges where id = $1", [c.id])).rows[0]).toMatchObject({ status: "voided", check_count: 0 });
  });

  it("hands in-flight challenges to a moderator when a participant is unlinked", async () => {
    await reset();
    const mod = await db.createUser();
    await db.makeAdmin(mod.id, "verification_admin");
    const dave = await db.onboard({ username: "dave_ch" });
    const pending = await create(dave, alice);
    const active = await create(bob, carol);
    await setStatus(carol, active.id, "accepted");

    await db.as(mod.id).query("select public.admin_unlink_chess_account($1, 'Chess.com account was closed')", [dave.id]);
    expect((await db.admin.query("select status from public.challenges where id = $1", [pending.id])).rows[0].status).toBe("cancelled");

    await db.as(mod.id).query("select public.admin_unlink_chess_account($1, 'identity dispute under review')", [carol.id]);
    const row = (await db.admin.query("select status, review_reason from public.challenges where id = $1", [active.id])).rows[0];
    expect(row).toMatchObject({ status: "needs_review", review_reason: "participant Chess.com link removed" });
  });
});

describe("realtime exposure", () => {
  it("publishes only notifications and challenges, which are protected by RLS", async () => {
    const r = await db.admin.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1");
    expect(r.rows.map((x) => x.tablename)).toEqual(["challenges", "notifications"]);
  });
});
