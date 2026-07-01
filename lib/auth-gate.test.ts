import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  verifyPassword,
  createSessionToken,
  isValidSessionToken,
  isGateDisabled,
} from "./auth-gate";

describe("verifyPassword", () => {
  beforeEach(() => {
    process.env.PLAYGROUND_PASSWORD = "correct horse";
  });

  it("accepts the configured password", async () => {
    expect(await verifyPassword("correct horse")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    expect(await verifyPassword("nope")).toBe(false);
  });

  it("rejects an empty password", async () => {
    expect(await verifyPassword("")).toBe(false);
  });
});

describe("session token", () => {
  beforeEach(() => {
    process.env.PLAYGROUND_PASSWORD = "correct horse";
  });

  it("validates a freshly created token", async () => {
    const token = await createSessionToken();
    expect(await isValidSessionToken(token)).toBe(true);
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken();
    expect(await isValidSessionToken(token + "x")).toBe(false);
  });

  it("rejects an empty or malformed token", async () => {
    expect(await isValidSessionToken("")).toBe(false);
    expect(await isValidSessionToken("garbage")).toBe(false);
  });

  it("rejects an expired token", async () => {
    const expired = await createSessionToken(Date.now() - 1000);
    expect(await isValidSessionToken(expired)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken();
    process.env.PLAYGROUND_PASSWORD = "rotated secret";
    expect(await isValidSessionToken(token)).toBe(false);
  });
});

describe("isGateDisabled", () => {
  const origEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  it("disables the gate in dev when no password is configured", () => {
    delete process.env.PLAYGROUND_PASSWORD;
    process.env.NODE_ENV = "development";
    expect(isGateDisabled()).toBe(true);
  });

  it("keeps the gate on in dev when a password is configured", () => {
    process.env.PLAYGROUND_PASSWORD = "correct horse";
    process.env.NODE_ENV = "development";
    expect(isGateDisabled()).toBe(false);
  });

  it("never disables the gate in production, even without a password", () => {
    delete process.env.PLAYGROUND_PASSWORD;
    process.env.NODE_ENV = "production";
    expect(isGateDisabled()).toBe(false);
  });
});
