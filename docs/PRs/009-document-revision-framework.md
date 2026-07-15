# PR 009 — Document Revision Framework

## Objective

Create one quiet, search-first workspace for every revision-related task in GraphicsFlow. Revision records remain in the background until a user deliberately searches for an Approval by G# or a Print Card by Spec#.

## First implementation

- Adds a dedicated Revisions page to the main navigation.
- Uses one explicit document-type selector: Approval or Print Card.
- Approval lookup is exact by G#.
- Print Card lookup is exact by Spec#.
- No default database list is shown.
- Displays the linked customer, part, G#, Spec#, current revision, and chronological revision journey.
- Combines legacy Print Card history with GraphicsFlow-managed document revisions.
- Establishes shared contracts and an API lookup service for future document types.
- Reuses the standard GraphicsFlow loading component.

## Revision principles

- Revision history is a document journey, not a generic table.
- The newest revision is current, but older revisions remain visible and immutable.
- Correcting metadata and creating a true document revision are separate actions.
- Full revision management lives here; other app areas link into this workspace contextually.
- Approval identity is anchored to G#.
- Print Card identity is anchored to Spec# while retaining its G# relationship.

## Next slices in this PR

- Wire Open Current to the existing Approval and Print Card viewers.
- Add Create Revision flows for both document types.
- Add safe Edit Information behavior without creating false historical revisions.
- Import structured legacy Approval revision history.
- Add revision comparison and direct deep links from the Graphics inspector.
