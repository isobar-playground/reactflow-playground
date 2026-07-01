// Trailing-edge debounce with `flush` (invoke now, drop the pending timer) and
// `cancel` (drop the pending call without invoking). Used to coalesce rapid
// autosave triggers (e.g. dragging a node) into a single write.

export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  flush: () => void;
  cancel: () => void;
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: Args | undefined;

  function clear() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  const debounced = ((...args: Args) => {
    pendingArgs = args;
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      const argsToUse = pendingArgs;
      pendingArgs = undefined;
      if (argsToUse) fn(...argsToUse);
    }, waitMs);
  }) as Debounced<Args>;

  debounced.flush = () => {
    if (timer === undefined) return;
    clear();
    const argsToUse = pendingArgs;
    pendingArgs = undefined;
    if (argsToUse) fn(...argsToUse);
  };

  debounced.cancel = () => {
    clear();
    pendingArgs = undefined;
  };

  return debounced;
}
