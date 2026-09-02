# App Store — Categories, Search, Recommended, Sort

Owner: Claude (Backend / Admin)
Branch: `app-store-categories`
Android App Store UI: GPT (`dpc-app/**`) — not implemented as part of this
change; this document describes the server/admin side only.

This turns the flat `apps_catalog` table into a structured mini-app-store:
categories, admin-panel search/filter, a recommended flag, a manual sort
order, and a device sync payload with enough metadata for the Android App
Store to later render search, categories, an "עדכונים" (updates) section,
and a "מומלצות" (recommended) section using purely local filtering of
what's already synced — no new device-facing search/filter API was added
(see "Search behavior" below for why).

## Category keys (fixed V1 set)

Stable machine keys — these are what's stored in `apps_catalog.category` and
sent to devices. Hebrew labels are applied server-side
(`backend/appCategories.js`) so the admin panel and Android never need to
keep their own translation table in sync independently.

| key | label |
|---|---|
| `transport` | תחבורה |
| `communication` | תקשורת |
| `finance` | כספים |
| `navigation` | ניווט |
| `education` | לימודים |
| `games` | משחקים |
| `tools` | כלים |
| `shopping` | קניות |
| `health` | בריאות |
| `music` | מוזיקה |
| `video` | וידאו |
| `other` | אחר |

`"all"` / `"הכל"` is a UI-only filter state (admin panel and, later,
Android) — it is never a valid value for `apps_catalog.category` and is
rejected by server-side validation exactly like any other invalid string.

## Default category behavior

`apps_catalog.category` is `NOT NULL DEFAULT 'other'` at the schema level —
there is no code path, old or new, that can leave it null. Every
pre-existing row (added before this migration) automatically reads back as
`category: "other"` the moment this migration runs, with no backfill script
needed. The API and the device sync payload never return `category: null`.

## Category source and manual override protection

A new `category_source` column (`'MANUAL' | 'PLAY' | 'DEFAULT'`, admin-panel
only — never sent to devices) tracks who last set the category:

- `DEFAULT` — nobody has set it; it's sitting at `'other'` by schema default.
- `PLAY` — the last write came from `db.addAppToCatalog`'s `category`
  argument, itself derived from Google Play's `genreId` metadata (see
  below). Automatic and can still be silently updated by a later Play
  refresh.
- `MANUAL` — an admin explicitly chose it via
  `POST /api/apps/:packageName/catalog-meta`. **Permanent** until an admin
  changes it again through that same endpoint: every code path that writes
  Play-derived metadata (`addAppToCatalog`, called by
  `/api/apps/from-play`, the `refresh-play-metadata` batch endpoint, and
  the automatic fleet-wide refresh worker) checks
  `category_source = 'MANUAL'` first and leaves `category`/`category_source`
  completely untouched if so — regardless of what new suggestion Play
  metadata would otherwise produce. This is enforced in the SQL itself
  (`ON CONFLICT ... DO UPDATE`'s `CASE` branches in `addAppToCatalog`), not
  just as an application-layer convention, so there is exactly one place
  this guarantee can ever regress.

**Verified for real** (`backend/test-app-catalog-integration.js`, tests 3/4/4b):
a manual category survives a later refresh call with a different Play
suggestion, while a Play-sourced (never manually touched) category does get
updated by a later refresh, as intended.

## Automatic category suggestion from Google Play

`backend/appCategories.js` maps Google Play's own `genreId` taxonomy (as
returned by `google-play-scraper`'s `app()` call — see its `category` enum
in `node_modules/google-play-scraper/index.d.ts`) to the fixed V1 set above.
This is a deterministic lookup table against Play's own documented
categories, **not** a classifier or AI service — genres with no confident
fit (`LIFESTYLE`, `PARENTING`, `PHOTOGRAPHY`, `FOOD_AND_DRINK`, …)
intentionally map to nothing (`null`) rather than being forced into a
wrong-feeling bucket; the caller treats `null` exactly like "Play gave no
reliable category" and the row lands on `other`/`DEFAULT`, which an admin
can then set manually at any time.

**What could not be verified in this sandbox**: this environment's outbound
network policy denies all traffic to `play.google.com` (confirmed directly —
`curl` to it returns `CONNECT tunnel failed, response 403`, and the proxy's
own status endpoint logs `connect_rejected ... play.google.com:443`), so a
real end-to-end fetch of `genreId` from live Google Play data could not be
exercised here. What **is** verified for real:
- The `genreId` → category mapping logic itself, unit-tested against every
  documented Play genre value (`backend/test-app-categories.js`, 11 tests,
  no network needed).
- The storage/override-protection logic (`db.addAppToCatalog`,
  `updateAppCatalogMeta`), exercised against the exact same code path a real
  Play fetch would call, with category values equivalent to what the
  mapping function would have produced
  (`backend/test-app-catalog-integration.js`, tests 1–7).
