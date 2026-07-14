# DEC-004 — Separate Creation from Production Inspection

- **Status:** Accepted
- **Date:** 2026-07-14
- **Applies to:** Print Card Creator, Approval Creator, future document creators and viewers

## Context

Production documents such as a 10 × 4 Print Card have a wide physical aspect ratio and contain small text that cannot be inspected reliably inside a normal editor column. Expanding the entire creator to make the embedded preview legible would stretch form controls, reduce hierarchy, and still provide an inferior inspection experience.

The creator and the production preview also answer different questions:

- The creator asks whether the correct inputs, artwork, and metadata are ready.
- The production preview asks whether the final output is visually accurate at useful zoom levels.

## Decision

GraphicsFlow will separate these responsibilities.

Creator workspaces will include a compact live thumbnail for orientation and a prominent **Open Production Preview** action. Detailed inspection will occur in a dedicated, nearly full-screen preview workspace with zoom and pan controls.

The preview must use the same converted artwork and structured document data used by the production rendering pipeline. It must not use an unrelated approximation or browser PDF viewer.

## Consequences

### Positive

- Creator layouts remain focused and readable.
- Wide documents can be inspected at meaningful zoom levels.
- Zoom and pan behavior becomes reusable across Print Cards, Approvals, revisions, and comparison tools.
- Users can distinguish input preparation from final inspection.
- The design better matches desktop creative software conventions.

### Tradeoffs

- The application maintains two preview presentations: a thumbnail and a large workspace.
- The large workspace requires interaction and keyboard handling beyond a basic modal.
- Reusable preview primitives should be extracted once the second document creator adopts the pattern.

## Related Decisions

- Desktop-first application behavior
- Inspector-launched document workflows
- Source provenance for imported production values
