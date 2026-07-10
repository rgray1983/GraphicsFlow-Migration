# PR 004 — Live File Resolution

> **Objective:** Resolve current approval and print-card files directly from the storage roots configured in Company Settings and surface their live metadata in the Graphics inspector.

## Scope

### Backend

- Add `GET /api/graphics/:id/files`.
- Resolve the selected graphics record from the read-only PHP database.
- Normalize its G# for filename matching.
- Search the configured Approvals and Print Cards roots.
- Match the G# with numeric boundaries so similar numbers do not collide.
- Return the latest match and all matches by modified date.
- Bound searches to five directory levels and 5,000 entries per root.
- Cache results in memory for 60 seconds.

### Frontend

- Check live files whenever the Graphics inspector opens for a record.
- Show loading, connected, not-found, and error states.
- Display the latest file name, relative path, size, modified date, and match count.
- Keep viewer buttons disabled until the modal viewer and secure streaming routes are added.

### Source-file policy

- Do not upload or copy approvals or print cards into GraphicsFlow.
- Do not expose absolute server paths to the browser.
- Return relative paths and metadata only.
- Keep all filesystem access inside configured server roots.

## Acceptance criteria

- A G# with a matching approval shows the latest live approval metadata.
- A G# with a matching print card shows the latest live print-card metadata.
- `1290` does not match a file containing only `12901`.
- Missing, unreadable, or unmounted roots fail safely.
- Selecting another row refreshes the inspector for that G#.
- Reopening the same record within one minute uses cached results.
- No source file is copied, moved, renamed, or modified.
- No document viewer, download, print, file index database, users, or permissions are added.

## Local testing

```bash
git fetch origin
git switch agent/pr-004-live-file-resolution
cd graphicsflow-v3
npm install
npm run dev
```

Open `http://localhost:5173/graphics`.

Test records that have known approvals and print cards, records with no files, similar G# values, and temporarily unavailable storage roots.

## Deferred work

- Secure inline file streaming
- Approval PDF viewer modal
- Approval artwork crop preview
- Print-card viewer modal
- Download and print actions
- Persistent background file index
- Revision classification and timeline
