# PR 006 — Approval Viewer

> **Objective:** Open the latest live approval inside a focused GraphicsFlow viewer without leaving the Graphics workspace.

## Scope

### Secure approval access

- Add `GET /api/graphics/:id/approval.pdf`.
- Resolve only the latest indexed PDF approval for the selected graphics record.
- Validate the resolved real path remains inside the configured Approvals root.
- Stream the source PDF inline for printing or as an attachment for download.
- Keep absolute server paths private.
- Never copy, rename, move, or modify the production PDF.

### Reusable viewer

- Add a reusable `ApprovalViewer` modal.
- Open it from either the approval preview or the Documents action.
- Display the cached medium preview immediately.
- Support zoom in, zoom out, fit/reset, Command/Control + wheel zoom, and drag-to-pan.
- Include Print and Download PDF actions.
- Display G#, customer, customer number, part number, source filename, modified date, and file size.
- Close with the close button, backdrop, or Escape.
- Lock background page scrolling while the viewer is open.

### Responsive behavior

- Use a wide desktop viewer with a document canvas and metadata panel.
- Stack metadata below the document on smaller screens.
- Preserve reduced-motion preferences.

## Acceptance criteria

- Selecting a G# with an approval opens the viewer from the preview and Documents button.
- The cached approval image appears without opening a browser PDF tab.
- Zoom, fit, and drag-to-pan work without moving the underlying page.
- Print opens the live source PDF.
- Download returns the original live PDF with its source filename.
- A user cannot request arbitrary filesystem paths.
- Records without approvals cannot open the viewer.
- Closing the viewer returns the user to the same Graphics record and scroll position.

## Local testing

```bash
git fetch origin
git switch agent/pr-006-approval-viewer
cd graphicsflow-v3
npm install
npm run dev
```

1. Open `/graphics` and select a G# with a PDF approval.
2. Click the preview and confirm the viewer opens.
3. Test zoom buttons, fit, Command/Control + wheel, and drag-to-pan.
4. Close with Escape and reopen from **View Approval**.
5. Test Print and Download PDF.
6. Confirm the downloaded filename matches the live approval.
7. Test a record without an approval.
8. Resize below tablet width and confirm the metadata panel stacks below the canvas.

## Deferred work

- Revision navigation
- Multi-page page thumbnails and page selection
- Approval artwork-region crop detection
- Revision comparison
- Approval annotations
- Print-card viewer
