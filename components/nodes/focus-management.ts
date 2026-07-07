import type { KeyboardEvent } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function focusFirstDescendant(container: HTMLElement): void {
  const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  (first ?? container).focus();
}

export function trapFocusWithin(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement,
  onEscape: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onEscape();
    return;
  }

  if (event.key !== "Tab") return;

  const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
