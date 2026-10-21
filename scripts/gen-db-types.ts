/**
 * Generates src/lib/database.types.ts from a migrated PostgreSQL database, in the same
 * shape `supabase gen types typescript` produces (so supabase-js infers every query).
 *
 *   LOCAL_DATABASE_URL=postgres://… npm run db:types
 *   npm run db:types:check          # fails if the committed file is stale (used in CI)
 *
 * With the Supabase CLI you can use `supabase gen types typescript --local` instead; this
 * script exists so types can be produced from any plain PostgreSQL that has the migrations.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";

const OUT = "src/lib/database.types.ts";
const url = process.env.LOCAL_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/mnnit_dev";
const check = process.argv.includes("--check");

interface PgType {
  typname: string;
  typtype: string;
  typcategory: string;
  typelem: number;
}

const SCALARS: Record<string, string> = {
  text: "string", varchar: "string", bpchar: "string", citext: "string", uuid: "string", name: "string",
  int2: "number", int4: "number", int8: "number", numeric: "number", float4: "number", float8: "number", oid: "number",
  bool: "boolean", json: "Json", jsonb: "Json", bytea: "string",
  timestamptz: "string", timestamp: "string", date: "string", time: "string", timetz: "string", interval: "string",
};

async function main() {
  const db = new Client({ connectionString: url });
  await db.connect();

  const types = new Map<number, PgType>();
  for (const r of (await db.query("select oid::int as oid, typname, typtype, typcategory, typelem::int as typelem from pg_type")).rows) {
    types.set(r.oid, r);
  }
  const enums = new Map<string, string[]>();
  for (const r of (
    await db.query(
      `select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' order by t.typname, e.enumsortorder`,
    )
  ).rows) {
    enums.set(r.typname, [...(enums.get(r.typname) ?? []), r.enumlabel]);
  }

  const tsType = (oid: number): string => {
    const t = types.get(oid);
    if (!t) return "unknown";
    if (t.typcategory === "A") return `${tsType(t.typelem)}[]`;
    if (t.typtype === "e") return `Database["public"]["Enums"]["${t.typname}"]`;
    if (t.typtype === "c") return `Database["public"]["Tables"]["${t.typname}"]["Row"]`;
    return SCALARS[t.typname] ?? "unknown";
  };

  // ---- tables
  const cols = (
    await db.query(
      `select c.relname, a.attname, a.atttypid::int as typid, a.attnotnull, a.atthasdef, a.attidentity, a.attgenerated
         from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
        order by c.relname, a.attnum`,
    )
  ).rows;
  const tables = new Map<string, typeof cols>();
  for (const c of cols) tables.set(c.relname, [...(tables.get(c.relname) ?? []), c]);

  const tableTs = [...tables.entries()].map(([name, columns]) => {
    const row = columns.map((c) => `          ${c.attname}: ${tsType(c.typid)}${c.attnotnull ? "" : " | null"}`).join("\n");
    const insert = columns
      .filter((c) => !c.attgenerated && c.attidentity !== "a")
      .map((c) => {
        const optional = !c.attnotnull || c.atthasdef || c.attidentity === "d";
        return `          ${c.attname}${optional ? "?" : ""}: ${tsType(c.typid)}${c.attnotnull ? "" : " | null"}`;
      })
      .join("\n");
    const update = columns
      .filter((c) => !c.attgenerated && c.attidentity !== "a")
      .map((c) => `          ${c.attname}?: ${tsType(c.typid)}${c.attnotnull ? "" : " | null"}`)
      .join("\n");
    return `      ${name}: {\n        Row: {\n${row}\n        }\n        Insert: {\n${insert}\n        }\n        Update: {\n${update}\n        }\n        Relationships: []\n      }`;
  });

  // ---- functions
  const fns = (
    await db.query(
      `select p.proname, p.pronargdefaults, p.prorettype::int as rettype, p.proretset, p.proargnames,
              p.proargtypes::oid[]::int[] as intypes, p.proallargtypes::oid[]::int[] as alltypes, p.proargmodes::text[] as modes
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
        order by p.proname, p.oid`,
    )
  ).rows;

  const fnTs: string[] = [];
  const seen = new Set<string>();
  for (const f of fns) {
    if (seen.has(f.proname)) continue; // overloads are not used by this project
    seen.add(f.proname);
    const names: string[] = f.proargnames ?? [];
    const modes: string[] | null = f.modes;
    const all: number[] = f.alltypes ?? f.intypes;
    const inputs: { name: string; type: number }[] = [];
    const outs: { name: string; type: number }[] = [];
    all.forEach((typ, i) => {
      const mode = modes?.[i] ?? "i";
      const name = names[i] || `arg${i + 1}`;
      if (mode === "i" || mode === "b" || mode === "v") inputs.push({ name, type: typ });
      else if (mode === "t" || mode === "o") outs.push({ name, type: typ });
    });
    const firstDefault = inputs.length - f.pronargdefaults;
    const args = inputs.length
      ? `{ ${inputs.map((a, i) => `${a.name}${i >= firstDefault ? "?" : ""}: ${tsType(a.type)}`).join("; ")} }`
      : "never";
    let returns: string;
    if (outs.length) {
      returns = `{ ${outs.map((o) => `${o.name}: ${tsType(o.type)}`).join("; ")} }[]`;
    } else if (types.get(f.rettype)?.typname === "void") {
      returns = "undefined";
    } else {
      const base = tsType(f.rettype);
      returns = f.proretset ? `${base}[]` : base;
    }
    fnTs.push(`      ${f.proname}: {\n        Args: ${args}\n        Returns: ${returns}\n      }`);
  }

  const enumTs = [...enums.entries()].map(
    ([name, labels]) => `      ${name}: ${labels.map((l) => JSON.stringify(l)).join(" | ")}`,
  );
  const enumConst = [...enums.entries()].map(
    ([name, labels]) => `    ${name}: [${labels.map((l) => JSON.stringify(l)).join(", ")}],`,
  );

  const out = `/* eslint-disable */
// GENERATED FILE — do not edit. Regenerate with \`npm run db:types\` after changing a migration.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
${tableTs.join("\n")}
    }
    Views: { [_ in never]: never }
    Functions: {
${fnTs.join("\n")}
    }
    Enums: {
${enumTs.join("\n")}
    }
    CompositeTypes: { [_ in never]: never }
  }
}

export const Constants = {
  public: {
    Enums: {
${enumConst.join("\n")}
    },
  },
} as const
`;

  await db.end();
  if (check) {
    const current = readFileSync(OUT, "utf8");
    if (current !== out) {
      console.error(`${OUT} is out of date. Run \`npm run db:types\`.`);
      process.exit(1);
    }
    console.log(`${OUT} is up to date.`);
    return;
  }
  writeFileSync(OUT, out);
  console.log(`Wrote ${OUT} (${tables.size} tables, ${seen.size} functions, ${enums.size} enums).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
