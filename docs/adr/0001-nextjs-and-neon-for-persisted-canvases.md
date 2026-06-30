# Next.js + Neon Postgres for persisted canvases

## Context

This started as a pure client-side React Flow playground with no backend. We then decided we want a list of saved canvases that survive across sessions and are shared between everyone (no auth).

## Decision

Build the app with **Next.js (App Router) + TypeScript**, and persist canvases in **Neon serverless Postgres**, accessed only from the server (Route Handlers / Server Actions) via `@neondatabase/serverless`. Deploy to Vercel.

## Why

A database cannot be reached safely from the browser, so persistence forces a server layer. Next.js gives us client and server in one framework with a native Vercel + Neon integration, avoiding a separate Vite-SPA-plus-loose-serverless-functions setup. localStorage was the simpler alternative but does not give a shared, cross-device list of canvases.

## Consequences

- The "no backend" simplicity is gone; there is now a DB and server code to maintain.
- There is no per-user identity, but the whole site sits behind a single shared password (`PLAYGROUND_PASSWORD`, checked server-side in middleware, httpOnly cookie). Everyone past the gate shares one global canvas list and can read/edit everything.
- Uploaded assets live in Vercel Blob with public URLs, so they are not covered by the password gate — anyone with a blob URL can fetch the file. Accepted for a POC.
