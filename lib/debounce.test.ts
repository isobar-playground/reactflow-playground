import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses calls within the window into a single trailing call", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 1500);

    debounced("a");
    vi.advanceTimersByTime(500);
    debounced("b");
    vi.advanceTimersByTime(500);
    debounced("c");
    vi.advanceTimersByTime(1500);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("does not call the function before the window elapses", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 1500);

    debounced("a");
    vi.advanceTimersByTime(1499);

    expect(fn).not.toHaveBeenCalled();
  });

  it("flush invokes immediately with the latest args and cancels the pending timer", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 1500);

    debounced("a");
    debounced.flush();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");

    vi.advanceTimersByTime(1500);
    expect(fn).toHaveBeenCalledTimes(1); // no extra trailing call after flush
  });

  it("flush is a no-op when there is no pending call", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 1500);

    debounced.flush();

    expect(fn).not.toHaveBeenCalled();
  });

  it("cancel drops a pending call without invoking the function", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 1500);

    debounced("a");
    debounced.cancel();
    vi.advanceTimersByTime(1500);

    expect(fn).not.toHaveBeenCalled();
  });
});
