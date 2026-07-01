import { describe, it, expect } from "vitest";
import { appendEntry, setActiveEntry, getActiveEntry, type NodeHistory, type HistoryEntry } from "./node-history";

const emptyHistory: NodeHistory = { entries: [], activeId: null };

function entry(id: string, prompt: string): HistoryEntry {
  return { id, prompt, output: { kind: "image", url: `https://picsum.photos/seed/${id}/768/768` } };
}

describe("appendEntry", () => {
  it("adds the entry to the list and makes it the active entry", () => {
    const history = appendEntry(emptyHistory, entry("a", "a cat"));

    expect(history.entries).toEqual([entry("a", "a cat")]);
    expect(history.activeId).toBe("a");
  });
});

describe("setActiveEntry", () => {
  it("switches which entry is active without changing the entry list", () => {
    let history = appendEntry(emptyHistory, entry("a", "a cat"));
    history = appendEntry(history, entry("b", "a dog"));
    expect(history.activeId).toBe("b");

    history = setActiveEntry(history, "a");

    expect(history.activeId).toBe("a");
    expect(history.entries).toEqual([entry("a", "a cat"), entry("b", "a dog")]);
  });
});

describe("getActiveEntry", () => {
  it("returns the entry matching activeId", () => {
    let history = appendEntry(emptyHistory, entry("a", "a cat"));
    history = appendEntry(history, entry("b", "a dog"));
    history = setActiveEntry(history, "a");

    expect(getActiveEntry(history)).toEqual(entry("a", "a cat"));
  });

  it("returns undefined when history is empty", () => {
    expect(getActiveEntry(emptyHistory)).toBeUndefined();
  });
});

describe("history growth", () => {
  it("keeps every entry's own prompt independent of later entries", () => {
    let history = appendEntry(emptyHistory, entry("a", "a cat"));
    history = appendEntry(history, entry("b", "a dog"));
    history = appendEntry(history, entry("c", "a bird"));

    expect(history.entries.map((e) => e.prompt)).toEqual(["a cat", "a dog", "a bird"]);
  });

  it("has no length limit and preserves insertion order", () => {
    let history = emptyHistory;
    for (let i = 0; i < 50; i++) {
      history = appendEntry(history, entry(`id-${i}`, `prompt ${i}`));
    }

    expect(history.entries).toHaveLength(50);
    expect(history.entries.map((e) => e.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => `id-${i}`),
    );
    expect(history.activeId).toBe("id-49");
  });
});
