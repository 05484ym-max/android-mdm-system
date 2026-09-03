# App Update Check — Backend/Admin Support

Owner: Claude (Backend / Admin)
Branch: `app-update-check` (based on `app-store-categories`)
Android App Store UI: GPT (`dpc-app/**`) — not implemented as part of this
change.

## The problem, stated precisely

"Does this specific device need to update this specific app?" is a question
only two things can answer authoritatively:
1. **The device itself**, via `PackageManager` reading its own installed
   `versionCode` — cheap, local, always correct about *what's installed*.
2. **Google Play**, for a specific authenticated device/account, which
   knows the real rollout/track/eligibility state for that exact device.

**Our backend has neither.** It only ever has Google Play's **public,
unauthenticated listing page** for a package (scraped via
`playStoreSearch.js` → `google-play-scraper`), cached fleet-wide. That
metadata:
- Is not device-specific — one cached value serves every device with that
  app, regardless of their individual rollout stage.
- Can be delayed relative to what Play is actually serving right now.
- Can be genuinely ambiguous for apps that ship different APKs to
  different device configurations (Play's public listing then reports the
  version as the literal string `"Varies with device"` — not a real,
  comparable version at all).
- Comes from an unauthenticated scrape, which can fail outright (network,
  Play HTML changes, rate limiting) with no fallback data source.

**Therefore: the backend must never claim "update available" as fact.**
This document describes what it does instead — model the *trustworthiness*
of what it knows, explicitly, and leave the actual per-device answer to a
mechanism that can really give it (see "Recommended Android flow" below).

