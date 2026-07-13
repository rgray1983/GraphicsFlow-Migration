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

### Reusable record inspector pattern

Record inspection uses a shared `RecordDrawer` shell and `RecordInspector` section system. Feature-specific inspectors supply their own fields and content.

**Reason:** Preserve consistent motion and hierarchy while allowing graphics, revisions, approvals, print cards, vendor art, and other records to use the same interaction pattern.

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

### V3 configuration is stored separately from the PHP reference database

Company settings and future V3 application data use a separate writable database in `graphicsflow-v3/storage`. The copied PHP `graphics.db` remains a read-only behavioral and data reference.

**Reason:** V3 must be able to evolve safely without mutating the known-good Graphics Manager 2.0 copy.

### File access is restricted to configured server roots

The browser never receives arbitrary filesystem access. Company Settings defines approved storage roots, and the backend validates and accesses only those locations.

**Reason:** Enable live production-file access while keeping network and local filesystem exposure controlled.

### Authentication is separate from company configuration

Users, password hashes, roles, and permissions will be implemented in dedicated security PRs rather than bundled into Company Settings foundation work.

**Reason:** Security-sensitive behavior requires focused architecture, testing, and review.

### Live documents remain in their source folders

GraphicsFlow resolves approvals and print cards from the storage roots configured in Company Settings. It records and displays file metadata without uploading or duplicating the production source file.

**Reason:** Keep one authoritative document, eliminate manual revision uploads, and ensure users see the current live file.

### Live-file lookup uses a persistent index

Configured approval and print-card roots are scanned by a server-owned background job. Searchable metadata is stored in the V3 database, and G# inspectors query that index instead of crawling network storage on every click. Matching uses exact normalized numeric identifiers.

**Reason:** Pay the network cost during a controlled refresh so the daily record-browsing workflow remains fast and similar G# values cannot collide.

### Long-running jobs belong to the server

File indexing continues independently of the Settings page. The browser starts the job and polls its status, but navigating away or closing the tab does not cancel server work. Only one index job may run at a time.

**Reason:** Administrative maintenance should not depend on keeping one browser view open.

### Progress reporting must be honest

The first file-index run uses indeterminate progress because the final file count is unknown. Later runs may estimate percentage and remaining time from the prior completed index while still showing current phase, scanned entries, discovered files, and elapsed time.

**Reason:** Visible progress builds trust, but invented precision is worse than an honest unknown state.

### Preview assets are disposable cache, not source documents

Approval thumbnails and medium previews are generated into a managed preview cache. Source modified time, size, location, record, and variant form the cache fingerprint. Production PDFs remain the source of truth.

**Reason:** Deliver fast browser previews without duplicating or replacing authoritative production files.

### Preview generation is a centralized service

Inspectors and future viewers request previews through one backend service. The service detects ImageMagick or Ghostscript, generates the first PDF page, caches the result, and returns a clear unavailable state when the server has no supported renderer.

**Reason:** Keep rendering, invalidation, cache storage, and error handling consistent across every feature that needs a visual document preview.

## 2026-07-13

### Approval viewing uses cached imagery and live source actions

The Approval Viewer uses a cached browser-friendly image for fast zooming and panning. Print and download actions resolve and stream the original live PDF through a server endpoint that validates the real file path remains within the configured Approvals root.

**Reason:** Keep viewer interaction fast while ensuring printed and downloaded documents remain the authoritative production PDF and arbitrary filesystem paths are never exposed.
