import { describe, expect, it } from "vitest";
import {
  CONTROL_STATE_CLASSES,
  DATA_TYPE_TREATMENTS,
  MOTION_CLASSES,
  SURFACE_CLASSES,
} from "./visual-system";

describe("visual system tokens", () => {
  it("defines semantic data-type treatments with non-color cues", () => {
    expect(Object.keys(DATA_TYPE_TREATMENTS)).toEqual(["text", "image", "video"]);

    for (const [dataType, treatment] of Object.entries(DATA_TYPE_TREATMENTS)) {
      expect(treatment.label).toBe(dataType);
      expect(treatment.icon).toBeTruthy();
      expect(treatment.classes).toContain(`data-${dataType}`);
    }
  });

  it("exposes shared surface classes for the light studio shell", () => {
    expect(SURFACE_CLASSES.app).toContain("bg-[var(--studio-app)]");
    expect(SURFACE_CLASSES.canvas).toContain("bg-[var(--studio-canvas)]");
    expect(SURFACE_CLASSES.panel).toContain("border-[var(--studio-border)]");
    expect(SURFACE_CLASSES.card).toContain("bg-[var(--studio-card)]");
    expect(SURFACE_CLASSES.popover).toContain("bg-[var(--studio-popover)]");
  });

  it("names reusable control and motion states", () => {
    expect(CONTROL_STATE_CLASSES.base).toContain("focus-visible:ring-[3px]");
    expect(CONTROL_STATE_CLASSES.loading).toContain("aria-busy:cursor-wait");
    expect(CONTROL_STATE_CLASSES.disabled).toContain("disabled:opacity-45");
    expect(MOTION_CLASSES.subtle).toContain("motion-safe:transition");
    expect(MOTION_CLASSES.reduce).toContain("motion-reduce:transition-none");
  });
});
