# Decision 005 — Read-Only Live Files and Managed Documents

## Decision

GraphicsFlow treats configured production folders as read-only source systems.

The application may:

- discover and index live files;
- read files for previews and viewers;
- copy a source file into temporary working storage;
- use a live file as input to a creator;
- allow the user to download a generated document.

The application must not:

- modify, overwrite, rename, move, or delete a live source file;
- silently replace an Approval PDF, artwork PDF, or production Print Card image;
- use a generated application document as permission to alter an external production folder.

## Print Card Artwork Selection

The Print Card workspace searches the configured PDF artwork folder for PDFs matching the selected G#.

Matches are ranked for presentation:

1. exact `G#-PC` / Print Card naming;
2. other names containing `PC` or `PRINT CARD`;
3. exact G# approval artwork;
4. other PDFs containing the G#.

When one match exists, it may be selected automatically. When multiple matches exist, the user chooses the source. A manual upload remains available and overrides the live selection for the current revision only.

All live PDFs remain read-only. Rendering uses a temporary copy.

## Managed Generated Output

Generated Print Card JPG files are stored in GraphicsFlow-managed document storage beside the V3 application data, not in the configured live Print Card/Image1 folder.

The generated file and its structured revision metadata belong to the canonical V3 document record. Users may download the JPG and decide whether to place or replace it in an external production system.

## Revision Readiness

Each V3 Print Card revision records:

- source artwork type (`live-pdf`, `uploaded-pdf`, or `existing-output`);
- source relative path or uploaded filename;
- managed rendered JPG path;
- revision metadata;
- legacy migration identity where applicable.

The Revisions workspace will use these fields to display, download, edit, and navigate revisions without reading data back from the JPG or changing live source files.
