# PR 002 — Graphics Record Drawer

## Goal

Transform the Graphics list into a record workspace by allowing users to select a G# and inspect its summary, approval-preview state, and future document actions in a persistent right-side drawer.

## Source references

- Latest merged `main` branch
- `PHP version/index.php`
- `PHP version/graphics.db`
- `docs/DECISIONS.md`

## Scope

### Graphics row selection

- Make the full table row selectable.
- Add subtle hover and selected states.
- Preserve one selected record at a time.
- Add keyboard activation with Enter and Space.

### Record drawer

- Add a reusable `RecordDrawer` component.
- Slide the drawer in from the right.
- Keep the drawer open while another row is selected.
- Update drawer content without replaying the open animation.
- Close with the close button or Escape.
- Do not close when selecting another record.

### Drawer content

- Display G#, customer number, customer name, part number, and created date.
- Add an Approval Preview section with an honest unavailable state.
- Add disabled View Approval and View Print Card buttons until file services exist.
- Add a future History placeholder.
- Do not invent approval, S#, designer, revision, or status values that are not available from the current graphics record.

### Modal foundation

- Add a reusable accessible `Modal` component for future approval and print-card viewers.
- Do not connect or display document files in this PR.

### Documentation

- Add `docs/DECISIONS.md`.
- Add this numbered PR document.

## Acceptance criteria

- Clicking a graphics row opens the right-side drawer.
- The selected row is visually distinct.
- Selecting a different row updates the drawer while it remains open.
- Escape closes the drawer.
- The table remains internally scrollable.
- The drawer has its own subtle internal scrollbar when needed.
- Mobile and narrow layouts present the drawer as an overlay instead of crushing the table.
- Approval and print-card buttons are visibly unavailable and cannot perform an action.
- No backend, database, PHP, file lookup, edit, create, or delete behavior is added.

## Local testing

```bash
git fetch origin
git switch agent/pr-002-record-drawer
cd graphicsflow-v3
npm install
npm run dev
```

Open:

```text
http://localhost:5173/graphics
```

Test:

1. Select several rows in succession.
2. Confirm the drawer stays open and its content updates.
3. Press Escape and confirm it closes.
4. Reopen it and test table scrolling.
5. Narrow the browser window and confirm the drawer overlays safely.
6. Confirm disabled document actions do nothing.

## Deferred work

- Approval file lookup and artwork crop preview
- Approval viewer modal
- Print-card file lookup and viewer modal
- Download and print actions
- Revision history timeline
- Deep-linking selected G# in the URL
- Editing and record management
