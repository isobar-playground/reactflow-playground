import type { Canvas } from "./canvas-repo";

export type DashboardCanvas = Pick<Canvas, "id" | "name" | "graph" | "updatedAt">;

export interface CanvasDashboardPreview {
  id: string;
  kind: "image" | "video";
  url: string;
  generatedAt: string;
}

export interface CanvasDashboardItem {
  id: string;
  name: string;
  latestGeneratedAt: string;
  outputCount: number;
  totalActualCost?: number;
  previews: CanvasDashboardPreview[];
}

interface HistoryEntryLike {
  id?: unknown;
  output?: {
    kind?: unknown;
    url?: unknown;
  };
  createdAt?: unknown;
  actualCost?: unknown;
}

interface GeneratedOutput {
  id: string;
  kind: "image" | "video";
  url: string;
  generatedAt: string;
  sortTime: number;
  actualCost?: number;
}

export function buildCanvasDashboardItems(canvases: DashboardCanvas[]): CanvasDashboardItem[] {
  return canvases
    .map((canvas) => buildCanvasDashboardItem(canvas))
    .filter((item): item is CanvasDashboardItem => item !== undefined)
    .sort((a, b) => Date.parse(b.latestGeneratedAt) - Date.parse(a.latestGeneratedAt));
}

function buildCanvasDashboardItem(canvas: DashboardCanvas): CanvasDashboardItem | undefined {
  const outputs = extractGeneratedOutputs(canvas);
  if (outputs.length === 0) return undefined;

  const sorted = [...outputs].sort((a, b) => b.sortTime - a.sortTime);
  const totalActualCost = outputs.reduce<number | undefined>((total, output) => {
    if (output.actualCost === undefined) return total;
    return (total ?? 0) + output.actualCost;
  }, undefined);

  return {
    id: canvas.id,
    name: canvas.name,
    latestGeneratedAt: sorted[0].generatedAt,
    outputCount: outputs.length,
    totalActualCost,
    previews: sorted.slice(0, 5).map(({ id, kind, url, generatedAt }) => ({
      id,
      kind,
      url,
      generatedAt,
    })),
  };
}

function extractGeneratedOutputs(canvas: DashboardCanvas): GeneratedOutput[] {
  const nodes = Array.isArray(canvas.graph.nodes) ? canvas.graph.nodes : [];
  const updatedAtTime = Date.parse(canvas.updatedAt);
  const fallbackBase = Number.isFinite(updatedAtTime) ? updatedAtTime : 0;
  const outputs: GeneratedOutput[] = [];
  let legacyIndex = 0;

  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const data = node.data;
    if (!isRecord(data)) continue;
    const history = data.history;
    if (!isRecord(history) || !Array.isArray(history.entries)) continue;

    for (const rawEntry of history.entries) {
      const entry = rawEntry as HistoryEntryLike;
      const output = entry.output;
      if (!isGeneratedOutput(output)) {
        legacyIndex += 1;
        continue;
      }

      const timestamp = typeof entry.createdAt === "string" ? entry.createdAt : undefined;
      const parsedTimestamp = timestamp ? Date.parse(timestamp) : Number.NaN;
      const sortTime = Number.isFinite(parsedTimestamp) ? parsedTimestamp : fallbackBase + legacyIndex;
      const generatedAt = new Date(sortTime).toISOString();
      const id = typeof entry.id === "string" ? entry.id : `${canvas.id}-${outputs.length}`;
      const actualCost = typeof entry.actualCost === "number" ? entry.actualCost : undefined;

      outputs.push({
        id,
        kind: output.kind,
        url: output.url,
        generatedAt,
        sortTime,
        actualCost,
      });
      legacyIndex += 1;
    }
  }

  return outputs;
}

function isGeneratedOutput(output: HistoryEntryLike["output"]): output is {
  kind: "image" | "video";
  url: string;
} {
  return (
    output !== undefined &&
    (output.kind === "image" || output.kind === "video") &&
    typeof output.url === "string" &&
    output.url.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
