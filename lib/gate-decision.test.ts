import { describe, it, expect } from "vitest";
import { gateDecision } from "./gate-decision";

describe("gateDecision", () => {
  it("allows any route when authenticated", () => {
    expect(gateDecision("/", true)).toBe("allow");
    expect(gateDecision("/api/canvases", true)).toBe("allow");
  });

  it("always allows the login page and its action, even unauthenticated", () => {
    expect(gateDecision("/login", false)).toBe("allow");
    expect(gateDecision("/api/login", false)).toBe("allow");
  });

  it("redirects unauthenticated page requests to login", () => {
    expect(gateDecision("/", false)).toBe("redirect");
    expect(gateDecision("/canvas/abc", false)).toBe("redirect");
  });

  it("returns unauthorized for unauthenticated API requests (no redirect)", () => {
    expect(gateDecision("/api/canvases", false)).toBe("unauthorized");
  });
});
