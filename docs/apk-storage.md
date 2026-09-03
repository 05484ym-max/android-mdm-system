# App Store — Persistent APK Upload

Owner: Claude (Backend / Admin)
Branch: `filtered-browser-server`
Android install/App Store UI: GPT (`dpc-app/**`, `client/**`) — not
implemented as part of this change; this document describes the
server/admin side only (storage, the upload endpoint, and what the
catalog/sync API now exposes for a custom-uploaded app).

This adds a second way an app can get into `apps_catalog` alongside "added
from Google Play": an admin can upload an APK file directly. The file is
stored in S3-compatible object storage (Cloudflare R2 in production — any
S3-compatible endpoint works) and the resulting public URL + SHA-256 are
recorded on the catalog row so a device can eventually install it directly,
without going through the Play Store at all.

## Why object storage, and why R2

Render's own disk is ephemeral and is wiped on every deploy/restart — an
APK saved there would vanish the next time the service redeploys, and
would not be shared across multiple backend instances if the service ever
scales beyond one. Object storage is the only option that survives both.
Cloudflare R2 was chosen for the production deployment because it is
S3-API-compatible (so the standard `@aws-sdk/client-s3` client works
unmodified) and has no egress fees for serving the resulting APKs, but
nothing in `apkStorage.js` is R2-specific — any S3-compatible bucket
(AWS S3 itself, Backblaze B2, MinIO, etc.) works by only changing the env
vars below.

## Required environment variables

Set these on the backend service (Render's environment variable UI, or the
local `.env` for development). **All six are required — the server fails
closed (`apkStorage.loadStorageConfig()` throws, `POST
/api/apps/upload-apk` returns 500) if any is missing**, rather than
silently uploading to a wrong/default bucket or accepting an APK it can't
actually store durably.

| Variable | Example (not a real value) | Notes |
|---|---|---|
| `APK_STORAGE_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | The S3-API endpoint for your account/bucket's region. For R2, this is the account-scoped endpoint from the Cloudflare dashboard's R2 → "Manage R2 API Tokens" page, **not** the bucket's public URL. |
| `APK_STORAGE_REGION` | `auto` | R2 always uses `auto`. A real AWS S3 bucket would use its actual region (e.g. `us-east-1`). |
| `APK_STORAGE_BUCKET` | `kosher-app-store-apks` | The bucket name. Must already exist — this server never creates a bucket. |
| `APK_STORAGE_ACCESS_KEY_ID` | *(R2 API token access key id)* | Scope the token to this one bucket only, read+write, nothing else. |
| `APK_STORAGE_SECRET_ACCESS_KEY` | *(R2 API token secret)* | Never logged anywhere in this codebase — treat it exactly like `JWT_SECRET`/`ADMIN_PASSWORD`: an env var only, never committed, never printed. |
| `APK_STORAGE_PUBLIC_BASE_URL` | `https://apks.example.com` | The URL prefix devices/admins actually fetch APKs from. For R2 this is a **custom domain or R2.dev public bucket URL you configure separately in Cloudflare** — this server never makes the bucket "public" itself, it only ever writes objects into it and constructs URLs by string-concatenating this prefix with the generated object key. |

None of these have a default value beyond `APK_STORAGE_REGION` (which
defaults to `'auto'` only when the variable is literally unset — every
other missing variable is a hard failure, never silently assumed).

### One-time R2 setup (outside this codebase)

1. Create an R2 bucket in the Cloudflare dashboard.
2. Decide how the bucket's contents will be served publicly — either
   enable the bucket's `r2.dev` public URL, or (recommended for
   production) attach a custom domain to the bucket via Cloudflare's R2
   dashboard. Whatever URL results is `APK_STORAGE_PUBLIC_BASE_URL`.
3. Create an R2 API token scoped to *only* that bucket, with read+write
   (Object Read & Write) permission — not an account-wide token. Its
   access key id/secret become `APK_STORAGE_ACCESS_KEY_ID`/
   `APK_STORAGE_SECRET_ACCESS_KEY`.
4. Copy the account's S3 API endpoint (shown alongside the token) into
   `APK_STORAGE_ENDPOINT`.
5. Set `APK_STORAGE_REGION=auto`.

This server does not manage bucket creation, public-access configuration,
or custom-domain attachment — all of that is a one-time Cloudflare-side
setup step, done once per environment (production, and separately for any
test/staging environment that wants real R2 rather than the local fake-S3
test double described below).

## Endpoint: upload an APK

