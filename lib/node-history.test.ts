import { describe, it, expect, vi } from "vitest";
import { appendEntry, setActiveEntry, getActiveEntry, type NodeHistory, type HistoryEntry } from "./node-history";

const emptyHistory: NodeHistory = { entries: [], activeId: null };

function entry(id: string, prompt: string): HistoryEntry {
  return { id, prompt, output: { kind: "image", url: `https://picsum.photos/seed/${id}/768/768` } };
}

describe("appendEntry", () => {
  it("adds the entry to the list and makes it the active entry", () => {
    const history = appendEntry(emptyHistory, entry("a", "a cat"));

    expect(history.entries).toEqual([
      expect.objectContaining({ ...entry("a", "a cat"), createdAt: expect.any(String) }),
    ]);
    expect(history.activeId).toBe("a");
  });

  it("adds a creation timestamp to new entries that do not have one yet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T10:30:00.000Z"));

    const history = appendEntry(emptyHistory, entry("a", "a cat"));

    expect(history.entries[0].createdAt).toBe("2026-07-07T10:30:00.000Z");

    vi.useRealTimers();
  });

  it("keeps an existing timestamp when restoring or cloning a history entry", () => {
    const existing: HistoryEntry = {
      ...entry("a", "a cat"),
      createdAt: "2026-07-06T09:00:00.000Z",
    };

    const history = appendEntry(emptyHistory, existing);

    expect(history.entries[0].createdAt).toBe("2026-07-06T09:00:00.000Z");
  });
});

describe("setActiveEntry", () => {
  it("switches which entry is active without changing the entry list", () => {
    let history = appendEntry(emptyHistory, entry("a", "a cat"));
    history = appendEntry(history, entry("b", "a dog"));
    expect(history.activeId).toBe("b");

    history = setActiveEntry(history, "a");

    expect(history.activeId).toBe("a");
    expect(history.entries).toEqual([
      expect.objectContaining({ ...entry("a", "a cat"), createdAt: expect.any(String) }),
      expect.objectContaining({ ...entry("b", "a dog"), createdAt: expect.any(String) }),
    ]);
  });
});

describe("getActiveEntry", () => {
  it("returns the entry matching activeId", () => {
    let history = appendEntry(emptyHistory, entry("a", "a cat"));
    history = appendEntry(history, entry("b", "a dog"));
    history = setActiveEntry(history, "a");

    expect(getActiveEntry(history)).toEqual(
      expect.objectContaining({ ...entry("a", "a cat"), createdAt: expect.any(String) }),
    );
  });

  it("returns undefined when history is empty", () => {
    expect(getActiveEntry(emptyHistory)).toBeUndefined();
  });
});

describe("video outputs (issue #11)", () => {
  it("accepts a video-kind output for a Video Generation Node's history entry", () => {
    const videoEntry: HistoryEntry = {
      id: "v1",
      prompt: "a car driving",
      output: { kind: "video", url: "/sample-video.mp4" },
    };
    const history = appendEntry(emptyHistory, videoEntry);

    expect(getActiveEntry(history)).toEqual(
      expect.objectContaining({ ...videoEntry, createdAt: expect.any(String) }),
    );
  });
});

describe("actualCost (CONTEXT.md's Actual Cost / issue #41)", () => {
  it("carries an entry's actualCost through append and back out via getActiveEntry", () => {
    const withCost: HistoryEntry = {
      id: "a",
      prompt: "a cat",
      output: { kind: "image", url: "https://fal.media/a.png" },
      actualCost: 0.12,
    };

    const history = appendEntry(emptyHistory, withCost);

    expect(getActiveEntry(history)?.actualCost).toBe(0.12);
  });

  it("leaves actualCost undefined for an entry that never got one (old placeholders, missing header, etc.)", () => {
    const history = appendEntry(emptyHistory, entry("a", "a cat"));

    expect(getActiveEntry(history)?.actualCost).toBeUndefined();
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
