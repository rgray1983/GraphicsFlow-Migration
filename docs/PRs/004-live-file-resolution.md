# PR 004 — Live File Resolution

> **Objective:** Resolve current approval and print-card files directly from configured storage roots, index their metadata for fast lookup, and establish the preview-cache foundation used by future document viewers.

## Scope

### Backend

- Add `GET /api/graphics/:id/files`.
- Add server-owned background file-index jobs.
- Add index start and status endpoints.
- Build a persistent live-file index in the V3 SQLite database.
- Scan configured Approvals and Print Cards roots only when the index is refreshed.
- Extract normalized numeric identifiers from file names.
- Query indexed files by exact normalized G#.
- Return the latest match and all matches by modified date.
- Bound indexing to five directory levels and 100,000 entries per root.
- Report current phase, entries examined, files discovered, elapsed time, percentage when an estimate exists, and estimated remaining time.
- Allow only one index job to run at a time.

### File Index experience

- Give File Index its own Company Settings section.
- Show a dedicated status card and progress bar.
- Continue indexing when the user leaves Settings or closes the browser.
- Poll job status only while a background job is active.
- Show approval count, print-card count, last update, duration, and failure details.
- Use a previous completed run as the estimate for later progress calculations.
- Use an indeterminate progress state on the first run because the final file count is not yet known.

### Preview-cache foundation

- Create a managed `preview-cache` directory beside the V3 settings database.
- Add preview-cache metadata storage for source fingerprints, cache state, and generated asset paths.
- Invalidate stale cache records when indexed source files are removed or change size/modified time.
- Keep actual PDF rendering and artwork cropping deferred to the Approval Viewer PR.

### Graphics inspector

- Resolve inspector file states through fast SQLite queries instead of network crawling.
- Show loading, index-needed, connected, not-found, and error states.
- Display the latest file name, relative path, size, modified date, and match count.
- Keep viewer buttons disabled until modal viewers and secure streaming routes are added.

### Source-file policy

- Do not upload or copy approvals or print cards into GraphicsFlow.
- Do not expose absolute server paths to the browser.
- Return relative paths and metadata only.
- Keep all filesystem access inside configured server roots.
- Store searchable metadata and disposable preview assets separately from source documents.

## Acceptance criteria

- The index starts from Company Settings and continues after navigating away.
- Returning to File Index shows the current or completed job state.
- Only one background index job can run at a time.
- Progress visibly updates while indexing.
- First-run progress is honest when no reliable total exists.
- Later runs can show percentage and ETA based on prior results.
- After indexing, switching between G# records resolves files without rescanning the network share.
- Records with and without matching files return the correct state.
- Similar G# values do not collide.
- Missing, unreadable, or unmounted roots fail safely.
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
2. Open **File Index**.
3. Start a refresh and watch phase, counts, elapsed time, and progress.
4. Navigate to another GraphicsFlow page while indexing.
5. Return to **File Index** and confirm the job continued.
6. After completion, rapidly open several G# records with and without files.
7. Run the index a second time and confirm estimated percentage and remaining time appear.

## Deferred work

- Scheduled refreshes
- Incremental filesystem watching
- Secure inline file streaming
- PDF-to-image preview generation
- Approval artwork crop detection
- Approval and print-card viewer modals
- Download and print actions
- Revision classification and timeline
