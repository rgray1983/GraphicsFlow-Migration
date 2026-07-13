# GraphicsFlow Product Principles

> These principles define how GraphicsFlow should feel, behave, and evolve. If a future implementation conflicts with these principles, the implementation should change—not the principles—unless there is a compelling reason to evolve them.

## 1. GraphicsFlow is a Product, Not a Migration

Graphics Manager 2.0 is a behavioral reference, not an architectural reference.

Preserve proven workflows while replacing legacy implementation with modern architecture whenever it improves maintainability, usability, performance, or scalability.

When forced to choose between how Graphics Manager did it and how GraphicsFlow should work, GraphicsFlow wins.

## 2. One Workspace Per Graphic

Everything related to a G# should be available without leaving the Graphics workspace whenever practical.

Users should not have to hunt through Finder, Windows Explorer, network folders, or shared drives. GraphicsFlow should locate the information for them.

## 3. The Document Is the Hero

Artwork, approvals, print cards, specifications, and supporting documents are the focus.

The interface exists to support the document, not compete with it. Buttons and metadata should never overpower the content the user opened.

## 4. Prefer Familiar Professional Interactions

Use interaction patterns users already know from Illustrator, Acrobat, ArtiosCAD, and other professional tools whenever they improve usability.

Do not reinvent muscle memory simply to be different.

Examples include:

- Spacebar + drag to pan
- Pinch to zoom
- Ctrl/Cmd + scroll to zoom
- Escape to close

## 5. Every Input Method Matters

Major workflows should work well with:

- Mouse
- Keyboard
- Touch
- Stylus

Office staff, designers, QC personnel, and production teams should all feel that GraphicsFlow was designed for them. No device or input method should feel secondary.

## 6. Performance Is a Feature

Index once. Cache intelligently. Generate expensive assets only when needed. Never repeat costly work without a reason.

Fast software reduces friction and stress.

## 7. Live Files Are the Source of Truth

GraphicsFlow should index, locate, preview, print, and download production documents from their configured source folders.

It should not become another uncontrolled storage location or duplicate ownership of production files.

## 8. Cache Is Disposable

Generated previews and other cache assets exist only to improve responsiveness.

They are not production assets and must always be safe to delete and rebuild from authoritative source documents.

## 9. Build Services Before Features

Reusable services should be created before feature-specific interfaces when practical.

Examples include:

- File Index Service
- Preview Service
- Record Inspector
- Company Settings
- Graphic Metadata

A strong service should make several future features easier, not solve only one screen.

## 10. Shared Components First

Repeated interaction and visual patterns should become reusable components.

Examples include:

- Inspectors
- Viewers
- Toolbars
- Status badges
- Progress indicators
- Metadata grids

Consistency reduces maintenance and improves user confidence.

## 11. Use Progressive Disclosure

The first experience should feel simple.

Advanced controls and deeper information should appear naturally when users need them rather than being shown all at once.

## 12. Architecture Over Convenience

Temporary shortcuts often create permanent maintenance.

When a choice affects long-term architecture, prefer the cleaner design even when it takes longer to implement.

## 13. Every Pull Request Has One Job

Each pull request should solve one focused architectural or workflow problem.

Document the intent, test it against the real production workflow, and merge only when it feels production-ready.

## 14. Polish Is Usability

Motion should guide attention. Loading states should reassure users. Spacing should improve readability. Controls should feel deliberate.

Polish is not decoration. It is part of how the software communicates.

## 15. Respect Existing User Muscle Memory

GraphicsFlow should reduce thinking, not introduce it.

When experienced users already understand an interaction from professional software, prefer that familiar behavior when it improves the workflow.

## 16. Canonical Data Lives in GraphicsFlow

GraphicsFlow should progressively become the canonical owner of application metadata, relationships, settings, and workflow state.

Legacy systems may provide source data during migration, but they should be isolated behind import or adapter layers rather than becoming permanent dependencies throughout the application.

## 17. Make Future Features Easier

Every architectural decision should make future work simpler.

Ask:

> What future features become easier because we built it this way?

## Final Principle

GraphicsFlow should feel like software people enjoy using, not software they are forced to use.
