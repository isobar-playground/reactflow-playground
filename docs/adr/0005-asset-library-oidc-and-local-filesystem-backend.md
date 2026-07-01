# Asset Library authenticates to Vercel Blob via OIDC, and gains a local filesystem backend

## Context

`lib/asset-library.ts` already swaps between a real Vercel Blob client and an in-memory stub, the same pattern `lib/db.ts` uses for Neon vs. local Postgres. The swap gated on `BLOB_READ_WRITE_TOKEN` being set. Vercel changed how newly-connected Blob stores authenticate: as of 2026, connecting a store to a project provisions `BLOB_STORE_ID` and injects a short-lived `VERCEL_OIDC_TOKEN` into the Vercel Functions runtime automatically, and no longer issues a `BLOB_READ_WRITE_TOKEN` by default. The `@vercel/blob` SDK (already `^2.5.0`) resolves `VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID` on its own when no explicit token is passed to `put`/`list`.

Gating on `BLOB_READ_WRITE_TOKEN` therefore left production silently falling back to the in-memory client, even with a Blob store connected — and the in-memory client produces `memory://` URLs, which no browser can load. Locally, the same in-memory client stood in for a real upload target, but for the same reason never gave a working `<img src>`, only a working round-trip for tests.

## Decision

- The backend switch in `getClient()` gates on `BLOB_STORE_ID` (Vercel's own signal that a store is connected) instead of `BLOB_READ_WRITE_TOKEN`, and `blobClient()` calls `put()`/`list()` without an explicit token — the SDK resolves OIDC itself.
- A new filesystem backend writes uploads to `public/uploads/` (Next.js serves `public/` as static files, no extra route needed) and is used whenever `BLOB_STORE_ID` is absent and the process isn't running under Vitest.
- The in-memory client is kept, but now scoped to test runs only (`process.env.VITEST`), so tests still need zero provisioning and no disk I/O.

## Why

OIDC is Vercel's default for newly-connected stores and avoids a long-lived secret sitting in project env vars; matching it means the app works once a store is connected, with no manual token step. A filesystem backend for local dev reuses the existing `AssetLibraryClient` interface (one more implementation, no new abstraction) and gives real, loadable URLs during local development, which `memory://` never did.

## Consequences

- Canvases saved before this change may hold `memory://` asset URLs in their graph JSON. Those references are unrecoverable — the in-memory store that produced them didn't survive a server restart — and are left as broken images rather than migrated or cleaned up.
- `public/uploads/` is gitignored; local uploads don't round-trip through version control or deploys.
