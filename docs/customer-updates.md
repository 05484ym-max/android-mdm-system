# "חדשות ועדכונים" — Customer News & Updates

Owner: Backend/Admin + Android client (this change touches both)
Branch: `customer-news-updates`

A simple admin-authored news/announcements feed shown to customers in the
Android app's bottom nav, alongside "אזור אישי" / "חנות אפליקציות" /
"כניסת מנהל". Plain text only (title + body) - no rich text, no images,
no attachments in this version.

## Data model (additive)

New table, `customer_updates` - nothing existing was touched:

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | Backend-generated (`crypto.randomUUID()`), same convention as `commands.id`/`alerts.id`. |
| `title` | `TEXT NOT NULL` | |
| `body` | `TEXT NOT NULL` | Plain text. Never interpreted as HTML anywhere in this pipeline. |
| `published` | `BOOLEAN NOT NULL DEFAULT false` | |
| `pinned` | `BOOLEAN NOT NULL DEFAULT false` | "important/pinned" marker. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Bumped on every admin write. |
| `published_at` | `TIMESTAMPTZ` | See below. |

A partial index (`customer_updates_published_idx`, `WHERE published = true`)
matches the device-facing query's own `WHERE`/`ORDER BY` exactly.

### `published_at` semantics

Stamped to `now()` the moment a row transitions from unpublished to
published - at creation time (if created with `published: true`) or via a
later `POST /publish`. **Never moved backward, and never touched by any
other transition**: publishing an already-published row is a no-op for the
timestamp, and unpublishing preserves it rather than erasing history. This
is exactly what "pinned first, then newest-published" ordering sorts by.

## API

### Admin (`requireAdmin`, same cookie-session auth as every other admin route)

```
GET    /api/customer-updates              list everything (published + drafts), newest created first
POST   /api/customer-updates              create - { title, body, pinned?, published? }
PUT    /api/customer-updates/:id          partial update - { title?, body?, pinned? } (never published - see below)
POST   /api/customer-updates/:id/publish
POST   /api/customer-updates/:id/unpublish
DELETE /api/customer-updates/:id
```

`PUT` deliberately never changes `published` - that's a separate, narrower
write path (`/publish`, `/unpublish`) on purpose, so a content edit and a
visibility change are always two distinct, individually-auditable actions
(same "one write path per kind of change" pattern already used for the app
catalog's category-meta vs. Play-refresh split).

**Validation** (server-side, never trusting client-side checks alone):
`title`/`body` required, non-empty after trim, capped at 200/20,000
characters respectively; `pinned`/`published` must be real booleans when
present; `:id` must be a syntactically valid UUID (checked before it ever
reaches a query, so a malformed id is a clean 400, not a raw Postgres
error). Every admin route 401s with no session cookie.

### Device-facing (`requireDevice` - the same device-token auth as `/sync`/`/browser/check`)

```
GET /api/devices/:deviceId/updates
```

Published rows only, `pinned DESC, published_at DESC` (a draft is never
returned, period - the query's `WHERE published = true` is the only
thing that can put a row in this response), capped at the 50 most recent.

**Deliberately a separate endpoint, not a field on `/sync`'s response.**
`/sync` runs on every device's regular check-in (potentially thousands of
devices); a growing news history has no reason to ride along on that hot
path just because a handful of customers might open the news tab. A device
only calls this when its own "חדשות ועדכונים" screen is actually opened.

This endpoint carries **no per-device state** - the same response is valid
for every device. Read-state ("which updates has this customer already
opened") lives entirely on-device (Android `SharedPreferences`, see
`Config.readUpdateIds`/`markUpdateRead`) - explicitly out of scope for the
server to track per the task's own instruction. A future phase could add
server-side read-receipts without changing this endpoint's shape at all.

## Security

- Plain text only. The server never interprets `title`/`body` as HTML - it
  stores and returns exactly what was submitted, after only trimming/length
  validation. There is no unauthenticated write path to this table at all
  (every admin route requires a session).
- The admin panel (`admin-panel/news.js`) is the one place that actually
  renders this content into a DOM, and it always does so through the same
  `escapeHtml()` helper every other admin-panel module uses before
  `innerHTML` - verified for real in `backend/test-news-ui-smoke.js` by
  submitting a raw `<img src=x onerror=...>` payload and asserting no such
  element is ever created in the DOM (only its escaped text is visible).
- The Android client renders `body`/`title` via plain `TextView.text =`
  assignment - never `Html.fromHtml`, never a `WebView` - so there is no
  code path on-device that could interpret admin-authored text as markup
  either.
- A device can only ever reach the read-only, published-only endpoint above,
  authenticated exactly like every other device-facing route.

## Android client

- `ApiClient.fetchUpdates(deviceId)` - the one new network call, GET only.
- `Config.newsCache`/`setNewsCache` - last-fetched list, so the tab has
  something real to render immediately (and the unread badge can be
  computed) before a network round trip completes, same idea as the app
  store tab's `Config.appCatalog`.
- `Config.readUpdateIds`/`isUpdateRead`/`markUpdateRead` - local read-state,
  a `Set<String>` of update ids. An id is marked read the moment the
  customer actually opens that update for full reading
  (`CustomerActivity.showNewsDetail`) - not merely from appearing in the
  list, which would make the "new" indicator disappear before anything was
  actually seen.
- `CustomerActivity` gains a 4th bottom-nav item ("חדשות ועדכונים", between
  "חנות אפליקציות" and "כניסת מנהל"), with a small red dot badge shown
  whenever at least one cached update is unread. The list/detail views
  reuse the exact same card/badge/typography helpers already used by the
  personal-area tab (`roundedCardWithBorder`, `flatRounded`, the
  heavy/medium font pair, the same `#F2F1E6`/`#FFFFFF`/`#4B6B45` palette) -
  no new visual language, no new dependency.
- An empty feed renders the same "אין עדכונים כרגע" MUTED-centered-text
  empty state already used elsewhere in this file for an empty catalog -
  never an error.

## What could not be verified here

- **A real Gradle/AGP build of `dpc-app`.** This sandbox has no cached
  Android Gradle Plugin artifacts and `dl.google.com` (Google's Maven repo,
  required to resolve AGP/the Android SDK) is blocked by this environment's
  outbound network policy - confirmed directly (`curl` to it returns
  `CONNECT tunnel failed, response 403`). The Kotlin changes were reviewed
  manually against every helper/API already used elsewhere in
  `CustomerActivity.kt`/`Config.kt`/`ApiClient.kt`, but a real compiler
  pass could not be run locally. Pushing this branch does trigger a real
  `gradle assembleDebug` for real on GitHub's own runners as part of the
  CodeQL workflow's `android` job (unlike `build-dpc.yml`, which only
  triggers on `main`) - check
  `https://github.com/05484ym-max/android-mdm-system/actions` after the
  push for the actual result.
- Rendering on a real device/emulator - no display or emulator is available
  in this sandbox either.
