# PR 005 — Preview Service & Cache

> **Objective:** Generate, cache, invalidate, and securely serve browser-friendly approval previews while keeping live production PDFs untouched.

## Scope

### Preview service

- Resolve the latest approval for a graphics record.
- Repair a missing index entry before reporting that no approval exists.
- Generate the first PDF page as PNG.
- Support `thumb` and `medium` preview variants.
- Prefer ImageMagick and fall back to Ghostscript.
- Return a clear unavailable state when no renderer is installed.
- Deduplicate simultaneous generation requests for the same record and variant.

### Live file synchronization

- Monitor configured approval and print-card roots for new, changed, renamed, and deleted files when the server supports recursive folder watching.
- Update individual index records instead of rebuilding the complete index.
- Restart folder monitoring when Company Settings storage paths change.
- Perform a bounded targeted G# folder search whenever an indexed approval or print card is missing.
- Insert targeted matches into the persistent index immediately.
- Keep targeted repair available even when a network share does not reliably deliver filesystem events.
- Expose server synchronization status at `GET /api/settings/file-sync/status`.

### Cache behavior

- Store generated PNG assets under `graphicsflow-v3/storage/preview-cache`.
- Fingerprint previews from record, variant, source root, relative path, modified time, and file size.
- Reuse valid cached assets.
- Regenerate automatically when the source fingerprint changes.
- Store preview state and generation metadata in the V3 SQLite database.
- Treat generated previews as disposable cache, never authoritative files.

### API

- `GET /api/previews/:graphicId/:variant`
- `GET /api/previews/:graphicId/:variant/image`
- `GET /api/settings/file-sync/status`
- Validate graphics IDs and preview variants.
- Return PNG bytes without exposing absolute network paths.

### Shared UI

- Add reusable `PreviewAsset` component.
- Show a blurred shimmer while the first preview is generated.
- Fade the cached preview into place.
- Show clear unavailable and failed states.
- Use the component in the Graphics inspector Approval Preview section.

### Graphics list refinement

- Default the list to G# descending.
- Allow server-side sorting by G#, Customer #, Customer, Part #, and Created.
- Toggle ascending and descending order by clicking the active column again.
- Show a small directional arrow on the active sort heading.
- Keep sorting accurate across the full dataset before the 100-record limit is applied.

## Acceptance criteria

- A record with a PDF approval generates and displays a preview.
- Reopening the same record uses the cached PNG.
- A changed approval source creates a new fingerprint and preview.
- Adding a new approval does not require a full manual index rebuild.
- Folder monitoring indexes new files automatically when supported.
- A targeted G# repair finds a newly added file when a network watcher misses the event.
- A genuinely missing approval keeps the existing no-approval state.
- Missing ImageMagick/Ghostscript reports an actionable unavailable message.
- Absolute source paths are not exposed to the browser.
- Production PDFs are never copied, renamed, moved, or modified.
- Each Graphics table heading sorts the complete result set in both directions.
- Viewer modal, source-PDF streaming, download, print, and artwork crop detection are not added.

## Local testing

```bash
git fetch origin
git switch agent/pr-005-preview-service
cd graphicsflow-v3
npm install
npm run dev
```

1. Confirm the File Index has been built at least once.
2. Open `/graphics` and select a record with a PDF approval.
3. Confirm the shimmer appears and the first-page preview fades in.
4. Close and reopen the record; confirm the cached preview loads faster.
5. Add a new PDF approval to a G# that currently has no approval.
6. Reopen that G# without running **Refresh File Index** and confirm the file and preview appear.
7. Modify or replace an approval and confirm the preview regenerates from its new fingerprint.
8. Test a record that genuinely has no approval.
9. Click each Graphics table heading and verify both ascending and descending order.
10. Confirm G# descending is the default and the active arrow matches the direction.
11. Confirm `graphicsflow-v3/storage/preview-cache` remains ignored runtime data.

## Deferred work

- Approval artwork-region crop detection
- Full Approval Viewer modal
- Secure source-PDF streaming
- Revision navigation
- Download and print actions
- Print-card preview integration
- Scheduled full reconciliation
- Cache administration and cleanup reporting
