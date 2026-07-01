import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

// jsdom has no layout engine: elements report zero size, and
// ResizeObserver doesn't exist at all. @xyflow/react uses ResizeObserver to
// detect each node's dimensions and only renders a node visible once it has
// been "measured" — so tests need a non-zero size and an observer that
// actually reports it, or every node stays `visibility: hidden` forever.
Element.prototype.getBoundingClientRect = function () {
  return {
    width: 200,
    height: 100,
    top: 0,
    left: 0,
    right: 200,
    bottom: 100,
    x: 0,
    y: 0,
    toJSON() {},
  };
};

// @xyflow/react's own node-internals measurement (handle positions/bounds,
// used by the real connection-drag machinery — issue #17's Handle-Spawned
// Node onConnectEnd wiring) reads offsetWidth/offsetHeight rather than
// getBoundingClientRect, and jsdom reports both as 0 with no layout engine
// to back them — so without this, handleBounds never gets computed and a
// simulated connection drag silently no-ops before ever reaching
// onConnectEnd. Matches the getBoundingClientRect stub above in spirit.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get() {
    return 200;
  },
});
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get() {
    return 100;
  },
});

class ResizeObserverStub {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe(target: Element) {
    const fire = () => {
      const rect = target.getBoundingClientRect();
      this.#callback(
        [
          {
            target,
            contentRect: rect,
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    };
    // Fired synchronously so a node is "measured" (visible) the instant
    // render() returns — existing tests assert on that without awaiting a
    // tick. Also re-fired on a microtask: @xyflow/react's own node-internals
    // measurement (issue #17's connection-drag machinery) additionally needs
    // the ReactFlow wrapper's own `domNode` mount effect to have already run
    // (it looks up `.xyflow__viewport` under it) — with a *real* browser
    // ResizeObserver that's always true, since real observations fire async
    // after layout, well after every mount effect. Our synchronous-first
    // call can race ahead of that effect (nodes are deeper in the tree, so
    // their effects can run before a shallower sibling's), silently skipping
    // handle-bounds computation; the microtask re-fire catches that case
    // without changing when nodes first become visible.
    fire();
    queueMicrotask(fire);
  }
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom has no layout/hit-testing engine, so document.elementFromPoint
// doesn't exist — @xyflow/react's connection-drag machinery (XYHandle) calls
// it while a drag is in progress to find the handle under the pointer.
// Returning null (nothing under the pointer) is the correct answer for a
// drag ending on empty canvas, which is exactly the case issue #17's
// Handle-Spawned Node feature needs to simulate.
if (typeof document.elementFromPoint !== "function") {
  document.elementFromPoint = () => null;
}

// @xyflow/react also reads transform matrices via DOMMatrixReadOnly, which
// jsdom doesn't implement either.
if (typeof globalThis.DOMMatrixReadOnly === "undefined") {
  class DOMMatrixReadOnlyStub {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([^)]+)\)/)?.[1];
      this.m22 = scale ? parseFloat(scale) : 1;
    }
  }
  globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;
}
