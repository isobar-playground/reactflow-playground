import type { ImagePlaceholderResult } from "./generation-mock";

// Per-node History (CONTEXT.md): the ordered list of outputs a single
// Generation Node has produced. One entry is the Active Output — what the
// node displays and what downstream consumers would read. The caller builds
// the full HistoryEntry (including its id) so this module stays pure and
// needs no id-generation mocking in tests.

export interface HistoryEntry {
  id: string;
  prompt: string;
  output: ImagePlaceholderResult;
}

export interface NodeHistory {
  entries: HistoryEntry[];
  activeId: string | null;
}

// Appends a new entry and makes it the active one. Called on every
// Generate/Regenerate, even when the prompt is unchanged — every attempt is
// kept, with no length limit.
export function appendEntry(history: NodeHistory, entry: HistoryEntry): NodeHistory {
  return {
    entries: [...history.entries, entry],
    activeId: entry.id,
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
