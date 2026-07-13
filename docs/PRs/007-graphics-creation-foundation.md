# PR 007 — Graphics Creation Foundation

## Objective

Establish GraphicsFlow-owned graphics, document, and revision storage and provide a complete **Create G#** workflow without modifying the copied Graphics Manager 2.0 database.

## Product boundary

Daily creation work remains in the Graphics workspace. Approval and Print Card creators will consume this foundation in later PRs and can eventually move into the selected record inspector.

## What this PR adds

- Canonical writable `graphics_records` table in the V3 database
- Safe import of existing legacy graphics while preserving their IDs
- Canonical `graphics_documents` and `document_revisions` foundation tables
- Existing Graphics list and record lookups now read through the V3 store
- Validated `POST /api/graphics` endpoint
- Automatic next-G# allocation using Company Settings identifier formatting
- Duplicate normalized G# protection
- Reusable Create G# modal workflow
- Required Customer #, Customer Name, and Part # fields
- Unsaved-change confirmation
- Pending and error states
- Automatic list refresh, default G# sorting, record selection, and success feedback after creation

## Safeguards

- The copied PHP `graphics.db` remains read-only and untouched
- Existing legacy IDs are preserved during import so current file, preview, and metadata relationships remain stable
- New G# allocation is performed inside an immediate SQLite transaction
- User-facing identifier formatting comes from Company Settings
- Production documents are not created or modified in this PR

## Deferred

- Print Card Creator
- Approval Creator
- Inspector action integration
- Revision history UI
- Authentication and server-enforced permissions
- Admin maintenance tools

## Local testing

```bash
cd ~/Documents/github/GraphicsFlow-Migration
git fetch origin
git switch agent/pr-007-graphics-creation-foundation

cd graphicsflow-v3
npm install
npm run dev
```

1. Confirm the existing Graphics list still loads, searches, sorts, and opens records.
2. Click **Create G#**.
3. Confirm all three fields are required.
4. Enter data, cancel, and verify the discard confirmation appears.
5. Create a record and verify the next G# is assigned.
6. Confirm the list returns to G# descending, the new record is selected, and its inspector opens.
7. Restart the app and confirm the new record persists.
8. Confirm the copied PHP database has not changed.
