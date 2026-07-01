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

class ResizeObserverStub {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe(target: Element) {
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
  }
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

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
