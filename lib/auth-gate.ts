// Single shared-password gate. Edge-runtime safe: uses only Web Crypto + Web APIs.

function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // ponytail: length leaks via early return, so fold it into the diff instead
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * When no password is configured we open the gate for local dev only.
 * Production always fails closed: an unset password there leaves the site locked,
 * never wide open.
 */
export function isGateDisabled(): boolean {
  return !process.env.PLAYGROUND_PASSWORD && process.env.NODE_ENV !== "production";
}

export async function verifyPassword(input: string): Promise<boolean> {
  const expected = process.env.PLAYGROUND_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(input, expected);
}

// ponytail: reuse PLAYGROUND_PASSWORD as the HMAC secret; one env var instead of two.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

async function hmac(payload: string): Promise<string> {
  const secret = process.env.PLAYGROUND_PASSWORD ?? "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Token = `<expiresAtMs>.<hmac(expiresAtMs)>`. Default expiry ~30 days out. */
export async function createSessionToken(expiresAt = Date.now() + SESSION_TTL_MS): Promise<string> {
  const payload = String(expiresAt);
  return `${payload}.${await hmac(payload)}`;
}

export async function isValidSessionToken(token: string): Promise<boolean> {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafeEqual(sig, await hmac(payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}
