# PR 003 — Company Settings Foundation

> **Objective:** Establish the company configuration and live-storage foundation that future GraphicsFlow file services, branding, and identifier behavior will use.

## Scope

### Settings storage

- Create a writable V3 SQLite database at `graphicsflow-v3/storage/graphicsflow-v3.db`.
- Keep the copied PHP `graphics.db` read-only and unchanged.
- Store company settings as validated JSON in the V3 settings database.

### Company Settings UI

- Company Profile
- Branding
- Identifiers
- Storage & Files
- Save state and unsaved-change feedback
- Responsive internal navigation

### Identifier configuration

Configure label, prefix, and optional separator for:

- Graphics Number
- Specification Number
- Design Number
- Print Card
- Factory Ticket Mini

Blank prefixes are valid.

### Storage configuration

Configure and check:

- Illustrator artwork root
- PDF artwork root
- Approvals root
- Print cards / factory tickets root
- Vendor approvals root

Folder checks are performed by the server and report configured, found, directory, readable, and writable states.

## Acceptance criteria

- `/settings` loads saved settings from the V3 database.
- Changes persist after restarting the app.
- Blank identifier prefixes save successfully.
- Color picker and manual HEX input remain synchronized.
- Storage paths can be checked from the UI.
- Missing or unmounted paths return a clear status without crashing the app.
- The PHP application and copied database remain unchanged.
- Users, passwords, roles, permissions, authentication, file searching, and document previews are not added.

## Local testing

```bash
git fetch origin
git switch agent/pr-003-company-settings-foundation
cd graphicsflow-v3
npm install
npm run dev
```

Open `http://localhost:5173/settings`.

Test saving every section, restarting the app, reloading settings, blank prefixes, color inputs, and folder connection checks.

## Deferred work

- User accounts and password hashing
- Authentication and sessions
- Roles and granular permissions
- Logo upload and managed brand assets
- Applying saved branding to the application shell
- Live file indexing and lookup
- Approval and print-card previews
