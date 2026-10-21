import type { TestDb } from "../db/helpers";

/**
 * Minimal stand-in for `supabase.rpc(name, args)` backed by PostgreSQL (service_role),
 * using named-argument notation so it works for any function in the public schema.
 */
export function createPgRpc(db: TestDb) {
  return {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      const entries = Object.entries(args).filter(([, v]) => v !== undefined);
      const params = entries.map(([, v]) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v));
      const placeholders = entries.map(([k, v], i) => (v !== null && typeof v === "object" ? `${k} => $${i + 1}::jsonb` : `${k} => $${i + 1}`));
      try {
        // `select * from fn(...)` expands table-returning functions into rows (as PostgREST does)
        // while scalar / jsonb functions come back as a single column named after the function.
        const res = await db.service.query(`select * from public.${name}(${placeholders.join(", ")})`, params);
        const scalar = res.fields.length === 1 && res.fields[0]!.name === name;
        return { data: scalar ? (res.rows[0]?.[name] ?? null) : res.rows, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    },
  };
}