This is an explicit, deliberate design constraint, not an oversight: no
migration to Android Management API / Google Android Device Policy was
made or is proposed here — the custom Device Owner architecture is
unchanged (see "Alternative mechanisms" for what a real device-specific
signal *would* require, and why it's out of scope here).

## What changed, in one sentence

`apps_catalog` already had `play_metadata_checked_at` and
`play_metadata_error` columns (from the original Play-metadata-refresh
work) that were tracked internally but **never read back or exposed** by
`listAppsCatalog()`. This change exposes them (as
`playMetadataCheckedAt`/admin-only `playMetadataError`), adds one new
computed field (`playMetadataFreshness`, a 3-state grade — never a
boolean), and does **not** add a single new database column. There is no
new migration in this branch at all.

## The three-state freshness model (`backend/playMetadataFreshness.js`)

```
playMetadataFreshness: 'fresh' | 'stale' | 'unknown'
```

Computed fresh on every read (`db.js`'s `mapCatalogRow`), from three
existing inputs — never stored as its own column, so it can never drift
out of sync with the data it's grading:

| Input state | Result | Why |
|---|---|---|
| `playMetadataCheckedAt` is `null` | `unknown` | Never checked at all — we have no confidence signal, positive or negative. |
| `playVersion` is `null`, empty, or the literal `"Varies with device"` | `unknown` | The version signal itself isn't a real, comparable value — this is the **rollout/multi-APK uncertainty** case. Even a check that happened five seconds ago can't be trusted here. |
| A `playMetadataError` is recorded on the last check | `stale` | We have real prior data, but the most recent attempt to refresh it failed — treated as "old", not "unknown", since there genuinely is data, just not current. |
| `now - playMetadataCheckedAt > 30 minutes` | `stale` | Data exists and the last check succeeded, but it's outside the freshness window (`PLAY_METADATA_FRESH_MS`, the same constant the auto-refresh worker already used — now imported from one place instead of duplicated). |
| None of the above | `fresh` | Recently checked, succeeded, and the version string is a real, comparable value. |

`fresh` is the only grade where the cached `playVersion`/`playUpdatedAt`
should be treated as meaningful at all by a consumer of this API — and
even then, it is public listing data, not a per-device guarantee (see
below).

## Field reference

### `GET /api/apps` (admin, existing endpoint — additive fields only)

| Field | Type | Notes |
|---|---|---|
| `playMetadataCheckedAt` | number \| null | Epoch ms of the last check attempt (success or failure). |
| `playMetadataFreshness` | `'fresh' \| 'stale' \| 'unknown'` | See table above. |
| `playMetadataError` | string \| null | Admin-only. The raw (truncated) scraper failure reason, when the last attempt failed. Never sent to devices. |

### `POST /api/devices/:deviceId/sync` (existing endpoint — additive fields only)

Every existing field (`packageName`, `name`, `iconUrl`, `playVersion`,
`playUpdatedAt`, and the categories-phase `category`/`categoryLabel`/
`isRecommended`/`sortOrder`) is **unchanged** — same name, same type, same
meaning. New, always present:

```json
{
  "packageName": "com.waze",
  "...": "... (unchanged existing fields) ...",
  "playMetadataCheckedAt": 1735689600000,
  "playMetadataFreshness": "fresh"
}
```

`playMetadataError` is **deliberately not sent to devices** — a raw
scraper error string is an admin diagnostic, not something a device needs
or should parse. Verified for real
(`test-app-update-signal-integration.js`, every scenario): the field is
entirely absent from the sync payload, not merely null.

No new endpoint was added. No existing field was renamed or removed.

## Recommended Android flow (not implemented here — GPT's follow-up)

1. **Default state for an installed, approved app: "מותקן" (Installed).**
   Never show "עדכן" (Update) from backend data alone.
2. Only when `playMetadataFreshness === 'fresh'` *might* the client choose
   to show a soft, non-committal hint (e.g. a small "ייתכן שיש עדכון" badge)
   — and even then, this is a hint to check, never a claim that an update
   exists.
3. **The real check happens by deep-linking to the Play Store listing
   itself** — Play Store, running with the device's real Google account
   and real rollout eligibility, is the only thing on-device that can
   answer "does this exact device have an update" correctly. This requires
   no new permission and no architecture change: it's the same
   intent-launching pattern the DPC already uses for `OPEN_PLAY_STORE_INSTALL`
   / `OPEN_PLAY_STORE_SYSTEM_COMPONENT` (see `backend/index.js`'s
   `ALLOWED_COMMANDS`), just aimed at the app's existing Play Store page:
   ```kotlin
   try {
       startActivity(Intent(Intent.ACTION_VIEW,
           Uri.parse("market://details?id=$packageName")))
   } catch (e: ActivityNotFoundException) {
       startActivity(Intent(Intent.ACTION_VIEW,
           Uri.parse("https://play.google.com/store/apps/details?id=$packageName")))
   }
   ```
   Play Store's own UI then shows "עדכן"/"פתח" correctly, because it has
   the one thing this backend structurally cannot: an authenticated,
   per-device answer.
4. Local `PackageManager.getPackageInfo(packageName, 0).longVersionCode`
   (already available to a Device Owner with zero extra permission) is the
   correct source for "what's actually installed on this device" — comparing
   it to the backend's `playVersion` string can be used as an **additional,
   still-heuristic** hint (version strings aren't guaranteed monotonically
   comparable across all apps), never as the final word.

## Automatic refresh — already existed, verified again here

Requirement: refresh Play metadata automatically, with no manual admin
action. This was **already implemented** before this branch
(`backend/index.js`):
- `kickAutoPlayMetadataRefresh()` fires once at server startup and once
  per `AUTO_PLAY_REFRESH_INTERVAL_MS` (5 minutes) via `setInterval(...).unref()`
  — independent of any device ever syncing.
- Every device `/sync` call also calls it — opportunistic, but never
  required for correctness.
- A global `AUTO_PLAY_REFRESH_MIN_KICK_MS` (60s) throttle and
  `db.claimAppsForPlayMetadataRefresh`'s Postgres-level
  `FOR UPDATE SKIP LOCKED` claim keep this bounded and safe across multiple
  backend instances — no burst against Google Play, no duplicate work.

**Verified for real in this branch**
(`test-app-update-signal-integration.js`, test 6): a genuinely
never-checked catalog row gets a real check *attempt* recorded
(`playMetadataCheckedAt` becomes non-null) purely as a side effect of a
device syncing — no admin panel click involved, observed end-to-end
against a real Postgres database and a real running server.

## Alternative mechanisms researched (documented, NOT implemented)

Per the task's own instruction: if a better-supported mechanism exists,
document it with exact references rather than silently changing
architecture. There is exactly one mechanism that provides a real,
Google-authoritative, per-device update signal — and it requires leaving
the current custom-Device-Owner architecture:

- **Android Management API** — `Device.applicationReports[]`
  (`ApplicationReport.versionCode` / `versionName`, reported per real
  device) compared against the managed Play catalog's
  `Application` resource for that package. Reference:
  `https://developers.google.com/android/management/reference/rest/v1/enterprises.devices#ApplicationReport`
  and `https://developers.google.com/android/management/reference/rest/v1/enterprises.applications`.
- **Legacy Play EMM API** (`androidenterprise`) — same idea, older API
  surface: `Products.get` /
  `https://developers.google.com/android/work/play/emm-api/v1/products/get`
  for the managed catalog's current version, compared against a managed
  device's reported installed version.

Both require enrolling devices as **Android Enterprise fully-managed
devices under Android Management API** (or the legacy Play EMM flow) —
i.e. exactly the migration this task explicitly ruled out
("Do NOT migrate to Android Management API / Google Android Device
Policy"). No code here moves toward that; it's recorded so the tradeoff is
visible if the constraint is ever revisited, per instruction — **no
architecture change was made without approval, and none is proposed
without it**.

## Tests

- `backend/test-play-metadata-freshness.js` — 13 pure unit tests (no DB/
  network): fresh, stale (by age), stale (recorded error takes priority
  even over a fresh timestamp), the "Varies with device"/null rollout-
  uncertainty case → `unknown`, never-checked → `unknown`, the exact
  freshness-window boundary, no-throw on partial input.
- `backend/test-app-update-signal-integration.js` — 7 real-Postgres +
  real-HTTP integration tests: fresh metadata (admin + sync), stale
  metadata, a recorded Play lookup failure (admin sees the reason, sync
  never does), rollout/version-mismatch uncertainty end-to-end, a fully
  backward-compatible sync response (every pre-existing field present,
  unrenamed, correctly typed, even for a genuinely pre-migration row with
  no check history at all), the same for `GET /api/apps`, and a real,
  no-admin-action-required automatic refresh triggered purely by a device
  sync (waits out the real 60s cross-process throttle rather than mocking
  the clock).
- Full regression re-run clean: `test-app-categories.js` (11/11),
  `test-app-catalog-integration.js` (20/20), `test-app-catalog-ui-smoke.js`
  (13/13 — one pre-existing test-timing race in the sortOrder-persistence
  test, unrelated to this feature, was found and fixed: it waited on an
  `<input>`'s own value, which `.fill()` sets synchronously and proves
  nothing about the server round-trip; fixed to poll the real database
  value instead), `test-db.js` (clean).

## What the backend can and cannot know (explicit summary)

**Can know, and now exposes explicitly:**
- The last publicly-scraped `playVersion`/`playUpdatedAt` for a package,
  fleet-wide (not per device).
- When that data was last (attempted to be) refreshed.
- Whether the last refresh attempt succeeded, and if not, why.
- Whether the version signal itself is even usable for comparison (not a
  multi-APK "Varies with device" report).

**Cannot know, and will never fabricate:**
- Whether any specific device has this app installed at a version behind
  the cached one (no per-device installed-version reporting exists for
  catalog apps — only the DPC's own app version is reported, via
  `devices.current_version_code`, an unrelated existing mechanism).
- Whether Google Play would actually offer this device an update right now
  (staged rollouts, account/region eligibility, device compatibility gates
  — all invisible to an unauthenticated public scrape).
- Anything about an app once its check has failed enough that
  `playMetadataError` is set — that row is `stale`, not silently treated as
  current.

## Migration / backward compatibility

**No new database migration.** `play_metadata_checked_at` and
`play_metadata_error` already existed; this branch only reads them back
and adds one computed (never stored) field. `GET /api/apps` and
`POST /.../sync` both gained fields additively — no existing field was
renamed, removed, or changed in meaning. An old Android client (verified
by reading `ApiClient.kt` in the categories-phase work, unchanged since)
ignores unknown JSON keys and continues to work without modification.

## What remains unverified

Same real, honestly-reported limitation as the categories work: this
sandbox's outbound network policy blocks `play.google.com` outright
(verified — `CONNECT tunnel failed, response 403`), so a live Google Play
response containing a genuine `"Varies with device"` version, or a
transient real HTTP failure, could not be observed end-to-end here. Both
are exercised via the exact same downstream code path
(`db.addAppToCatalog` → `mapCatalogRow` → `computeMetadataFreshness`) with
inputs equivalent to what a real Play response would produce — the grading
logic itself is fully tested; only the live network round-trip is not.
