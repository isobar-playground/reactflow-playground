export type GateOutcome = "allow" | "redirect" | "unauthorized";

const PUBLIC_PATHS = ["/login", "/api/login"];

/** Decide how the middleware should treat a request for `pathname`. Pure so it's trivially testable. */
export function gateDecision(pathname: string, authenticated: boolean): GateOutcome {
  if (authenticated) return "allow";
  if (PUBLIC_PATHS.includes(pathname)) return "allow";
  return pathname.startsWith("/api/") ? "unauthorized" : "redirect";
}
