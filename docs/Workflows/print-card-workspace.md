# Print Card Workspace Workflow

## Entry

The workspace receives the selected Graphics record. During PR 008 it may be opened from the temporary test entry point; the component remains independent so it can later launch from the Graphics Record Inspector.

## 1. Load Defaults

GraphicsFlow loads:

1. canonical V3 graphics metadata;
2. latest V3 Print Card revision;
3. latest Approval revision metadata;
4. live Approval PDF fields when structured values are missing;
5. isolated legacy read-only history during migration.

Each populated value includes a source label for the workspace provenance badge.

## 2. Prepare Artwork

The user selects a 9 × 4 inch PDF. The server converts page one to a 2700 × 1200 pixel image at 300 DPI. The converted image is used for the creator thumbnail and Production Preview Workspace. The browser PDF viewer is not part of the workflow.

When intentionally rebuilding only the information panel, Replace Existing Image permits the existing 9-inch artwork to be preserved.

## 3. Verify Metadata

The workspace displays Spec #, Design #, Revision, Revision Date, Description, CSR, and Designer. Approval revision-table values are preferred for CSR and Designer before PDF-wide fallback fields when available.

Source badges identify Approval, Previous Print Card, GraphicsFlow/system, Manual, and Required values.

## 4. Confirm Readiness

The workspace calculates readiness from:

- artwork PDF or approved existing-art replacement mode;
- Spec #;
- Revision;
- Revision Date;
- Description;
- CSR;
- Designer.

Generate Print Card remains disabled while required inputs are missing. Server validation remains authoritative.

## 5. Inspect Production Layout

The creator shows a compact 10 × 4 thumbnail. Open Production Preview launches the dedicated inspection workspace with:

- Fit;
- 100%, 200%, and 400%;
- wheel zoom;
- drag pan;
- Escape close.

The revision table follows the four-row production rule. Revisions fill from the first row forward. Once more than four revisions exist, the oldest visible row drops off and the newest revision occupies the fourth row.

## 6. Generate

The server:

1. validates the request;
2. resolves the selected Graphics record;
3. converts or preserves artwork;
4. renders the 1 × 4 information panel;
5. assembles a 3000 × 1200 pixel JPG;
6. writes to a temporary file;
7. saves canonical document/revision metadata;
8. atomically moves the completed JPG to the configured Print Card root;
9. refreshes the live-file index;
10. returns the created revision and file metadata.

A failed render or persistence operation must not leave a partial production file or false revision.
