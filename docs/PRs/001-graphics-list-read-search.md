# PR 001 — Graphics List: Read and Search

## Goal

Create the first complete GraphicsFlow V3 feature slice by reading existing graphics records from the copied Graphics Manager SQLite database and presenting them in a searchable React interface.

## PHP reference

Primary reference:

- `PHP version/index.php`
- `PHP version/graphics.db`

The existing `graphics` table contains the core G# record fields used by this feature:

- `id`
- `g_number`
- `customer_number`
- `customer_name`
- `part_number`
- `preview_image`
- `created_at`

## Scope

### Backend

- Open the configured SQLite database in read-only mode.
- Add a centralized graphics repository.
- Add `GET /api/graphics`.
- Support search across G#, customer number, customer name, and part number.
- Return a typed response containing records, total count, and normalized query.
- Validate query parameters with shared Zod schemas.

### Frontend

- Replace the Graphics placeholder route with a real Graphics page.
- Add debounced search.
- Display records in a responsive table.
- Include loading, empty, database-error, and request-error states.
- Show the number of matching records.
- Display G# values through the shared identifier formatter so stored prefixes are never duplicated.

### Shared formatting

- Add centralized formatters for G#, S#, D#, and revision labels.
- GraphicsFlow V3 will use **S#** as the user-facing label for **Spec#**.
- Legacy F# values may remain in the copied database, PHP code, and file names during migration, but V3 formatters will display them as S#.
- Database-field renaming is deferred until the related print-card and approval workflows are rebuilt and verified.

### Documentation

- Add the GraphicsFlow V3 workflow and safeguard document.
- Add this numbered PR plan in `docs/PRs/`.

## Acceptance criteria

- The app starts with `npm run dev` from `graphicsflow-v3/`.
- Opening `/graphics` loads records from `PHP version/graphics.db`.
- Search matches G#, customer number, customer name, and part number.
- Clearing search restores the default record list.
- G# values display once, whether the stored value is `12905` or `G#12905`.
- No create, edit, delete, approval, preview, or print-card behavior is added in this PR.
- `PHP version/` remains unchanged.

## Local testing

```bash
git fetch origin
git switch agent/pr-001-graphics-list
cd graphicsflow-v3
npm install
npm run dev
```

Open:

```text
http://localhost:5173/graphics
```

API check:

```text
http://localhost:3001/api/graphics
http://localhost:3001/api/graphics?search=128
```

## Deferred work

- Create graphics records
- Edit graphics records
- Delete graphics records
- Artwork and PDF previews
- Approval and print-card actions
- Pagination controls beyond the initial result limit
- Safe schema and file-naming migration from legacy F# terminology to S# terminology