```
POST /api/apps/upload-apk
Cookie: session=<admin JWT>              (same admin auth as every other /api/apps/* route)
Content-Type: multipart/form-data

apk:          <file, field name "apk">   required, .apk file, max 150MB
name:         string                     required, app display name
packageName:  string                     required, e.g. "com.example.app"
category:     string                     optional, one of the fixed category keys
                                          (see docs/app-store-catalog.md) — defaults
                                          to "other" if omitted
```

### Response — 200

```json
{
  "packageName": "com.example.app",
  "name": "Example App",
  "apkUrl": "https://apks.example.com/apps/7f2c1e2a-....apk",
  "sha256": "<64-char hex SHA-256 of the uploaded bytes>",
  "sizeBytes": 12345678
}
```

### Response — 4xx (validation, never partially applied)

- `400` — no file was attached (`apk` field missing/empty), the uploaded
  bytes don't start with a ZIP local-file-header (i.e. it isn't
  APK-shaped at all — see "What is and isn't validated" below), `name`
  missing, `packageName` missing or not a syntactically valid Android
  package name, or `category` given but not one of the fixed keys.
- `401` — not authenticated as an admin (identical to every other
  `/api/apps/*` route).
- `413` — the file exceeds 150MB.

None of these ever touch storage or the database — validation happens
first, entirely in-process.

### Response — 5xx (fail-closed)

Any of the following produce a generic 500 with no catalog side effect at
all — no admin action is required to "roll back" a failed upload, because
nothing partial is ever left in a state the catalog/sync API would treat
as real:

