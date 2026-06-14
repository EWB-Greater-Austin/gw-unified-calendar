# Changelog

## [v1.1.3] — 2026-06-14

### Changed
- **Birthday events now retain a permanent historical record**: each year's occurrence is written with a year-specific event ID (`birthday:<name>:<year>`) and is never updated or deleted after the day passes. Previously, the single per-person event was mutated each year, erasing the prior occurrence.
- **Birthday cleanup removed**: events for members removed from the roster are no longer deleted — historical birthday events persist on the calendar indefinitely.

---

## [v1.1.2] — 2026-06-14

### Fixed
- **410 "Resource has been deleted" treated as fatal**: `isNotFound()` previously only handled 404 responses. Attempting to delete or get an already-deleted calendar event returns a 410, which was re-thrown and aborted the entire member's sync run. `isNotFound()` now also matches 410 and "Resource has been deleted" — all three call sites (`removeCancelledEvent`, `unifiedEventExists`, birthday cleanup) benefit from the fix.

---

## [v1.1.1] — 2026-06-14

### Fixed
- **Orphaned events after full re-sync**: Full re-syncs (triggered by sync token expiry or `resetSync()`) now include `showDeleted: true`, so cancelled events within the sync window are returned by the API and removed from the unified calendar. Previously, meetings cancelled during a sync gap would persist as orphans indefinitely since their tombstones are never replayed in future incremental syncs.

---

## [v1.1.0] — 2026-04-23

### Added
- **Birthday sync**: `syncBirthdays()` reads the "Chapter Project Roster" Google Sheet (tab: `Birthday`) and creates a yellow all-day "🎂 [Name]'s birthday!" event in the unified calendar for each member's next upcoming birthday. Events are automatically removed when a member is taken off the sheet.
- **Location for operations events**: Events organised by `operations@ewbgreateraustin.org` now include the source location field in the unified calendar. All other members' events continue to have location stripped.

### Fixed
- **CI authentication**: Replaced the user OAuth refresh token (`CLASPRC_JSON` secret) with a service account key (`GOOGLE_SA_KEY`). The old approach failed periodically with `invalid_rapt` due to Google Workspace re-authentication policies; service accounts are not subject to that policy.

### Changed
- `appsscript.json`: added `spreadsheets.readonly` OAuth scope to support Sheet access.
- Corrected stale comment on `syncCalendars()` — trigger runs daily, not hourly.
- When a manual `v*` tag is pushed, the CI now automatically deletes the auto-generated patch tag on the same commit (e.g. `v1.0.1` is cleaned up when `v1.1.0` is pushed manually).

---

## [v1.0.0]

Initial release. Daily sync of Google Calendar events from all `internal@ewbgreateraustin.org` Google Group members into a single unified calendar, with deterministic SHA-1 deduplication and incremental sync tokens.
