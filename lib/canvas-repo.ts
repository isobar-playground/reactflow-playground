// Server-only CRUD over the `canvases` table (ADR-0001: DB access never leaves the server).
import { getDb } from "./db";

export interface Canvas {
  id: string;
  name: string;
  graph: Record<string, unknown>;
  updatedAt: string;
}

interface CanvasRow {
  id: string;
  name: string;
  graph: unknown;
  updated_at: string;
}

function fromRow(row: CanvasRow): Canvas {
  return {
    id: row.id,
    name: row.name,
    graph: (row.graph ?? {}) as Record<string, unknown>,
    updatedAt: row.updated_at,
  };
}

export async function createCanvas(): Promise<Canvas> {
  const db = await getDb();
  const rows = await db.query<CanvasRow>(
    "insert into canvases default values returning id, name, graph, updated_at",
  );
  return fromRow(rows[0]);
}

export async function listCanvases(): Promise<Canvas[]> {
  const db = await getDb();
  const rows = await db.query<CanvasRow>(
    "select id, name, graph, updated_at from canvases order by updated_at desc",
  );
  return rows.map(fromRow);
}

export async function getCanvas(id: string): Promise<Canvas | undefined> {
  const db = await getDb();
  const rows = await db.query<CanvasRow>(
    "select id, name, graph, updated_at from canvases where id = $1",
    [id],
  );
  return rows[0] ? fromRow(rows[0]) : undefined;
}

export async function renameCanvas(id: string, name: string): Promise<Canvas | undefined> {
  const db = await getDb();
  const rows = await db.query<CanvasRow>(
    "update canvases set name = $2, updated_at = now() where id = $1 returning id, name, graph, updated_at",
    [id, name],
  );
  return rows[0] ? fromRow(rows[0]) : undefined;
}

export async function deleteCanvas(id: string): Promise<void> {
  const db = await getDb();
  await db.query("delete from canvases where id = $1", [id]);
}