- `playStoreSearch.getPlayStoreApp()`'s existing (already-shipped, already
  relied upon for `version`/`updated`) call to `google-play-scraper` is
  reused as-is; only one new field (`category`, computed from data that
  call already fetches) was added to its return value — no new network call,
  no new failure mode.

This is the same category of environment limitation documented for the
filtered-browser-server branch's PostgreSQL integration work: a real
dependency this sandbox cannot reach, reported honestly rather than
replaced with a mock and claimed as verified. A production/staging
environment with real Play access needs no server code change to confirm
this end-to-end — the mapping and storage logic are already fully tested.

## Admin catalog management (`admin-panel/index.html`)

The existing "חנות אפליקציות" catalog card (unchanged tabs: "אפליקציות
לכולם" / "הוספה ללקוח") gained, without any redesign:
- An organization preview (`עדכונים` / `מומלצות` / `כל האפליקציות` counts,
  plus a per-category count strip) — a plain read-only summary, not a fake
  mobile emulator.
- The search field (`חפש אפליקציה`) now also matches category (label or
  key), not just name/package.
- Category filter chips (`הכל | תחבורה | תקשורת | ...`), matching the
  existing chip/pill visual language already used for the sub-tabs.
- Per-app (in "אפליקציות לכולם" mode only — the per-customer assignment
  view is unchanged): a category `<select>`, a small badge showing whether
  that category is `ידני`/`מ-Play`/`ברירת מחדל`, a "☆ סמן כמומלצת" /
  "★ מומלצת" toggle, and a version-info line (`playVersion` +
  `playUpdatedAt`, or "אין נתוני גרסה מ-Play").

All three writes (category, recommended, sort order) go through the new
`POST /api/apps/:packageName/catalog-meta` endpoint — server-validated,
never trusting the dropdown's value directly (see "Validation" below).
Existing "add to catalog", "רענן אייקון" (icon refresh), "הוסף לכולם"
(assign-all), Google Play search/add, and per-customer assignment are all
unchanged.

Verified for real (`backend/test-app-catalog-ui-smoke.js`, 10/10 passed,
real headless Chromium + real backend + real Postgres): org preview counts,
category chips, search-by-category, category-filter-chip narrowing, a
category dropdown change persisting as `MANUAL` with the correct badge, and
a recommended-toggle click persisting `isRecommended` — all through the
actual rendered UI, not just the API layer.

## API

```
GET  /api/apps/categories
```
Returns the fixed category list (`[{ key, label }, ...]`) so the admin
panel never hardcodes its own copy.

```
POST /api/apps/:packageName/catalog-meta
{ "category": "tools", "isRecommended": true, "sortOrder": 5 }
```
All three fields optional and independent (send only what changed).
`category` must be one of the 12 fixed keys (400 otherwise, DB untouched).
`isRecommended` must be a boolean. `sortOrder` must be an integer in
`[0, 100000]`. At least one field is required (400 if the body has none of
them). Setting `category` here always stamps `category_source = 'MANUAL'`.
404 if the package isn't in the catalog. Returns the updated catalog row.

`GET /api/apps` (existing) now includes `category`, `categorySource`
(admin-only), `isRecommended`, `sortOrder` on every row, ordered
`sort_order ASC, name ASC` (previously `added_at DESC` — see "Sort
behavior" below for why this changed).

## Device sync contract (`POST /api/devices/:deviceId/sync`)

Additive only — every existing `catalog[]` field (`packageName`, `name`,
`iconUrl`, `playVersion`, `playUpdatedAt`) is unchanged in name, type, and
meaning. New fields, always present (never omitted) on every entry:

```json
{
  "packageName": "com.waze",
  "name": "Waze",
  "iconUrl": "https://...",
  "playVersion": "5.4.2",
  "playUpdatedAt": 1735689600000,
  "category": "navigation",
  "categoryLabel": "ניווט",
  "isRecommended": false,
  "sortOrder": 0
}
```

- `category` — stable machine key (never null; `"other"` for anything
  uncategorized).
- `categoryLabel` — Hebrew label, purely a convenience so Android doesn't
  have to ship its own copy of the label table; additive, ignorable.
- `isRecommended` — boolean.
- `sortOrder` — integer; Android should render in ascending `sortOrder`,
  then name, to match the admin panel and `GET /api/apps`'s own ordering.

An old Android client's JSON parsing (`ApiClient.kt`'s `CatalogApp`,
verified by reading it as instructed) reads named fields off each object
individually (`item.getString("packageName")`, etc.) rather than strictly
deserializing the whole object — it silently ignores keys it doesn't know
about. **No Android code change is required for backward compatibility**;
this was confirmed by reading the existing parsing code, not assumed.

**Policy boundary preserved**: `isRecommended`/`category` are computed from
`db.listAppsCatalog()` rows that have *already* been filtered down to
`allowed.has(app.packageName)` (the device's real approved-apps policy) —
a recommended app a device isn't approved for never appears in that
device's sync response at all, recommended or not. Verified for real in
`test-app-catalog-integration.js` (tests 11/12).

## Recommended semantics

`is_recommended` (boolean, default `false`) is purely a merchandising flag
an admin sets — it never implies assignment/approval on its own, and never
bypasses the existing per-device allowlist (see above). Android is expected
to use it only to decide which already-visible apps get a "מומלצות" shelf,
once GPT implements that UI.

## Sort behavior

`sort_order` (integer, default `0`) is a plain admin-settable number, not
drag-and-drop (out of scope for V1, per instruction — a numeric field is
sufficient and stable). `GET /api/apps` and the sync payload's `catalog[]`
are both ordered `sort_order ASC, then name ASC` — since every pre-existing
row defaults to `sort_order = 0`, the *effective* default ordering for a
catalog where no admin has set anything yet is simply alphabetical by name,
which replaces the previous `added_at DESC` (newest-added-first) ordering.
This was a deliberate, in-scope change: "most recently added by an admin"
never made sense as the order customers see apps in, and Android will rely
on this same field/ordering for its future category/recommended sections.

## Search behavior

**Admin panel**: client-side filtering (name, package name, category
label/key) of the already-loaded `GET /api/apps` result — no new server
search endpoint, since a few hundred catalog rows need no server-side
search.

**Android** (future): per the task's own instruction, the client performs
local filtering of the catalog **already synced to the device** — the sync
payload's `name`/`packageName`/`category` fields are sufficient for that.
No new device-facing search API was added or is needed for V1.

## Validation / security

All of the following is enforced server-side in
`POST /api/apps/:packageName/catalog-meta` (`backend/index.js`) and never
trusts client-side (admin-panel JS) validation alone:
- `category` must be one of the 12 fixed keys
  (`appCategories.isValidCategoryKey`) — 400 + no DB write otherwise.
- `isRecommended` must be `typeof === 'boolean'`.
- `sortOrder` must be `Number.isInteger` and within `[0, 100000]`.
- `packageName` must match the existing `PACKAGE_NAME_REGEX` (same regex
  every other apps endpoint already uses).
- `requireAdmin` (existing session-cookie auth) is required, same as every
  other `/api/apps/*` admin endpoint — nothing new was made public.

Verified for real (`test-app-catalog-integration.js`, tests 5/5b/6b/7b/7c/7d):
every invalid input (bad category, `"all"`/`"הכל"`, non-boolean recommended,
out-of-range/non-integer sortOrder, an empty body, an unknown package) is
rejected with the correct status code and leaves the row completely
unmodified.

## Migration / backward compatibility

All four new columns are added via `ALTER TABLE apps_catalog ADD COLUMN IF
NOT EXISTS ... DEFAULT ...` (`backend/db.js`) — no destructive rebuild, no
data loss, safe to run against a database that already has real catalog
rows and safe to re-run (idempotent, same convention as every other
migration in this file). `category_source` has a `CHECK` constraint
restricting it to the three known values; `category` deliberately has no DB
`CHECK` (the fixed set is enforced at the application layer in
`appCategories.js` instead), so adding a 13th category later never requires
a schema migration.

## Tests

- `backend/test-app-categories.js` — 11 pure unit tests (no DB/network):
  category list shape, `isValidCategoryKey`, `categoryLabel` fallback,
  every documented Play `genreId` → category mapping, `GAME`/`GAME_*`
  handling, unmapped genres returning `null`, no-throw on bad input.
- `backend/test-app-catalog-integration.js` — 20 real-Postgres + real-HTTP
  integration tests covering all 15 scenarios from the task's test list
  (default category, Play-derived category, manual override, override
  survives refresh, invalid category rejected, recommended toggle, sortOrder
  update + validation, catalog data shape for admin search/filter, full
  sync payload shape, per-device allowlist isolation/no-leak, and
  regression of assign-all / per-device assignment / Play metadata refresh).
- `backend/test-app-catalog-ui-smoke.js` — 10 real-browser (headless
  Chromium) tests of the actual rendered admin UI: org preview counts,
  category chips, search-by-category, category-filter narrowing, and both
  write controls (category dropdown, recommended toggle) actually
  persisting through the real UI.
- `backend/test-db.js` (pre-existing) — re-run clean, unaffected.

## What remains unverified

- A genuine live Google Play `genreId` fetch (network denied in this
  sandbox — see "Automatic category suggestion" above). The mapping and
  storage logic are fully tested; only the live network round-trip itself
  is unverified here.
- Android rendering of any of this (search/categories/עדכונים/מומלצות) —
  explicitly GPT's follow-up work on `dpc-app/**`, not implemented or
  claimed as implemented here. Reading `ApiClient.kt` confirmed the new
  sync fields are backward-compatible with the existing parser, nothing more.
- Real production catalog volume/behavior (Render) — all tests here run
  against a disposable local `appstore_test` Postgres database.
