# Creator Workspaces

## Purpose

GraphicsFlow creators are task-focused desktop workspaces, not generic web forms. A creator helps the user prepare a production document quickly, understand where imported values came from, inspect the expected output, and commit the final result.

The first implementation is the Print Card Workspace in PR 008. Approval Creator and future document creators should reuse the same interaction model.

## Workspace Structure

A creator workspace has two primary regions:

1. **Editor** — artwork selection, production metadata, source provenance, readiness, history, and the final create action.
2. **Production thumbnail** — a compact representation of the output with an action to open the dedicated Production Preview Workspace.

The thumbnail confirms that the correct artwork and overall layout are present. It is not expected to make small production text fully legible.

## Production Preview Workspace

Detailed inspection is separated from creation. The large preview opens over the creator and provides:

- a centered 10 × 4 production card;
- Fit, 100%, 200%, and 400% controls;
- mouse-wheel zoom;
- drag-to-pan interaction;
- Escape-to-close behavior;
- the converted artwork and the same structured revision data used by production rendering.

This distinction prevents the creator layout from becoming excessively wide while still supporting accurate inspection.

## Source Provenance

Every imported field displays a compact source badge. Current source categories are:

- **Approval** — read from Approval metadata or its revision table;
- **Previous Print Card** — carried forward from canonical or migrated Print Card history;
- **GraphicsFlow** — calculated or supplied by system metadata, such as today or next revision;
- **Manual** — user-entered value without an imported source;
- **Required** — an incomplete value that blocks generation.

Source labels must explain where the value came from without forcing the user to inspect logs or remember workflow rules.

## Production Readiness

The workspace computes a readiness percentage from required production inputs. Missing inputs are listed explicitly, and Generate Print Card remains disabled until all required values are present.

Readiness is guidance, not a replacement for server validation. The API remains authoritative.

## Reuse

Future creators should share reusable workspace primitives for:

- source badges;
- readiness summaries;
- artwork intake;
- compact production thumbnails;
- full-screen preview controls;
- zoom and pan behavior;
- unsaved-change protection;
- final production actions.

The implementation may begin in a feature component, but repeated patterns should move into a shared Document Workspace framework when the Approval Creator is introduced.
