// Server-only repo over the `model_edit_pairs` table (ADR-0006: DB access
// never leaves the server; ADR-0014: the Edit Model comes from an app-owned
// pairing, not a per-node choice). Alongside approved_models
// (lib/model-approvals.ts), this is the only other Model state the app owns
// (CONTEXT.md's Approved Model). Shared, with no per-user scoping.
import { getDb } from "./db";

interface EditPairRow {
  base_endpoint_id: string;
  edit_endpoint_id: string;
}

/** Every pairing, keyed by base endpoint id (shared across everyone). */
export async function listEditPairs(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.query<EditPairRow>(
    "select base_endpoint_id, edit_endpoint_id from model_edit_pairs",
  );
  return Object.fromEntries(rows.map((row) => [row.base_endpoint_id, row.edit_endpoint_id]));
}

/** Pairs (or re-pairs) a base Model with its Edit Model. */
export async function setEditPair(baseEndpointId: string, editEndpointId: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into model_edit_pairs (base_endpoint_id, edit_endpoint_id)
     values ($1, $2)
     on conflict (base_endpoint_id) do update set edit_endpoint_id = excluded.edit_endpoint_id`,
    [baseEndpointId, editEndpointId],
  );
}

/** Clears a base Model's pairing. A no-op if it wasn't paired. */
export async function clearEditPair(baseEndpointId: string): Promise<void> {
  const db = await getDb();
  await db.query("delete from model_edit_pairs where base_endpoint_id = $1", [baseEndpointId]);
}
