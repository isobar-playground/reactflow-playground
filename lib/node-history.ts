// Per-node History (CONTEXT.md): the ordered list of outputs a single
// Generation Node has produced. One entry is the Active Output — what the
// node displays and what downstream consumers would read. The caller builds
// the full HistoryEntry (including its id) so this module stays pure and
// needs no id-generation mocking in tests.
//
// The output is a union (issue #11 adds VideoPlaceholderResult for the
// Video Generation Node) since History is the same shape for both Image and
// Video Generation Nodes — only the placeholder kind differs. These two
// types used to live in the now-deleted lib/generation-mock.ts; issue #39
// moves them here — where History itself lives — so the persisted shape of
// a HistoryEntry's `output` stays byte-for-byte identical and previously
// saved canvases (picsum image entries, /sample-video.mp4 entries) still
// load and render exactly as before.
export interface ImagePlaceholderResult {
  kind: "image";
  url: string;
}

export interface VideoPlaceholderResult {
  kind: "video";
  url: string;
}

export interface HistoryEntry {
  id: string;
  prompt: string;
  output: ImagePlaceholderResult | VideoPlaceholderResult;
  // Creation timestamp for generated outputs appended after issue #52.
  // Optional so older persisted History entries continue to load; dashboard
  // code derives deterministic fallback recency for those legacy entries.
  createdAt?: string;
  // Actual Cost (CONTEXT.md / ADR-0009, issue #41): what this one generation
  // really cost — billable units × the Model's snapshotted unit price
  // (lib/actual-cost.ts), computed once the run settles. Undefined for a
  // failed run (never recorded), an old placeholder entry predating this
  // field, a result with no billable-units header, or a node with no
  // pricing snapshot — CONTEXT.md: such entries "render normally with no
  // amount."
  actualCost?: number;
}

export interface NodeHistory {
  entries: HistoryEntry[];
  activeId: string | null;
}

// Appends a new entry and makes it the active one. Called on every
// Generate/Regenerate, even when the prompt is unchanged — every attempt is
// kept, with no length limit.
export function appendEntry(history: NodeHistory, entry: HistoryEntry): NodeHistory {
  const timestampedEntry = entry.createdAt ? entry : { ...entry, createdAt: new Date().toISOString() };
  return {
    entries: [...history.entries, timestampedEntry],
    activeId: timestampedEntry.id,
  };
}

// Sets the Active Output to the given entry id. Selecting History never
// mutates the entries themselves and never triggers regeneration — it's a
// pure pointer swap.
export function setActiveEntry(history: NodeHistory, id: string): NodeHistory {
  return { ...history, activeId: id };
}

export function getActiveEntry(history: NodeHistory): HistoryEntry | undefined {
  return history.entries.find((entry) => entry.id === history.activeId);
}

// branchHistoryToActive (CONTEXT.md's Variant/Clone, ADR-0013): truncates a
// History to the entries up to and including its Active Output, with that
// entry as the new tip. Used when a branch point isn't the newest entry —
// a Variant, or an Edit taken from a History entry that isn't newest — so
// the branch (a sibling node, lib/variant-clone.ts) inherits the chain up
// to where it diverged rather than the whole thing. Empty History (nothing
// generated yet) is returned as-is: there's nothing yet to inherit before a
// first generation (CONTEXT.md's Variant / Clone, "first-gen variants
// behave unchanged"). Pure — never mutates its input.
export function branchHistoryToActive(history: NodeHistory): NodeHistory {
  const activeIndex = history.entries.findIndex((entry) => entry.id === history.activeId);
  if (activeIndex === -1) return { entries: [], activeId: null };

  return {
    entries: history.entries.slice(0, activeIndex + 1),
    activeId: history.activeId,
  };
}
