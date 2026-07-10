# GraphicsFlow Product Decisions

This document records important product and architecture decisions so the reasoning remains visible as GraphicsFlow V3 grows.

## 2026-07-10

### GitHub is the source of truth

The latest `main` branch is the source of truth. Every feature starts from the latest merged code and is delivered through one focused, testable pull request.

**Reason:** Prevent stale-file work, preserve a clear history, and keep local testing aligned with the repository.

### Graphics page is the primary record workspace

The Graphics page should let users find a G# and inspect its connected information without navigating to separate pages whenever practical.

**Reason:** Reduce context switching and make the most common lookup workflow faster.

### Record details use a persistent right-side drawer

Selecting a graphics row opens a right-side record drawer. Selecting another row updates the open drawer instead of closing and reopening it.

**Reason:** Support fast record browsing while keeping details anchored in a consistent location.

### Approval preview is the canonical artwork preview

GraphicsFlow will use the artwork area from the approval as the primary record preview when an approval is available. Direct Adobe Illustrator preview generation is not part of the initial architecture.

**Reason:** The approval is more reliable, browser-friendly, and represents the artwork that was actually approved.

### Approval and print-card viewers use focused modals

The drawer provides summary information and actions. Full approval and print-card viewing will happen in large reusable modal viewers over the current page.

**Reason:** Documents need more room than a drawer can provide, but users should remain in the Graphics workspace.

### Large record lists use internal scrolling

Large datasets scroll inside the available workspace instead of extending the entire page.

**Reason:** GraphicsFlow should behave like a focused desktop application rather than a long document page.

### Shared identifier formatting

G#, S#, D#, and revision labels use shared formatting utilities. User-facing terminology uses **S#** for **Spec#**. Legacy F# database fields and file names remain unchanged until those workflows are safely rebuilt.

**Reason:** Keep terminology consistent without prematurely breaking legacy data and file-processing behavior.
