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

### Reusable inspection components

- Keep `RecordDrawer` responsible for motion, Escape handling, responsive behavior, and scrolling.
- Add a reusable `RecordInspector` responsible for the shared header and section structure.
- Add a feature-specific `GraphicsRecordInspector` responsible only for graphics-record content.
- Allow future revision, approval, print-card, vendor-art, and report inspectors to reuse the same interaction pattern.

### Record drawer

- Slide the drawer in from the right.
- Use a responsive width with safe minimum and maximum limits.
- Keep the drawer open while another row is selected.
- Update drawer content without closing the drawer.
- Close with the close button or Escape.
- Preserve the smooth close animation.
- Add a delayed fade and subtle shimmer when inspector content changes.

### Inspector content

- Display G#, customer number, customer name, part number, and created date.
- Add an Approval Preview section with an honest unavailable state.
- Add disabled View Approval and View Print Card buttons until file services exist.
- Add a future Timeline placeholder.
- Use concise, consistent section headings: **Approval Preview**, **Details**, **Documents**, and **Timeline**.
- Do not invent approval, S#, designer, revision, or status values that are not available from the current graphics record.

### Modal foundation

- Add a reusable accessible `Modal` component for future approval and print-card viewers.
- Do not connect or display document files in this PR.

### Documentation

- Add and maintain `docs/DECISIONS.md`.
- Add this numbered PR document.

## Acceptance criteria

- Clicking a graphics row opens the right-side inspector.
- The selected row is visually distinct.
- Selecting a different row updates the inspector while it remains open.
- Escape closes the inspector.
- The table remains internally scrollable.
- The inspector has its own subtle internal scrollbar when needed.
- Mobile and narrow layouts present the inspector as an overlay instead of crushing the table.
- Inspector headings are concise and share the same visual treatment.
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
2. Confirm the inspector stays open and its content updates.
3. Confirm the headings read Approval Preview, Details, Documents, and Timeline.
4. Press Escape and confirm it closes smoothly.
5. Reopen it and test table and inspector scrolling.
6. Narrow the browser window and confirm the inspector overlays safely.
7. Confirm disabled document actions do nothing.

## Deferred work

- Approval file lookup and artwork crop preview
- Approval viewer modal
- Print-card file lookup and viewer modal
- Download and print actions
- Revision history timeline
- Deep-linking selected G# in the URL
- Editing and record management
