# Changelog

## [v1.1.0] — Unreleased

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
