# PR 005 — Preview Service & Cache

> **Objective:** Generate, cache, invalidate, and securely serve browser-friendly approval previews while keeping live production PDFs untouched.

## Scope

### Preview service

- Resolve the latest indexed approval for a graphics record.
- Generate the first PDF page as PNG.
- Support `thumb` and `medium` preview variants.
- Prefer ImageMagick and fall back to Ghostscript.
- Return a clear unavailable state when no renderer is installed.
- Deduplicate simultaneous generation requests for the same record and variant.

### Cache behavior

- Store generated PNG assets under `graphicsflow-v3/storage/preview-cache`.
- Fingerprint previews from record, variant, source root, relative path, modified time, and file size.
- Reuse valid cached assets.
- Regenerate automatically when the indexed source fingerprint changes.
- Store preview state and generation metadata in the V3 SQLite database.
- Treat generated previews as disposable cache, never authoritative files.

### API

- `GET /api/previews/:graphicId/:variant`
- `GET /api/previews/:graphicId/:variant/image`
- Validate graphics IDs and preview variants.
- Return PNG bytes without exposing absolute network paths.

### Shared UI

- Add reusable `PreviewAsset` component.
- Show a blurred shimmer while the first preview is generated.
- Fade the cached preview into place.
- Show clear unavailable and failed states.
- Use the component in the Graphics inspector Approval Preview section.

## Acceptance criteria

- A record with an indexed PDF approval generates and displays a preview.
- Reopening the same record uses the cached PNG.
- A changed approval source creates a new fingerprint and preview.
- A record without an approval keeps the existing no-approval state.
- Missing ImageMagick/Ghostscript reports an actionable unavailable message.
- Absolute source paths are not exposed to the browser.
- Production PDFs are never copied, renamed, moved, or modified.
- Viewer modal, source-PDF streaming, download, print, and artwork crop detection are not added.

## Local testing

```bash
git fetch origin
git switch agent/pr-005-preview-service
cd graphicsflow-v3
npm install
npm run dev
```

1. Confirm the File Index is current.
2. Open `/graphics` and select a record with a PDF approval.
3. Confirm the shimmer appears and the first-page preview fades in.
4. Close and reopen the record; confirm the cached preview loads faster.
5. Test a record without an approval.
6. Test another approval after renaming or modifying it and refreshing the File Index.
7. Confirm `graphicsflow-v3/storage/preview-cache` remains ignored runtime data.

## Deferred work

- Approval artwork-region crop detection
- Full Approval Viewer modal
- Secure source-PDF streaming
- Revision navigation
- Download and print actions
- Print-card preview integration
- Cache administration and cleanup reporting
