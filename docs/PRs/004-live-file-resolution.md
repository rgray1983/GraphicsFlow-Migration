# PR 004 — Live File Resolution

> **Objective:** Resolve current approval and print-card files directly from the storage roots configured in Company Settings and surface their live metadata in the Graphics inspector.

## Scope

### Backend

- Add `GET /api/graphics/:id/files`.
- Add `POST /api/settings/file-index/refresh`.
- Build a persistent live-file index in the V3 SQLite database.
- Scan configured Approvals and Print Cards roots only when the index is refreshed.
- Extract normalized numeric identifiers from file names.
- Query indexed files by exact normalized G#.
- Return the latest match and all matches by modified date.
- Bound indexing to five directory levels and 100,000 entries per root.

### Frontend

- Add **Refresh File Index** under Company Settings → Storage & Files.
- Report indexed file count and indexing duration.
- Resolve inspector file states through fast SQLite queries instead of network crawling.
- Show loading, index-needed, connected, not-found, and error states.
- Display the latest file name, relative path, size, modified date, and match count.
- Keep viewer buttons disabled until modal viewers and secure streaming routes are added.

### Source-file policy

- Do not upload or copy approvals or print cards into GraphicsFlow.
- Do not expose absolute server paths to the browser.
- Return relative paths and metadata only.
- Keep all filesystem access inside configured server roots.
- Store only searchable metadata in the V3 database.

## Acceptance criteria

- The initial index can be built from Company Settings.
- After indexing, switching between G# records resolves files without rescanning the network share.
- A G# with a matching approval shows the latest live approval metadata.
- A G# with a matching print card shows the latest live print-card metadata.
- A record without matching files reports no match.
- Similar G# values do not collide.
- Missing, unreadable, or unmounted roots fail safely during indexing.
- Changing configured roots requires saving settings before rebuilding the index.
- No source file is copied, moved, renamed, or modified.

## Local testing

```bash
git fetch origin
git switch agent/pr-004-live-file-resolution
cd graphicsflow-v3
npm install
npm run dev
```

1. Open `http://localhost:5173/settings`.
2. Open **Storage & Files**.
3. Click **Refresh File Index** and wait for the indexed-file summary.
4. Open `http://localhost:5173/graphics`.
5. Test several records with and without approvals and print cards.
6. Switch rapidly between records and confirm lookups are fast.

## Deferred work

- Automatic scheduled/background index refresh
- Incremental filesystem watching
- Secure inline file streaming
- Approval PDF viewer modal
- Approval artwork crop preview
- Print-card viewer modal
- Download and print actions
- Revision classification and timeline