- `APK_STORAGE_*` env vars missing/incomplete on this server instance.
- The object storage upload itself fails (network error, wrong
  credentials, bucket doesn't exist, etc.) — **nothing is written to the
  database in this case**, since the catalog write only happens after a
  successful upload.
- The database write fails *after* a successful storage upload (e.g. a
  transient Postgres error) — the just-uploaded object is deleted again
  (best-effort; failure to delete is logged but does not change the 500
  response) so a real R2 bucket never accumulates orphaned APKs with no
  catalog row pointing at them.

## What is and isn't validated

- **Content-based APK check, not a full parse.** The uploaded bytes must
  begin with a real ZIP signature (every valid APK is a ZIP archive) —
  this rejects an obviously-wrong upload (a JPEG, a text file, an empty
  request) regardless of what filename or `Content-Type` the browser
  claims, since both are trivially spoofable and neither is trusted.
  **This is not full APK validation** — it does not open the ZIP, does not
  check for `AndroidManifest.xml`, does not verify an APK signing
  certificate, and does not extract the real package name. There is no
  such parser among this project's dependencies.
- **`packageName` always comes from the admin, never guessed.** Because
  there is no APK-parsing tool available to safely derive the package name
  from the file itself, the admin must always supply it, and it is
  validated only as a syntactically well-formed Android package name
  (the same regex every other app-catalog endpoint already uses) — never
  cross-checked against whatever the APK's actual manifest says, because
  this server never reads the manifest at all.
- **The original filename is never trusted for anything.** The object key
  a file is stored under is always a fresh, randomly generated
  `apps/<uuid>.apk` (`apkStorage.generateApkStorageKey()`) — the admin's
  original filename plays no role in the storage key, avoiding path
  traversal, collisions, and unicode-lookalike tricks entirely by
  construction rather than by sanitizing an untrusted string.
- **SHA-256 is computed server-side**, from the exact bytes that were
  uploaded (before they're sent to storage), and stored alongside the
  catalog row — this is the value `apkSha256` in the API/sync responses
  below, intended as the value a future Android installer verifies the
  downloaded bytes against before installing.

## Database changes (additive only)

All new `apps_catalog` columns are additive with safe defaults — every
pre-existing, Play-sourced row keeps working completely unchanged:

| Column | Type | Default | Notes |
|---|---|---|---|
| `apk_url` | `TEXT` | `NULL` | Public URL, only set for an APK-source row. |
| `apk_sha256` | `TEXT` | `NULL` | Hex SHA-256 of the uploaded file. |
| `apk_size_bytes` | `BIGINT` | `NULL` | |
| `apk_storage_key` | `TEXT` | `NULL` | The object key in the bucket — admin-panel-only, never sent to devices (see "Device sync contract" below). |
| `app_source` | `TEXT` | `'PLAY'` | `'PLAY'` or `'APK'`, enforced by a `CHECK` constraint. Every row that existed before this migration reads back as `'PLAY'`. |
| `uploaded_at` | `TIMESTAMPTZ` | `NULL` | Set only when an APK is uploaded/re-uploaded. |

Re-uploading to a `packageName` that already exists (e.g. shipping a newer
build of the same custom app) updates that row in place — the same
"upsert, never duplicate" pattern the Play-add flow already uses — rather
than creating a second catalog entry.

## Device sync contract

`POST /api/devices/:deviceId/sync`'s `catalog` array gains four new,
purely additive fields per app (existing fields are unchanged — a client
that only reads what it already knows about keeps working exactly as
before, same rule as the category/recommended/sort fields added in
`docs/app-store-catalog.md`):

```json
{
  "packageName": "com.example.app",
  "name": "Example App",
  "iconUrl": null,
  "playVersion": null,
  "playUpdatedAt": null,
  "category": "tools",
  "categoryLabel": "כלים",
  "isRecommended": false,
  "sortOrder": 0,
  "appSource": "APK",
  "apkUrl": "https://apks.example.com/apps/7f2c1e2a-....apk",
  "apkSha256": "<64-char hex>",
  "apkSizeBytes": 12345678
}
```

- `appSource` is `"PLAY"` or `"APK"` for every row, always.
- **`apkUrl`/`apkSha256`/`apkSizeBytes` are forced to `null` for every
  `appSource: "PLAY"` row**, regardless of whatever happens to be in the
  database for it (defense in depth — a Play app's apk-related columns
  should already be `NULL`, but the sync route re-asserts this at the
  response-mapping layer so a Play-sourced install path can never be
  accidentally offered a stray/incorrect APK URL).
- `apk_storage_key` (the raw bucket object key) is intentionally **not**
  part of this payload or the admin `GET /api/apps` response's meaningful
  surface for devices — only the already-public `apkUrl` is, since a
  device never needs to address the object storage API directly.
- As with every other catalog field, a device only ever sees an app it is
  actually allowed by policy — this filtering happens before the mapping
  above runs, unchanged from the existing behavior.

Android-side install logic (actually downloading and installing from
`apkUrl`, verifying `apkSha256`) is **not implemented as part of this
change** — this is a server/admin-only change, per this branch's standing
scope (`/client/**` and `dpc-app/**` are owned by GPT and were not
touched).

## Admin panel

`admin-panel/index.html`'s previously-disabled "העלה APK" button
(`openApkUploadBtn`) is now enabled and opens a modal
(`admin-panel/apk-upload.js`) with:

- A native file picker restricted to `.apk`.
- App name / package name / category fields (category is optional,
  defaults to "אחר" server-side if left blank).
- A real upload-progress percentage (via `XMLHttpRequest`'s
  `upload.onprogress`, since `fetch()` does not expose upload progress),
  and a disabled submit button for the duration of the request to prevent
  a double-submit.
- A Hebrew success message (`הועלה בהצלחה: <name>`) or a Hebrew error
  message drawn directly from the server's `{ "error": "..." }` body.
- The catalog list is reloaded on success, and any tile whose
  `appSource === 'APK'` shows a small "APK" badge next to its name.

## Testing notes

Real object storage (a real R2 bucket) is not reachable from this sandbox
(no credentials, no network egress to Cloudflare's API). Rather than
mocking the AWS SDK, the automated tests
(`backend/test-apk-upload-integration.js`,
`backend/test-apk-upload-ui-smoke.js`) point `@aws-sdk/client-s3` at a
small local HTTP server (`backend/fakeS3Server.js`) that implements just
enough of the S3 `PUT`/`DELETE`/`GET` object surface to exercise
`apkStorage.js`'s real request/response handling — this is a real HTTP
server the real S3 client talks to over real HTTP, explicitly documented
in that file as a stand-in for R2 connectivity, not a mock of the SDK
itself. It does not verify AWS request signing, so it does not prove
credentials/signing work against a real R2 endpoint — only that this
server's own upload/delete/key-generation/error-handling logic behaves
correctly given real S3-shaped HTTP responses (200s, and connection
failures for the "storage unreachable" fail-closed test). See
`docs/server-progress.md`'s KNOWN LIMITATIONS for the exact scope of what
remains unverified against real R2.

## What could not be verified here

- A real Cloudflare R2 bucket/account — no credentials or network
  reachability from this sandbox (same limitation already documented for
  Google Play network access elsewhere in this project).
- AWS SigV4 request signing against a real S3-compatible server that
  actually checks it (the local fake-S3 test double accepts any request
  unconditionally — see "Testing notes" above).
- The actual Render production deployment with real `APK_STORAGE_*`
  values.
