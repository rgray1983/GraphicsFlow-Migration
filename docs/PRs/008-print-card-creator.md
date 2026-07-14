# PR 008 — Print Card Creator

## Objective

Rebuild the Graphics Manager 2.0 Print Card Creator as a GraphicsFlow-owned TypeScript workflow that preserves the production output and proven PHP behavior while establishing reusable document-creation and viewing patterns for future Approval workflows.

## Product Direction

The creator is part of the selected G# workflow. It launches from the Graphics Record Inspector rather than a separate administrative workspace.

Inspector behavior implemented in this PR:

- No print card: **Create Print Card**
- Existing print card: **View Print Card** and **Create New Print Card**
- Revision navigation and editing will live in the dedicated Revisions workspace built in the next PR.

## Compatibility Contract

PR 008 preserves these behaviors from the working PHP application:

1. Resolve the selected G# and its current document metadata.
2. Read approval PDF form fields when available.
3. Combine V3 metadata, approval revision data, approval PDF fields, and legacy history for creator defaults.
4. Calculate the next numeric revision while preserving nonnumeric labels.
5. Render a 10 × 4 inch, 300 DPI production JPG.
6. Use the configured Spec # filename expected by the Image1 workflow.
7. Display the most recent four revision rows in the production information panel.
8. Replace the existing image without creating a false revision when **Replace Existing Image** is selected.
9. Keep the PHP database read-only.

## Implemented Architecture

### Print Card Defaults Service

Resolution order:

1. Canonical V3 graphics metadata
2. Latest V3 Print Card revision
3. Approval revision metadata
4. Live approval PDF fields
5. Isolated read-only PHP history fallback

The creator displays a source badge beside each imported value.

### Document Workspace

The Print Card Creator is a near-full-screen workspace containing:

- Selected graphics-record summary
- 9 × 4 inch artwork PDF upload
- Server-side artwork conversion
- Production metadata with source badges
- Production-readiness indicator
- Live 10 × 4 inch thumbnail
- Large production preview with zoom and pan
- Unsaved-change protection
- Explicit replacement confirmation

### Production Renderer

The renderer:

- Validates the uploaded PDF header.
- Renders the first page at 300 DPI.
- Validates that artwork uses the required 9:4 page ratio.
- Preserves artwork proportions rather than silently stretching the file.
- Builds the 1-inch information panel from structured data.
- Combines the 9-inch artwork and 1-inch information panel into a 3000 × 1200 JPG.
- Writes temporary files before replacing production output.
- Restores an existing JPG if persistence fails.
- Removes a newly-created orphan JPG if persistence fails.

### Replace Existing Image

Replacement mode matches the PHP intent:

- The existing 9-inch artwork can be preserved when no new PDF is supplied.
- The information panel is rebuilt from the edited metadata.
- An existing V3 current revision is updated instead of inserting a new revision row.
- No false revision is created solely because the JPG was rebuilt.

### Print Card Viewer

The viewer now provides:

- Zoom in/out and Fit
- Ctrl/Cmd + scroll zoom
- Spacebar + drag pan
- Pinch zoom and touch drag
- Print dialog without visible navigation to a new tab
- Download JPG
- Disabled **Edit Print Card** placeholder for the future Revisions workspace
- Structured Spec #, Design #, revision, revision date, description, CSR, and designer details beside the JPG

### Migration Preparation

`document_revisions` reserves:

- `legacy_source_table`
- `legacy_source_id`

A unique migration index prevents duplicate PHP revision imports. Legacy fallback reads ignore rows already migrated into V3.

## Deferred to the Revisions PR

- Importing all PHP `print_card_revisions` rows into canonical V3 records
- Print Card revision list and navigation
- Editing an existing Print Card revision
- Selecting an older revision in the viewer
- Revision comparison

## Deferred Beyond Revisions

- Authentication and role enforcement
- Approval Creator
- Approval revision migration and navigation
- Bulk Print Card creation

## Acceptance Criteria

1. A selected G# opens the creator from the inspector.
2. Approval-derived values populate automatically when available.
3. Missing values remain clearly editable and are never invented.
4. The production preview and renderer use the same structured revision data.
5. Artwork with an incorrect page ratio is rejected instead of distorted.
6. The resulting JPG is 3000 × 1200 pixels at 300 DPI.
7. The JPG is written atomically to the configured Print Card root.
8. New creation inserts a canonical V3 revision.
9. Replace Existing Image does not create a false revision.
10. Failed rendering or persistence leaves no orphan or partial final file.
11. The inspector refreshes its live file state after generation.
12. The viewer opens the current JPG with desktop and tablet navigation controls.
13. Structured metadata is readable without zooming into the JPG.
14. The PHP database remains read-only.
