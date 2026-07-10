# GraphicsFlow V3 Foundation

This directory contains the new application. The existing `../PHP version/` directory remains the working reference and should not be modified as part of V3 development.

## Workspace layout

- `apps/web` — React, TypeScript, Vite, Tailwind
- `apps/server` — Fastify API
- `packages/shared` — shared schemas, contracts, and types
- `storage` — local runtime output; ignored by Git

## Current status

The first foundation milestone provides a runnable application shell and API health check. It intentionally does not contain migrated Graphics Manager business logic yet.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

## Architecture rule

Business logic must have one authoritative home. React components call API routes; API routes delegate to services; services own database and document-processing behavior.

## Next milestone

Rebuild the G# List and graphics record workflow using the PHP `index.php` page and `graphics.db` as behavioral references.
