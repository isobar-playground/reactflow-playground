// Server-only repo over the `approved_models` table (ADR-0006: DB access never
// leaves the server). Approval is the only Model state the app owns — the
// catalog itself is read live from FAL (`lib/fal-models.ts`) and joined against
// this set of approved `endpoint_id`s for display. Shared, with no per-user
// scoping (like the Asset Library, CONTEXT.md).
import { getDb } from "./db";

interface ApprovedModelRow {
  endpoint_id: string;
}

/** All approved endpoint ids (shared across everyone). */
export async function listApprovedEndpointIds(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.query<ApprovedModelRow>(
    "select endpoint_id from approved_models",
  );
  return rows.map((row) => row.endpoint_id);
}

/** Mark a Model as an Approved Model. Idempotent via the primary key. */
export async function approveModel(endpointId: string): Promise<void> {
  const db = await getDb();
  await db.query(
    "insert into approved_models (endpoint_id) values ($1) on conflict (endpoint_id) do nothing",
    [endpointId],
  );
}

/** Withdraw a Model's approval. A no-op if it wasn't approved. */
export async function unapproveModel(endpointId: string): Promise<void> {
  const db = await getDb();
  await db.query("delete from approved_models where endpoint_id = $1", [endpointId]);
}
