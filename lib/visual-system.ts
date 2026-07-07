import type { DataType } from "@/lib/connection-rules";

export const DATA_TYPE_TREATMENTS: Record<
  DataType,
  { label: DataType; icon: "T" | "image" | "video"; classes: string }
> = {
  text: {
    label: "text",
    icon: "T",
    classes: "data-text border-[var(--data-text-border)] bg-[var(--data-text-bg)] text-[var(--data-text-fg)]",
  },
  image: {
    label: "image",
    icon: "image",
    classes: "data-image border-[var(--data-image-border)] bg-[var(--data-image-bg)] text-[var(--data-image-fg)]",
  },
  video: {
    label: "video",
    icon: "video",
    classes: "data-video border-[var(--data-video-border)] bg-[var(--data-video-bg)] text-[var(--data-video-fg)]",
  },
};

export const SURFACE_CLASSES = {
  app: "bg-[var(--studio-app)] text-[var(--studio-ink)]",
  page: "bg-[var(--studio-page)] text-[var(--studio-ink)]",
  canvas: "bg-[var(--studio-canvas)]",
  panel:
    "border border-[var(--studio-border)] bg-[var(--studio-panel)] shadow-[var(--studio-shadow)]",
  card:
    "border border-[var(--studio-border)] bg-[var(--studio-card)] shadow-[var(--studio-shadow)]",
  popover:
    "border border-[var(--studio-border)] bg-[var(--studio-popover)] shadow-[var(--studio-popover-shadow)]",
} as const;

export const CONTROL_STATE_CLASSES = {
  base:
    "outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--studio-page)]",
  hover: "hover:border-[var(--studio-border-strong)] hover:bg-[var(--studio-control-hover)]",
  active: "active:translate-y-px active:bg-[var(--studio-control-active)]",
  disabled: "disabled:pointer-events-none disabled:opacity-45",
  loading: "aria-busy:cursor-wait aria-busy:opacity-70",
} as const;

export const MOTION_CLASSES = {
  subtle: "motion-safe:transition motion-safe:duration-150 motion-safe:ease-out",
  reduce: "motion-reduce:transition-none motion-reduce:transform-none",
} as const;

export const INPUT_CLASSES = [
  "rounded-md border border-[var(--studio-border)] bg-[var(--studio-input)] px-3 py-2 text-sm text-[var(--studio-ink)] placeholder:text-[var(--studio-muted)]",
  CONTROL_STATE_CLASSES.base,
  CONTROL_STATE_CLASSES.hover,
  CONTROL_STATE_CLASSES.disabled,
  MOTION_CLASSES.subtle,
  MOTION_CLASSES.reduce,
].join(" ");

export const BADGE_CLASSES =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium";
