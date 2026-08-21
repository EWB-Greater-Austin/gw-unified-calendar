# gw-unified-calendar

Google Apps Script that syncs events from every member of a Google Group into a single unified Google Calendar. Built for EWB Greater Austin so the exec team can see every department's events in one place, and so the public site can embed one calendar instead of several.

## How it works

- A Google Group (`internal@ewbgreateraustin.org`) is the source of truth for which users get synced. Add/remove members in the Admin Console — no code change needed. (Fetches only the first 200 members — an accepted tradeoff since the group is well under that size.)
- A daily time-driven trigger runs `sync()` at ~3am.
- For each group member, the script does a **full fetch** (30 days back / 60 days forward, `showDeleted: true`) of their primary calendar via the Calendar v3 API on every run, and upserts events into the unified calendar. There is no incremental/sync-token mode.
- Only events where the member is the **organizer** are synced. This is how shared internal meetings avoid duplicates: the creator syncs it once; invitees' runs skip it.
- Each synced event is written with a **deterministic ID** (`SHA-1(memberEmail + ':' + sourceEventId)` as hex), so re-running a sync can never produce duplicates.

## Event payload

| Field | Value |
| --- | --- |
| Title | Copied from source |
| Description | `[organizer@ewbgreateraustin.org]` only — the source description is intentionally dropped (it can contain sensitive info like Zoom links) |
| Location | Empty, except for events organized by `operations@ewbgreateraustin.org`, whose location is preserved |
| Start / End / Status | Copied from source |

## Functions

| Function | Purpose |
| --- | --- |
| `sync()` | Entry point; called by the daily trigger |
| `syncBirthdays()` | Called by `sync()` inside its own try/catch; syncs birthday events from the roster sheet. No longer forces a yellow `colorId` — it wasn't visible on the Google Calendar HTML embed used on the website anyway, so it just took the calendar's default color instead |
| `setupTrigger()` | Run once manually to install the daily trigger (replaces any existing sync trigger) |
| `reset()` | Wipes **all** synced events from the unified calendar, including birthday history. Run before `sync()` when logic changes. There is no future-only reset option (removed intentionally). |

## Known tradeoffs

`sync.gs` was recently hand-simplified (dropped incremental sync, the series-cancellation sweep, and the future-only reset) in favor of a simpler full-sync model. Accepted tradeoffs from that pass:

- **Series-cancellation sweep no longer needed** — the `parentRef` sweep that used to clean up all instances of a cancelled recurring series was removed, safely: because syncing now queries by `timeMin`/`timeMax` with `singleEvents: true` instead of a sync token, Google's API returns a cancelled tombstone per individual instance (not one tombstone for the whole series) when a series is deleted, so the normal direct instance-ID removal cleans up every instance inside the sync window on its own. `parentRef` is still written on every instance but currently has no reader. The only gap: an instance whose date already fell outside the 30/60-day window when its series was deleted won't be swept up later — same as the general sync-horizon limitation.
- **Group membership capped at 200** — `getGroupMembers()` doesn't paginate through `nextPageToken`, so members beyond the first page of 200 would be skipped. Fine today since the group is well under 200; revisit if that changes.
- **No incremental sync** — every run does a full 30-day-back/60-day-forward fetch per member instead of using a stored sync token, trading some extra API calls for simpler code and no token-expiry edge cases.

## Google Workspace / GCP setup

- Internal calendar sharing must be set to **Share all information** in the Admin Console — otherwise the script cannot read individual calendars.
- The GCP project linked to the Apps Script must have both the **Apps Script API** and the **Admin SDK API** enabled.
- OAuth scopes (declared in `appsscript.json`):
  - `https://www.googleapis.com/auth/calendar`
  - `https://www.googleapis.com/auth/admin.directory.group.member.readonly`
  - `https://www.googleapis.com/auth/script.scriptapp`

## Local development

This project uses [clasp](https://github.com/google/clasp) to push/pull code from the Apps Script project.

```bash
# one-time auth with a GCP OAuth client
clasp login --creds ~/path/to/oauth-creds.json

# push local changes to Apps Script
clasp push

# pull cloud state down
clasp pull
```

`.claspignore` restricts the push to `appsscript.json` and `sync.gs` only.

## Deployment

After `clasp push`:

1. Open the Apps Script editor.
2. Run `setupTrigger()` once to install the daily trigger.
3. If logic changed, run `reset()` before the next `sync()` so old events don't linger.

## CI/CD — Bidirectional sync and versioning

A GitHub Actions workflow (`.github/workflows/sync.yml`) keeps this repo and the live Apps Script project in sync automatically. Every change that reaches `main` — from either side — produces a new patch version tag.

### How changes flow

| Trigger | Direction | What happens |
| --- | --- | --- |
| Merge / push to `main` | GitHub → Apps Script | `clasp push`, auto-bump patch tag (e.g. `v1.0.1`), new Apps Script version |
| Daily schedule (9am UTC) or manual run | Apps Script → GitHub | `clasp pull`; if changed, commit to `main`, bump patch tag, new Apps Script version |
| Manually pushed `v*` tag (e.g. `v2.0.0`) | GitHub → Apps Script | `clasp push`, Apps Script version using your tag — use this for major/minor bumps |

### Versioning rules

- **Patch bumps are automatic** — every merge to `main` and every Apps Script editor change increments the patch number (`v1.0.x`).
- **Major/minor bumps are manual** — push a tag yourself (`git tag -a v2.0.0 -m "..." && git push origin v2.0.0`) when a change warrants it. The workflow will sync it to Apps Script and create the matching version.
- Git tags and Apps Script versions are always kept in sync — each git tag corresponds to an Apps Script version with the same name.

### Triggering a manual sync

To pull Apps Script changes into GitHub on demand without waiting for the daily schedule:

1. Go to the **Actions** tab in this repo.
2. Select **Sync with Google Apps Script**.
3. Click **Run workflow** → **Run workflow**.

### Secret setup

The workflow authenticates to clasp using a `CLASPRC_JSON` repository secret containing the OAuth token from `~/.clasprc.json`. To refresh it after a token expiry:

```bash
clasp login --creds ~/path/to/oauth-creds.json
gh secret set CLASPRC_JSON --repo EWB-Greater-Austin/gw-unified-calendar < ~/.clasprc.json
```

## Config

All configuration lives at the top of `sync.gs`:

- `UNIFIED_CAL_ID` — the destination calendar
- `GROUP_EMAIL` — the Google Group whose members get synced
- `BIRTHDAY_SHEET_ID` / `BIRTHDAY_TAB_NAME` — the roster sheet and tab `syncBirthdays()` reads from

Note: the `sourceRef`/`parentRef` private extended-property keys used to be top-level `SOURCE_KEY`/`PARENT_KEY` constants; they're now inline string literals used consistently across `buildPayload()`, `insertBirthdayEvent()`, and `reset()`.
