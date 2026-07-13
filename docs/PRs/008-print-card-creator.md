# PR 008 — Print Card Creator

## Objective

Rebuild the Graphics Manager 2.0 Print Card Creator as a GraphicsFlow-owned TypeScript workflow that preserves the current production output and proven behavior while replacing the monolithic PHP implementation with reusable services, canonical revision data, and a creator component that can later open from the selected G# inspector.

## Product Direction

The creator is a daily Graphics workflow, not a separate administrative workspace.

During PR 008 it may be launched from a temporary development entry point for testing. The creator itself must remain independent of that entry point so it can later be mounted in the Graphics Record Inspector without being rewritten.

Future inspector behavior:

- No print card: **Create Print Card**
- Existing print card: **View Print Card** and **Create New Print Card**
- Revision navigation will later live in the Revisions area and consume the same canonical revision records created here.

## PHP Behavior Reviewed

The working PHP implementation currently combines several responsibilities inside the admin workflow:

1. Resolve an internal G# or vendor art identifier.
2. Match existing `print_card_revisions` rows by the base identifier.
3. Optionally filter by the legacy F#/future S# value.
4. Read approval PDF form fields through `pdftk` when available.
5. Map multiple legacy PDF field-name variations into print-card defaults.
6. Determine the latest revision and calculate the next numeric revision.
7. Preserve nonnumeric revision labels when numeric incrementing is not appropriate.
8. Build the displayed revisioned art identifier without changing the canonical base G#.
9. Render the production print card as a JPG.
10. Save the JPG using the legacy F#/future S# filename expected by the Image1 workflow.
11. Store revision metadata including S#/F#, D#, CSR, designer, revision, revision date, and description.
12. Support image replacement without creating a false revision where the existing workflow explicitly requires it.

These behaviors are the compatibility contract. The PHP code is a behavioral reference, not the architecture for V3.

## Architecture

### 1. Print Card Defaults Service

Server-owned service that returns a prepared creator model for one graphics record.

Resolution order:

1. Canonical V3 graphics metadata.
2. Latest V3 print-card revision.
3. Current approval revision metadata.
4. Live approval PDF fields when structured metadata is missing.
5. Isolated legacy read adapter during migration.

The response must identify where each imported value came from so the UI can distinguish reliable structured data from fallback extraction.

### 2. Approval Field Extraction Adapter

A server-only adapter around `pdftk` or another supported PDF form-field reader.

Responsibilities:

- Locate the current approval through the existing live-file service.
- Read AcroForm field values without modifying the PDF.
- Normalize field names.
- Map known legacy aliases into canonical fields.
- Return a clear unavailable state when the PDF is flattened or the extraction tool is not installed.

PDF extraction is a convenience fallback. Production-critical data is saved into GraphicsFlow when the print card is created and is never permanently dependent on OCR.

### 3. Canonical Print Card Revision Service

Use the existing V3 `graphics_documents` and `document_revisions` foundation.

PR 008 may extend the canonical model with print-card-specific structured fields where necessary, including:

- Graphic ID
- Document ID
- S# / legacy F# source value
- D#
- Revision label
- Revision date
- Description
- CSR
- Designer
- Source art identifier
- Rendered JPG relative path
- Creation source
- Created timestamp
- Created by placeholder for future authentication

Important searchable production fields should use real columns rather than relying entirely on generic key/value storage.

### 4. Print Card Render Service

Server-owned service responsible for creating the production JPG.

Requirements:

- Match the current PHP card dimensions, orientation, resolution, and visible layout.
- Preserve the existing revision table presentation and four visible revision rows where required by the production template.
- Render from structured data rather than reading text back from an old JPG.
- Write to a temporary file first.
- Validate that the output exists and is nonempty.
- Atomically move the completed file into the configured Print Cards/Image1 root.
- Never leave a partially rendered production file at the final destination.
- Return structured file metadata to the caller.

The render implementation may use ImageMagick or a generated intermediate format, but command execution must remain isolated behind this service.

### 5. Print Card Creator Component

Reusable modal/workflow component that receives a selected `GraphicRecord`.

Initial form sections:

- Graphics Record summary
- Auto-filled identifiers
- Current revision/default source status
- New revision data
- Print card preview
- Final create action

The component must support mouse, keyboard, touch, and stylus input where practical and protect unsaved changes.

### 6. Transaction and File Safety

Creation is a coordinated operation:

1. Validate request and permissions placeholder.
2. Resolve the graphics record.
3. Calculate the next revision inside a transaction-safe server operation.
4. Render to a temporary location.
5. Move the JPG into the configured production root.
6. Save the canonical document and revision rows.
7. Update the document's current revision.
8. Refresh or repair the live-file index entry.
9. Return the created revision and file metadata.

If database persistence fails after file creation, the server must remove or quarantine the uncommitted output instead of silently leaving an orphan file.

## Terminology

User-facing terminology is **S#** / **Spec #**.

The PHP database and existing Image1 filenames may continue to use legacy `f_number` conventions inside the migration adapter. New UI and canonical V3 services must not expose F# as a second name for the same concept.

## Scope

- Review and map all current PHP print-card behaviors.
- Add shared schemas for defaults, create input, revision output, and render status.
- Add server services for defaults, approval extraction, revision creation, and JPG rendering.
- Add validated API endpoints.
- Add the reusable Print Card Creator UI.
- Add a temporary testing launch point without coupling the creator to it.
- Generate a print card matching the PHP production output.
- Write the JPG to the configured print-card root.
- Save canonical V3 document/revision data.
- Refresh the selected record and show a reusable success toast.
- Document implementation and testing.

## Deferred

- Final inspector button/state integration.
- Print Card Viewer.
- Unified Revisions navigation.
- Revision comparison.
- Authentication and role enforcement.
- Approval Creator.
- Bulk print-card creation.

## Acceptance Criteria

1. A selected G# opens the creator with its record data already populated.
2. Approval-derived values populate automatically when available.
3. Missing or flattened approval fields produce clear editable blanks, not invented values.
4. The next revision is calculated from canonical history with an isolated legacy fallback during migration.
5. The resulting JPG visually and dimensionally matches the working PHP output.
6. The JPG is written to the configured production root with the expected S#/legacy filename convention.
7. Structured revision data is saved in V3 and can be consumed later without reading the JPG.
8. Failed rendering or persistence leaves no partial final file or false revision.
9. The PHP database remains read-only.
10. The creator can later be launched from the record inspector without architectural changes.
