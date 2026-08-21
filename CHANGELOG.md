# Changelog

## [v2.0.0] — 2026-08-21

### Changed
- **Simplified to a full-sync model**: incremental sync via Google sync tokens has been removed entirely. `syncMember()` now does a full 30-days-back/60-days-forward fetch with `showDeleted: true` on every run, for every member. There is no more `syncToken_<email>` in `ScriptProperties` and no 410-token-expiry handling — trades some extra Calendar API calls per run for simpler code and no token-expiry edge cases.
- **Renamed entry point**: `syncCalendars()` → `sync()`. `setupTrigger()` and the CI/deployment docs now reference `sync`.
- **Renamed `resetSync()` → `reset()`**: same full-wipe behavior (still destroys the permanent birthday history), now the only reset path — see Removed.
- **`sourceRef`/`parentRef` are now inline string literals**: the `SOURCE_KEY`/`PARENT_KEY` top-level constants were dropped in favor of literal `'sourceRef'`/`'parentRef'` strings used consistently in `buildPayload()`, `insertBirthdayEvent()`, and `reset()`.
- **Event descriptions no longer copy the source description**: the unified event body is now just `[organizer@ewbgreateraustin.org]`. Source descriptions can carry sensitive info (e.g. Zoom links) that shouldn't be echoed onto a shared calendar.
- **Birthday events no longer forced yellow**: the explicit `colorId: '5'` (banana) on birthday events was removed; new/updated birthday events now take the calendar's default color. Reason: `colorId` isn't reflected on the Google Calendar HTML embed used on the website, so it was only ever visible in the Calendar UI itself — not worth the added complexity.
- **`syncBirthdays()` failure isolation**: it's now called from its own `try/catch` inside `sync()`, so a birthday-sync failure no longer aborts or gets conflated with member event-sync failures.

### Removed
- **`resetFutureSync()`**: the future-only reset that preserved birthday history is gone. `reset()` (full wipe) is now the only reset option.
- **Series-cancellation `parentRef` sweep**: `removeInstancesOfCancelledSeries()`, added in v1.2.0, was removed — safely, not as a regression. That sweep existed because sync-token-based incremental sync delivers a single cancellation tombstone keyed by the parent recurring-event ID when a whole series is deleted. The new full-window queries (`timeMin`/`timeMax` + `singleEvents: true`, no sync token) instead get a cancelled tombstone per individual instance in that case, so the existing direct instance-ID removal in `removeCancelledEvent()` now cleans up every instance on its own. `parentRef` is still written on every recurring instance but currently has no reader.

### Known tradeoffs
- **`getGroupMembers()` no longer paginates**: it fetches only the first page (up to 200 members) via `AdminDirectory.Members.list()`. Accepted since the group is well under 200 members today; revisit if that changes.

---

## [v1.2.0] — 2026-08-10

### Fixed
- **Deleting an entire recurring series left orphaned events on the unified calendar**: series instances are synced under per-instance deterministic IDs, but a series-level deletion delivers a single cancellation tombstone carrying the *parent* recurring-event ID — the direct ID removal matched nothing and the orphans persisted indefinitely. Synced instances now store a `parentRef` private extended property (`<email>:<recurringEventId>`), and every cancellation additionally sweeps the unified calendar for matching `parentRef` entries and removes them. Individually cancelled occurrences continue to be removed via the direct instance-ID path.

### Added
- **`resetFutureSync()` utility**: wipes all synced events (those carrying `sourceRef`) starting from now onward, clears all sync tokens, and immediately re-runs `syncCalendars()` to repopulate. Unlike `resetSync()`, past events — including the permanent historical birthday record — are untouched. Use it to purge stale or orphaned future events (e.g. remnants of series deleted before the `parentRef` fix, which cannot be cleaned retroactively because their tombstones were already consumed). A side benefit: the refill stamps `parentRef` onto all future recurring instances, backfilling events synced before this release.

---

## [v1.1.4] — 2026-06-14

### Changed
- **Renamed `upsertBirthdayEvent` to `insertBirthdayEvent`**: since each year's birthday now gets its own permanent event rather than mutating a single record, the function is no longer an upsert in any meaningful sense.

---

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
