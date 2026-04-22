# gw-unified-calendar

Google Apps Script that syncs events from every member of a Google Group into a single unified Google Calendar. Built for EWB Greater Austin so the exec team can see every department's events in one place, and so the public site can embed one calendar instead of several.

## How it works

- A Google Group (`internal@ewbgreateraustin.org`) is the source of truth for which users get synced. Add/remove members in the Admin Console — no code change needed.
- A daily time-driven trigger runs `syncCalendars()` at ~3am.
- For each group member, the script reads their primary calendar via the Calendar v3 API and upserts events into the unified calendar.
- Only events where the member is the **organizer** are synced. This is how shared internal meetings avoid duplicates: the creator syncs it once; invitees' runs skip it.
- Each synced event is written with a **deterministic ID** (`SHA-1(memberEmail + ':' + sourceEventId)` as hex), so re-running a sync can never produce duplicates.
- Incremental sync uses Google's **sync tokens**, stored per-member in `ScriptProperties`.

## Event payload

| Field | Value |
| --- | --- |
| Title | Copied from source |
| Description | First line: `[organizer@ewbgreateraustin.org]`, blank line, then source description |
| Location | Always empty (intentional — no addresses or conferencing links leaked) |
| Start / End / Status | Copied from source |

## Functions

| Function | Purpose |
| --- | --- |
| `syncCalendars()` | Entry point; called by the daily trigger |
| `setupTrigger()` | Run once manually to install the daily trigger (replaces any existing sync trigger) |
| `resetSync()` | Wipes all synced events from the unified calendar and clears sync tokens. Run before `syncCalendars()` when logic changes |

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
3. If logic changed, run `resetSync()` before the next `syncCalendars()` so old events don't linger.

## Config

All configuration lives at the top of `sync.gs`:

- `UNIFIED_CAL_ID` — the destination calendar
- `GROUP_EMAIL` — the Google Group whose members get synced
- `SOURCE_KEY` — the private extended-property key used to mark synced events (`resetSync()` uses this to find what to delete)
