# PR 004 — Live File Resolution

> **Objective:** Resolve current approval and print-card files directly from configured storage roots, index their metadata for fast lookup, and establish the preview-cache foundation used by future document viewers.

## Completed

### Backend

- Added `GET /api/graphics/:id/files`.
- Added server-owned background file-index jobs.
- Added index start and status endpoints.
- Built a persistent live-file index in the V3 SQLite database.
- Scans configured Approvals and Print Cards roots only when the index is refreshed.
- Extracts normalized numeric identifiers from file names.
- Queries indexed files by exact normalized G#.
- Returns the latest match and all matches by modified date.
- Bounds indexing to five directory levels and 100,000 entries per root.
- Reports current phase, entries examined, files discovered, elapsed time, percentage when an estimate exists, and estimated remaining time.
- Allows only one index job to run at a time.

### File Index experience

- Added a dedicated Company Settings → **File Index** section.
- Added a dedicated status card and animated progress bar.
- Indexing continues when the user leaves Settings or closes the browser.
- The page polls job status only while a background job is active.
- Displays approval count, print-card count, last update, duration, and failure details.
- Uses a previous completed run as the estimate for later progress calculations.
- Uses an honest indeterminate state on the first run.

### Preview-cache foundation

- Created a managed `preview-cache` directory beside the V3 settings database.
- Added source-fingerprint and generated-asset metadata foundations.
- Established stale-cache invalidation rules.
- Kept production documents separate from disposable preview assets.

### Graphics inspector

- Resolves live files through fast SQLite queries instead of network crawling.
- Shows loading, index-needed, connected, not-found, and error states.
- Displays latest filename, relative path, size, modified date, and match count.

## Acceptance result

- Background indexing passed.
- Progress reporting passed.
- Records with and without matching approvals returned the correct state.
- Similar G# values did not collide during testing.
- Switching rapidly between indexed records was fast.
- No source file was copied, moved, renamed, or modified.
- PR 004 was merged into `main`.

## Lessons learned

- Network shares must never be crawled during normal record interaction.
- File discovery is a platform service, not a Graphics-page feature.
- Long-running work belongs to the server rather than a mounted browser component.
- Users tolerate expensive work when progress, phase, elapsed time, and completion state are visible.
- First-run progress must be honest when the final workload is unknown.
- Production files remain authoritative; generated previews are disposable cache.
- A slower one-time index is an acceptable tradeoff for instant daily record lookup.

## Deferred work

- Scheduled refreshes
- Incremental filesystem watching
- Secure inline source-document streaming
- PDF-to-image preview generation
- Approval artwork crop detection
- Approval and print-card viewer modals
- Download and print actions
- Revision classification and timeline
