// One tiny query surface over two backends:
//   - DATABASE_URL set  -> Neon serverless Postgres (prod, per ADR-0001)
//   - otherwise         -> local PGlite (Postgres-in-a-file) so it runs with zero provisioning
// Both speak real Postgres, so SQL written here behaves the same locally and on Neon.

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

// One `create table` per statement: `Db.query` runs a single prepared command
// (both Neon and PGlite reject multiple commands in one call), so migrate()
// applies them in turn.
const SCHEMA = [
  `create table if not exists canvases (
    id         uuid        primary key default gen_random_uuid(),
    name       text        not null    default 'Untitled',
    graph      jsonb       not null    default '{}'::jsonb,
    updated_at timestamptz not null    default now()
  )`,
  `create table if not exists approved_models (
    endpoint_id text        primary key,
    approved_at timestamptz not null    default now()
  )`,
  // Edit Model pairing (CONTEXT.md's Edit Model, ADR-0014, PRD #69): the
  // app-owned mapping from a text-to-image base Model to the image-to-image
  // Model that runs its Edits, curated in the Models tab. Many bases may map
  // to one Edit Model, so edit_endpoint_id carries no uniqueness constraint.
  `create table if not exists model_edit_pairs (
    base_endpoint_id text primary key,
    edit_endpoint_id text not null
  )`,
];

export async function migrate(db: Db): Promise<void> {
  for (const statement of SCHEMA) {
    await db.query(statement);
  }
}

let cached: Db | undefined;

export async function getDb(): Promise<Db> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  const db = url ? await neonDb(url) : await localDb();
  await migrate(db);
  cached = db;
  return cached;
}

/** Test hook: drop the memoised connection so a test can pick a different backend. */
export function resetDbForTests(): void {
  cached = undefined;
}

async function neonDb(url: string): Promise<Db> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  return {
    query: (text, params) =>
      sql.query(text, params) as unknown as Promise<never[]>,
  };
}

async function localDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  // Default to a gitignored data dir; "memory://" gives an ephemeral DB (used by tests).
  const pg = new PGlite(process.env.PGLITE_DIR ?? "./.pgdata");
  return {
    query: async (text, params) => (await pg.query(text, params)).rows as never,
  };
}
