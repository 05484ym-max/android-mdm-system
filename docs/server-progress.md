# Filtered Browser Server Progress

Branch: `filtered-browser-server`
Owner: Claude

## DONE

**Persistent APK upload (custom app-store entries), this update:**
- **`backend/apkStorage.js` (new)**: S3-compatible object storage wrapper
  (`@aws-sdk/client-s3`), designed for Cloudflare R2 but not R2-specific.
  `loadStorageConfig()` fails closed (throws) if any of
  `APK_STORAGE_ENDPOINT`/`_REGION`/`_BUCKET`/`_ACCESS_KEY_ID`/
  `_SECRET_ACCESS_KEY`/`_PUBLIC_BASE_URL` is missing — no default
  bucket/endpoint is ever assumed. `generateApkStorageKey()` returns a
  random `apps/<uuid>.apk` key, never derived from anything caller-
  supplied. `uploadApk`/`deleteApk` throw/log-and-return-false
  respectively (upload is fail-closed; delete is best-effort cleanup,
  documented as never allowed to mask the real error it's cleaning up
  after). See `docs/apk-storage.md`.
- **`backend/db.js`**: additive `apps_catalog` columns
  (`apk_url`/`apk_sha256`/`apk_size_bytes`/`apk_storage_key`/
  `app_source` (`CHECK IN ('PLAY','APK')`, `NOT NULL DEFAULT 'PLAY'`)/
  `uploaded_at`) — every pre-existing row reads back as `app_source:
  'PLAY'` with every apk_* field null, no backfill needed. New
  `insertUploadedApp()` upserts an APK-source row (same "manual category
  never silently overwritten" rule as `addAppToCatalog`'s existing
  Play-metadata-refresh protection); `mapCatalogRow` extended to surface
  all of the above.
- **`backend/index.js`**: `POST /api/apps/upload-apk` (`requireAdmin`,
  `multer` memory storage only — never Render's local disk, max 150MB).
  Validates the upload is APK-shaped by content (ZIP magic bytes — not a
  full parse; no such parser is a dependency here), requires `packageName`
  from the admin (never guessed from the file), computes SHA-256
  server-side, uploads before any database write, and deletes the
  just-uploaded object again if the database write then fails (fail-
  closed: no storage/DB failure can ever leave a usable-looking catalog
  entry). `/api/devices/:deviceId/sync`'s catalog mapping gained
  `appSource`/`apkUrl`/`apkSha256`/`apkSizeBytes` — the three apk-related
  fields are explicitly forced to `null` for every `appSource: 'PLAY'` row
  at the response-mapping layer, regardless of the underlying data.
  `/browser/check`, `browserPolicy.js`, and the Phase 2.4 signed-snapshot
  routes are completely untouched (confirmed via `git diff --stat`).
- **`admin-panel/index.html` + `admin-panel/apk-upload.js` (new)**: the
  previously-disabled "העלה APK" button now opens a real upload modal
  (file picker restricted to `.apk`, name/packageName/category fields,
  real upload-progress percentage via `XMLHttpRequest`, a busy/disabled
  submit button preventing a double-submit, Hebrew success/error
  messaging, automatic catalog refresh on success). An uploaded app's tile
  shows a small "APK" badge (`.apk-source-badge`) wherever `appSource ===
  'APK'`. No existing catalog UI (category/recommended/sort controls,
  Play search/add) was changed.
- **`backend/fakeS3Server.js` (new, test infrastructure)**: a small local
  HTTP server standing in for an S3-compatible bucket, since this sandbox
  has no real R2 credentials/network reachability — documented in the file
  itself as a real HTTP server the real AWS SDK talks to, not a mock of
  the SDK. See `docs/apk-storage.md`'s "Testing notes" for exactly what
  this does and doesn't prove.

**Phase 2.4 correction (device-complete signed snapshot + rollback contract fix), this update:**
- **Synced `filtered-browser-server` with `origin/main` first** (61 commits
  behind before merging) — brought in the app-store-categories work
  (`backend/appCategories.js`, catalog fields/endpoints,
  `admin-panel/index.html` search/filter/recommended UI, its 3 test
  files), the CodeQL GitHub Actions workflow, and substantial Android-side
  work (`AppStoreActivity.kt`, `CustomerActivity.kt`, `PolicyEnforcer.kt`,
  `PolicySync.kt`, `WallpaperBranding.kt`, `AdBlockDns.kt`,
  `DnsFailSafeScheduler.kt`, the latest MDM APK). Merge conflicts were
  narrow and resolved conservatively: `backend/index.js` (both sides
  independently added a `require` on the same line — kept both),
  `backend/package.json`/`package-lock.json` (this branch's `tldts`
  dependency alongside everything main already had — regenerated the
  lockfile via `npm install` rather than hand-editing it).
  `backend/db.js` and `admin-panel/index.html` auto-merged with no
  conflicts at all. **Confirmed 0 commits behind `origin/main` after the
  merge.** Nothing from main's newer MDM/App Store/CodeQL/Android work was
  overwritten — verified by re-running the app-store-categories test
  suites (now present on this branch via the merge) immediately after.
- **Fixed the anti-rollback contract** (a real correctness bug in the
  documentation, not in `policySigning.js`'s actual code — its
  `assertMonotonicPolicyVersion` already only ever rejected a *strictly
  lower* `policyVersion`, verified by re-reading it before changing
  anything): `docs/server-api-contract.md` previously said a client must
  reject a snapshot "at or below" its highest accepted `policyVersion`.
  That's wrong and would have broken normal operation: this endpoint
  signs a brand-new envelope on every single request (no caching), so a
  device re-fetching with no policy change in between legitimately
  receives the *same* `policyVersion` every time, just with renewed
  `generatedAt`/`expiresAt`. Corrected to: reject only *strictly lower*;
  accept *equal* whenever signature/keyId/expiry/format are otherwise
  valid. All "at or below" (and equivalent) wording removed.
- **Made the signed snapshot device-complete.** The previous version only
  signed `globalDomains` — incomplete, since `browser_device_overrides`
  can change the effective decision for the specific device the snapshot
  was requested for (see `evaluateDomain`'s real precedence: override
  checked *before* the global table). Fixed:
  - New `db.getBrowserDeviceOverridesForSnapshot(deviceId)` — `domain`,
    `decision` only (no `allowSubdomains` column exists on
    `browser_device_overrides`, so none is invented here - a device
    override is always an exact-domain match, by schema).
  - `policySigning.buildBrowserPolicySnapshot` now takes `globalDomains`
    AND `deviceOverrides`, sorts **both** independently by domain before
    signing, and places them in **separate arrays** in the payload
    (`globalDomains`, `deviceOverrides`) rather than flattening them into
    one pre-resolved list — a verifier must apply the same
    override-then-global precedence `evaluateDomain` uses, and flattening
    would silently bake that precedence in server-side where a verifier
    could no longer tell the two apart.
  - The route now fetches the requesting device's own overrides strictly
    via `req.params.deviceId` (the id `requireDevice` already verified the
    bearer token belongs to) — never any other source — which is what
    structurally guarantees one device can never receive another device's
    override policy.
- Re-verified after both fixes: zero changes to `browserPolicy.js`, the
  `/browser/check` route, or `ALLOW`/`BLOCK`/`REVIEW` semantics (`git diff`
  confirms `browserPolicy.js` untouched again this update). No HMAC
  introduced. No private key material anywhere in the diff (grepped
  again).

**Phase 2.4 (asymmetric signed browser-policy snapshot foundation), this update:**
- Read GPT's docs fresh from `filtered-browser-client` (still Phase 0A,
  unverified on a physical device — client's own `NEXT` item 5 explicitly
  names "signed policy" as the step after physical-device verification
  succeeds, which is consistent with this phase being foundation-only: no
  Android verification code or local client caching was implemented or
  claimed here) and my own `server-progress.md`/`server-api-contract.md`
  before starting.
- **New `backend/policySigning.js`** — the whole cryptographic core, kept
  deliberately separate from `browserPolicy.js` (which is completely
  untouched this phase — confirmed via `git diff`, zero lines changed):
  - Ed25519 only (native in Node's `crypto` module since Node 12 — this
    deployment runs Node 22, so there was no compatibility reason to reach
    for RSA/ECDSA or an external crypto package). No HMAC, no shared
    secret anywhere.
  - `loadSigningConfig()` reads `BROWSER_POLICY_SIGNING_PRIVATE_KEY`
    (PEM/PKCS8, real or `\n`-escaped newlines, or base64) and
    `BROWSER_POLICY_SIGNING_KEY_ID` from the environment, validates the
    key actually is Ed25519, and throws (never falls back) on anything
    missing or wrong — verified this never logs the key material anywhere
    (grepped every log statement in both new files).
  - `canonicalize()` — deterministic JSON serialization (object keys
    sorted recursively, no whitespace, throws on `undefined` rather than
    silently corrupting the byte stream) - this is the exact byte
    definition a future Android verifier must reproduce.
  - `buildBrowserPolicySnapshot()` — pure, DB-free: always re-sorts the
    `domains` array by domain name regardless of what order it was given
    in, which is what makes the resulting signature independent of
    incidental database read order (proven directly in
    `test-policy-signing.js`, not just asserted).
  - `signSnapshot()`/`verifySnapshot()` — sign/verify over the canonical
    bytes only; `keyId`/`algorithm` sit outside the signed bytes as
    envelope metadata (see the contract doc for exactly why that's safe:
    tampering with either can only break verification, never forge a
    pass).
  - A per-process monotonicity guard (`assertMonotonicPolicyVersion`) that
    refuses to sign a `policyVersion` lower than one already issued this
    process — a narrow, precisely-scoped safety net, not the actual
    anti-rollback mechanism (that's the client's job — see the contract
    doc's "Anti-rollback" section for the honest scope of what this can
    and can't catch).
- **`db.js`**: one new read-only function,
  `listBrowserDomainsForSnapshot()` — `SELECT domain, decision,
  allow_subdomains FROM browser_domains WHERE decision != 'REVIEW' ORDER
  BY domain`. No schema change (no new table, no new column) - every field
  the snapshot needs already existed. REVIEW rows are excluded because
  `browserPolicy.evaluateDomain` already treats them identically to "no
  rule" for matching, so including them would only bloat the snapshot.
- **`index.js`**: two new routes, nothing else touched in this file beyond
  adding them and the new `require`:
  - `GET /api/devices/:deviceId/browser/policy-snapshot` (`requireDevice`
    — identical auth to `/browser/check`/`/sync`, not weakened) — builds
    and signs a fresh snapshot on every call (no server-side caching, so
    staleness of the server's own output is structurally impossible).
    Every failure mode (missing/malformed key, a monotonicity violation,
    any DB error) is a plain thrown error left to the existing
    `wrap()`/global-error-handler pattern — there is no code path that
    constructs an envelope-shaped response without a real signature
    having actually succeeded.
  - `GET /api/browser/policy/signing-key` (`requireAdmin`) — exposes
    `{ keyId, algorithm, publicKeyPem, publicKeyBase64 }` for an admin to
    retrieve/document/pin today; deliberately not a public/device-facing
    endpoint yet (see docs/server-api-contract.md's Known Limitations for
    why that's a later decision, not an oversight).
- **Real end-to-end smoke-tested by hand before writing the formal test
  suites** (to catch wiring bugs fast): generated a real ephemeral Ed25519
  key, booted a real server with it, logged in as a real admin, fetched
  the real public key, created a real device, fetched a real signed
  snapshot, and independently verified the real signature against the
  derived public key with a completely separate script — all before any
  test file existed. Also manually confirmed a real 500 (not a fabricated
  envelope) when the signing key env vars are absent.

**Phase 2.3 (load / abuse / failure hardening on `/browser/check`), this update:**
- Read GPT's docs fresh from `filtered-browser-client` (still Phase 0A,
  unverified on a physical device — no drift affecting this phase) and my
  own `server-progress.md`/`server-api-contract.md` before starting.
- **Hardening added** (small, targeted, `/backend/**` only):
  - `browserPolicy.isValidDomainLabel` now rejects any host over 253
    characters (the real DNS name-length ceiling) — previously unbounded,
    so a multi-kilobyte "host" string could reach the LIKE-based subdomain
    query in `getBrowserDomainForHost` as long as it was made of only
    letters/digits/hyphens/dots. Applies to both `/browser/check` and admin
    domain-rule validation (one shared function, one fix).
  - `browserPolicy.parseNavigationUrl` now rejects any `url` over 8192
    characters as unparseable (same 400 path as any other malformed URL) -
    before it ever reaches `new URL()`, and before it could be written into
    `browser_requests.first_url` / `browser_decision_log.url`.
  - New per-device rate limit on `POST /api/devices/:deviceId/browser/check`
    — 40 calls / rolling 10s window per `deviceId` (both configurable via
    env vars), in-memory, same fixed-window pattern as the existing
    admin-login rate limiter. Exceeding it returns `429` with no decision
    object — never a fabricated `ALLOW`. See
    `docs/server-api-contract.md`'s new "Resource-abuse hardening" section
    for the exact behavior.
- **One real product bug found and fixed** (not a test-authoring mistake -
  a real, previously-shipped bug in `backend/db.js`): the shared
  PostgreSQL connection pool had no `.on('error', ...)` listener. Verified
  for real by stopping the local Postgres service under a live server
  instance — Node's default behavior for an `EventEmitter` `'error'` event
  with no listener is to **crash the entire process**, confirmed exactly
  that: the whole backend went down, not just the in-flight query, taking
  every endpoint (device sync, admin panel, everything) with it until
  manually restarted. This is a far worse outcome than the intended
  fail-closed 500 — it's total downtime from something as ordinary as a
  brief network blip or a database restart. Fixed with the single
  `pool.on('error', ...)` listener the `pg` library's own docs call for
  (logs and swallows the idle-client error; each call site's own try/catch
  still turns an in-flight query failure into a normal 500, unchanged).
  Re-verified after the fix: stopping Postgres under a live server now
  produces clean `5xx` responses and the process stays up and serves
  correctly again the moment Postgres returns — no restart needed.
- **New `backend/test-browser-load.js`** (28 tests, all against the same
  real local Postgres `browser_test` database and a real running
  `index.js`, real concurrent `Promise.all` bursts, a real
  `service postgresql stop`/`start`, and a second real backend process this
  suite spawns and kills itself for the restart test):
  - **Load/concurrency (3 tests)**: 25 concurrent checks from one device
    for one unknown domain collapse to exactly one `browser_requests` row
    and one requester row (~140-210 req/s observed); 30 distinct devices
    hitting one unknown domain at once collapse to one request with all 30
    tracked as distinct requesters (~300-460 req/s observed); 36 mixed
    concurrent ALLOW/BLOCK/12-distinct-unknown-domain checks across 12
    devices never mutate the existing ALLOW/BLOCK `browser_domains` rows
    (byte-identical `decision_version`/`updated_at` before and after) and
    produce exactly one pending request per distinct unknown domain
    (~370-380 req/s observed). All real numbers from this environment, not
    estimates — see the suite's own console output for the exact run.
  - **Failure behavior (13 tests)**: missing `url`; wrong JSON types
    (number/object/array/bool/null); overlong `url` (8192+ chars) over the
    real HTTP endpoint; an oversized request body (over express's 100kb
    JSON limit); three invalid-Unicode/IDN/confusable-character hosts;
    forbidden scheme (`ftp:`); IPv4 and IPv6 literal hosts; a non-default
    port on an unknown host (confirms the deliberate, documented
    host-only evaluation - never a per-port policy); missing/wrong device
    auth; unknown device id; a forced real mid-transaction DB write failure
    on an ALLOW-eligible domain (same sentinel-trigger fault-injection
    technique as Phase 2.1's rollback tests, this time on
    `browser_decision_log`'s insert - the genuinely last statement on the
    hot path) proving the route still fails closed even when the failure
    happens *after* the decision was already computed; and PostgreSQL
    actually stopped and restarted mid-suite, proving a real `5xx` (never
    `ALLOW`) while it's down and real recovery once it's back. No failure
    path in any of these ever produced an `ALLOW`.
  - **Rate limit (4 tests)**: a burst of 45 from one device gets exactly
    40 through and the rest `429` (none with a decision object, none
    `ALLOW`); a different fresh device is unaffected by another device's
    throttling (confirms per-device, not global); a moderate 10-request
    burst is never throttled; and the window genuinely resets after ~10s -
    a throttled device can check again without restarting anything.
  - **Query plans (7 tests)**: seeded 2000 `browser_domains` rows, 50
    device overrides, 300 pending requests (with ~440 requester rows), 5000
    `browser_decision_log` rows, and 1000 `browser_policy_audit` rows, then
    ran real `EXPLAIN ANALYZE` on every query on the hot/admin paths (full
    plans are in the suite's console output). Real findings: the per-device
    override lookup, the pending-request dedup lookup, the admin
    pending-request list join, and both audit lookups (filtered and
    unfiltered) all already use their existing indexes (`Index Scan`/
    `Bitmap Index Scan`), sub-millisecond even at these volumes. The one
    exception: `getBrowserDomainForHost`'s exact/subdomain lookup does a
    `Seq Scan` over all 2000 `browser_domains` rows (0.2ms execution time)
    — expected, since its `OR` includes a per-row dynamic `LIKE` pattern
    (`$1 LIKE '%.' || domain`) that a plain b-tree index can't serve for
    the subdomain branch. **No index was added**: at 2000 rows this is
    already sub-millisecond, `browser_domains` is admin-curated (not
    expected to reach a size where a sequential scan matters), and adding
    one on a guess without a real slow query to justify it would be
    exactly the "optimize by guesswork" this phase's instructions warned
    against. Documented here instead, to revisit if this table ever grows
    into the tens of thousands of rows.
  - **Restart/persistence (1 test)**: spawned a second, independent real
    backend process, wrote an admin ALLOW rule (bumping `policyVersion`), a
    real pending REVIEW request via the actual HTTP check endpoint, and a
    DEVICE-scope resolution on a second request; killed the process with
    `SIGTERM`; spawned a fresh process on the same database; confirmed via
    direct Postgres reads that `policyVersion` was exactly unchanged (never
    rolled back), the still-open request was still `PENDING`, the resolved
    request was still `RESOLVED` with its `DEVICE` scope intact, and the
    audit row count was unchanged; then made a real HTTP check against the
    *freshly restarted* process's own endpoint and confirmed it still
    returned the pre-restart `ALLOW` decision with the correct
    (unchanged) `policyVersion`.
- **Regression**: re-ran all three existing suites clean after every code
  change in this phase — `test-browser-policy.js` 55/55 (49 existing + 6
  new pure-logic tests for the length caps), `test-db-integration.js`
  46/46, `test-admin-ui-e2e.js` 38/38. Zero of the Phase 2.1/2.2 files
  (`db.js` schema/queries besides the one-line pool fix, `browserPolicy.js`
  decision logic, `index.js` routes besides the two additions above,
  `admin-panel/**`) needed any other change.

**Phase 2.2 (real admin-panel UI end-to-end verification), this update:**
- Read GPT's docs fresh from `filtered-browser-client` (still Phase 0A —
  code + visual foundation complete, 21/21 pure Kotlin tests pass, Android
  build + physical-device bypass matrix still pending; no drift, no
  server-impacting change) and my own `server-progress.md`/
  `server-api-contract.md` before starting.
- Verified real Chromium is usable here (`/opt/pw-browsers`, per this
  environment's pre-installed Playwright setup) and installed the
  `playwright` npm package (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` avoided a
  redundant browser download) as a new **devDependency** — test tooling
  only, not shipped in the production `dependencies` list.
- New `backend/test-admin-ui-e2e.js`: drives the real admin panel
  (`admin-panel/index.html` + `browser.css`/`browser.js`, served by the
  real `index.js`) with a real headless Chromium, against the same real
  Postgres test database as Phase 2.1. Auto-accepts every native
  `confirm()`/`alert()` dialog (capturing its text for assertions, exactly
  like a real admin clicking through) and tracks both real uncaught
  page-script exceptions and console-error noise separately, since the
  suite's own negative-path tests deliberately trigger 401/404/400
  responses that Chromium logs as console errors regardless of whether the
  page handled them correctly — that's expected, not a bug signal.
- Covered, all against the real running UI: login/logout, tab + sub-tab
  navigation (including that the 5 pre-existing unrelated tabs still work
  — no regression from this project's admin-panel edits), add/edit/search/
  filter/delete a domain rule, the `allowSubdomains` confirmation, audit-
  history expansion, the full Requests workflow seeded through **real**
  `POST /api/devices/:deviceId/browser/check` calls (not seeded directly
  in the DB) — request appearance with correct counts, the GLOBAL badge,
  expandable per-device list, DEVICE ALLOW leaving a sibling device
  pending, DEVICE BLOCK closing a fully-answered request, GLOBAL ALLOW/
  BLOCK answering every still-waiting device without ever overwriting one
  already individually resolved — and three failure-path cases (a stale/
  already-resolved action failing visibly rather than double-mutating, a
  domain rejected by validation, and a lost session correctly re-showing
  the login screen instead of silently failing).
- **One real bug-hunting round, zero real product bugs found.** The first
  full run produced 8 failing tests; every one traced back to the *test
  script itself*, not to `admin-panel/**` or `backend/**`:
  1. `e2e-wild.itest.com` was used to test `allowSubdomains=true`, but its
     real registrable domain (per the actual Public Suffix List) is
     `itest.com`, not itself — Phase 1.1's validation correctly rejected
     it. This was proof the validation works, not a bug; fixed by using
     `e2e-wild.com` (a genuine two-label registrable domain) instead.
  2. That single wrong assertion then threw before its own cleanup ran,
     leaving the `allowSubdomains` checkbox checked, the domain search
     box filled, and the decision filter set to `BLOCK` for every
     subsequent test — a classic test-isolation gap, not a product issue.
     Fixed by wrapping every UI-state-mutating test step in `try/finally`
     so cleanup always runs, pass or fail.
  3. A 401-expiry test assumed the login screen only appears after a form
     submit; in reality, merely switching to the Domains sub-tab already
     triggers a data fetch that 401s and shows it — the test's own
     `page.click()` on the submit button then timed out because the login
     overlay was already covering the page. Fixed by asserting at the
     real point the login screen appears.
  4. A blanket "no console errors" check was too broad: this suite's own
     negative-path tests (D/G) intentionally trigger 401/404/400
     responses, which Chromium logs as `console.error` regardless of
     whether the page handled them correctly. Split into `pageerror`
     (real uncaught exceptions — asserted on) vs. `console.error`
     (informational only, printed but never fails the suite).
  All four fixes are in `backend/test-admin-ui-e2e.js` only — no file
  under `admin-panel/**` or `backend/db.js`/`index.js`/`browserPolicy.js`
  was touched, because nothing there was actually wrong.
- No `/client/**` file touched. No change to `docs/server-api-contract.md`
  this phase — no externally observable server behavior changed (only
  test tooling was added).

**Phase 2.1 (real PostgreSQL integration verification), this update:**
- Read GPT's docs fresh from `filtered-browser-client` (still Phase 0A, not
  VERIFIED — 21/21 pure Kotlin policy tests pass, Android build + physical-
  device bypass matrix still pending) and my own `server-progress.md`/
  `server-api-contract.md` before starting. No drift, no contract change
  needed this phase — nothing in `db.js`/`index.js`/`browserPolicy.js` was
  touched, only a new test file was added.
- Found a real local PostgreSQL 16 server already installed in this
  environment (`postgresql-16` + `pg_ctlcluster`, Docker daemon was not
  reachable) — started it, created a dedicated `browser_test` database and
  `browser_test_user` role, and ran the **entire** integration suite
  against it for real. Exact setup/run commands are documented at the top
  of `backend/test-db-integration.js` for reproducibility.
- New `backend/test-db-integration.js`: boots the real `index.js` server
  as a subprocess against the test database, then exercises it two ways —
  direct calls into `./db`'s real functions for deep DB-semantics
  assertions, and real HTTP requests (`fetch`) against the running server
  for auth/endpoint-integration assertions. Nothing mocked anywhere in
  this file.
- Confirmed the critical Phase 2 shared-request fix (device A resolved,
  device B still pending, parent stays PENDING; global resolution never
  overwrites an already-individually-answered device) against a real
  database, not just the pure-function mirror from Phase 2.
- Built a real concurrency test: two `Promise.all`-fired concurrent
  resolve calls (both DEVICE-scope and GLOBAL-scope) racing for the exact
  same row — genuine Postgres row-locking decides the winner, not
  application-level logic; verified exactly one wins and no double
  write/audit occurs.
- Built a real rollback test. **REVOKE-based fault injection does not
  work here**: the test role owns every table it created via `db.init()`,
  and a Postgres table owner's privileges bypass `GRANT`/`REVOKE` entirely
  — this was tried first and confirmed not to force a failure. Instead,
  added a temporary trigger on `browser_policy_audit` that raises a real
  exception only for one sentinel `actor` value, deliberately firing on
  the genuine last statement of each transaction (`insertAuditRow`) —
  proving the whole write rolls back (no partial `browser_domains` write,
  no request marked resolved without its policy write, no `policyVersion`
  bump) using an unmodified code path, not a mock. Trigger is
  installed/removed only for that section of the suite.
- Real HTTP-level validation tests: `github.io`/`blogspot.com`/
  `appspot.com`/`co.uk`/IP literals/scheme/path/port/wildcard all
  confirmed rejected with **zero** database row ever written (queried
  directly), while Unicode/Punycode/uppercase/trailing-dot inputs are
  confirmed to write to the exact same canonical row, not duplicates.
- Real auth-integration tests over HTTP: no session → 401, valid session →
  200, wrong device token → 401, mismatched deviceId/token pair → 401,
  unknown deviceId → 404, correct token → 200 with a real decision.

**Phase 1 (foundations):**
- Postgres schema: `browser_domains`, `browser_device_overrides`,
  `browser_requests` + `browser_request_devices` (thundering-herd dedupe),
  `browser_decision_log`, `browser_policy_meta` (global `policyVersion`).
- `POST /api/devices/:deviceId/browser/check` — fail-closed decision
  endpoint (`ALLOW`/`BLOCK`/`REVIEW` only).
- Admin endpoints: `GET/POST /api/browser/domains`, `GET /api/browser/requests`,
  `POST /api/browser/requests/:id/resolve`.
- Full contract in `/docs/server-api-contract.md`.

**Phase 1.1 (hardening + coordination), this update:**
- Read GPT's `docs/client-progress.md` and `docs/client-api-requirements.md`
  fresh from the `filtered-browser-client` branch before starting (per the
  new standing rule) — no drift found, shared contract unchanged.
- Added `tldts` (real Public Suffix List library, `allowPrivateDomains: true`
  so GitHub Pages/Blogspot/App Engine-style shared-hosting boundaries are
  honored, not just ICANN TLDs) as a real dependency — no hand-rolled PSL
  logic.
- `browserPolicy.validateDomainRuleInput(domain, allowSubdomains)`: full
  admin rule-write validation — rejects scheme/path/query/port/userinfo/
  wildcard/whitespace, IP literals, malformed hosts, bare public-suffix
  domains (`github.io`, `co.uk`, `blogspot.com`, `appspot.com`, …)
  unconditionally, and `allowSubdomains=true` on anything narrower than the
  true registrable domain. Fail-closed: any internal exception (including
  from `tldts`) is caught and treated as a rejection.
- `browserPolicy.domainCovers(host, ruleDomain, allowSubdomains)`: pure,
  boundary-aware subdomain-matching predicate (exact match, or a real
  label boundary via `allowSubdomains` — never a bare substring/suffix
  match). Wired into `evaluateDomain` as an independent defense-in-depth
  re-check on every database read — a fetched row is never trusted for an
  ALLOW/BLOCK decision without this function separately confirming it
  actually covers the host.
- Canonicalization: admin-submitted bare domains now go through the same
  ASCII/Punycode host-parsing Node's `URL` already applies to real
  navigation hosts, so Unicode vs. Punycode, mixed case, and a trailing dot
  all collapse to one canonical `browser_domains.domain` value.
- `POST /api/browser/domains` and `POST /api/browser/requests/:id/resolve`
  (scope `GLOBAL`) both run this validation before writing; an invalid
  domain returns HTTP 400 and — for resolve — leaves the request PENDING
  rather than silently applying an unsafe rule.
- `docs/server-api-contract.md` updated with the new validation rules,
  rejection-reason table, and the two concrete guarantees this closes
  (no accidental shared-hosting wildcard; one canonical row per real site).

**Phase 2 (admin review workflow + policy management), this update:**
- Read GPT's docs fresh from `filtered-browser-client` and my own
  `server-progress.md`/`server-api-contract.md` before starting — no drift.
- **Critical fix (flagged before this phase started):** a request shared by
  several devices no longer gets silently closed out for devices still
  waiting when one device is resolved with `scope: "DEVICE"`. Reworked the
  data model: `browser_request_devices` now carries its own `decision`/
  `resolved_at` per device (migration-safe `ALTER TABLE ADD COLUMN IF NOT
  EXISTS`, since the table already existed from Phase 1). `resolveBrowserRequest`
  rewritten: `GLOBAL` answers every still-waiting device at once and closes
  the request; `DEVICE` answers only the named device and the parent only
  flips to `RESOLVED` once every sibling row is non-null. Full writeup in
  `server-api-contract.md`'s new "Shared-request resolution" section.
- New `browser_policy_audit` table + `db.insertAuditRow` — one row per
  admin policy change (never browsing history), written in the same
  transaction as the change it documents, for every write path
  (`upsertBrowserDomain`, `deleteBrowserDomain`, both branches of
  `resolveBrowserRequest`). `actor` is the admin session's username
  (`req.admin.username`, now exposed by `requireAdmin`).
- New: `DELETE /api/browser/domains/:domain` (delete a global rule — clear,
  safe "revert to no decision" semantics, audited).
- New: `GET /api/browser/requests/:id/devices` (per-device breakdown of a
  request, for the admin UI's "who's still waiting" view before a
  DEVICE-scope action).
- New: `GET /api/browser/audit?domain=` (policy-change history).
- `GET /api/browser/domains` gained `?search=` and `?decision=` filters.
- `GET /api/browser/requests` now reports `requesterCount` as devices
  *still waiting* (was: everyone who ever asked) plus a new
  `totalRequesterCount` and `lastRequestedAt` — the operationally correct
  numbers for an admin deciding what to do next.
- Built the admin panel UI: new "דפדפן מסונן" tab in the existing
  `admin-panel/index.html` (own `browser.css`/`browser.js`, same isolation
  convention as `health.js`/`alerts.js`/`diagnostics.js` — touches nothing
  else in the existing panel). Requests view (global allow/block with
  confirmation, expandable per-device list with its own allow/block-for-
  this-device-only actions) and Domains view (search/filter, add/edit form,
  delete with confirmation, expandable per-domain audit history). GLOBAL
  vs. DEVICE is always shown with visually distinct badges (solid filled
  for GLOBAL, outlined for DEVICE) and named explicitly in every
  confirmation dialog, so an admin can't mistake one for the other.
  Reuses the existing palette (`--accent`/`--ok`/`--danger`/etc. from
  `index.html`'s `:root`) — no new global CSS tokens, one new local color
  for REVIEW (amber, not previously needed anywhere else in the panel).
- Server remains the sole source of truth: every admin-panel write goes
  through the same backend validation as any other API caller — the UI
  does not duplicate or substitute for it.

## TESTED

**Persistent APK upload, this update.**

Exact environment: real local PostgreSQL 16 (new dedicated
`apkupload_test` database, same setup pattern as every other suite on this
branch), real running `backend/index.js` processes (this feature's suites
spawn their own — a main fixture with a working fake-S3 endpoint, one
pointed at an unreachable storage endpoint, and one with no
`APK_STORAGE_*` config at all, for the fail-closed scenarios), real
multipart/form-data HTTP requests via the platform's own `fetch()`/
`FormData`, and a real headless Chromium browser for the admin UI.

- **`backend/test-apk-storage.js`: 12/12 passed** (pure, no DB/network):
  `loadStorageConfig` failing closed for each of the five required env
  vars individually, defaulting region to `'auto'`, and returning every
  configured field without fabricating a default; `generateApkStorageKey`
  shape/uniqueness (50 calls, 50 distinct keys) and taking no arguments at
  all (nothing to trust from a caller); `publicUrlForKey` joining
  correctly with and without a trailing slash on the base URL;
  `APK_CONTENT_TYPE`'s exact value.
- **`backend/test-apk-upload-integration.js`: 15/15 passed**, all against
  real Postgres + real HTTP: unauthenticated upload rejected before
  touching storage/DB; a non-APK file (wrong magic bytes) rejected with no
  catalog row; missing packageName/name rejected (never guessed from the
  file); an invalid category rejected; a missing file field rejected; a
  150MB+1-byte upload rejected with 413 before reaching storage or the
  database; **a valid upload's server-computed SHA-256 verified against
  an independently-computed hash of the exact same bytes, its storage key
  verified random (uuid-shaped, never the original filename), and the
  resulting catalog row's `appSource`/`apkSha256`/`apkSizeBytes`/`apkUrl`
  all verified correct**; two uploads getting two different randomized
  keys; **`apkUrl`/`apkSha256` verified present in a real device
  `/sync` response for an APK-source app the device is allowed, and
  verified `null` for a genuine Play-sourced app on the same sync
  response**; **storage failure (an unreachable endpoint) verified to
  leave zero catalog rows**; missing `APK_STORAGE_*` config on a whole
  server instance verified to fail closed the same way; **a real
  Postgres failure engineered deterministically** (the `apps_catalog`
  table is renamed away for the duration of one request, so the `INSERT`
  genuinely fails with a real "relation does not exist" error, then
  renamed back) **verified to trigger cleanup of the just-uploaded
  object — the fake bucket's object count returns to exactly what it was
  before the failed request**; re-uploading the same `packageName`
  verified to update the existing row rather than duplicate it; and a
  plain Play-sourced `addAppToCatalog`/`GET /api/apps` regression check
  confirming `appSource`/`apkUrl`/etc. are completely unaffected for a
  non-uploaded app.
- **`backend/test-apk-upload-ui-smoke.js`: 5/5 passed**, real headless
  Chromium against the real admin panel: the upload button is enabled
  (no longer the disabled placeholder); clicking it opens the modal with
  an empty form and populated category options; submitting an invalid
  package name shows the correct Hebrew validation message and creates no
  row; **a real end-to-end upload through the actual UI** (real file
  input via Playwright's `setInputFiles`, real `XMLHttpRequest` multipart
  POST, real fake-S3 backend) succeeds, shows the Hebrew success message,
  closes the modal, and the catalog re-renders with exactly one visible
  "APK" badge; and no uncaught JavaScript exception occurred anywhere in
  the flow.
- **A test-authoring bug found and fixed while writing the integration
  suite** (not a product bug): `assert.strictEqual(res.status, 200, await
  res.text())` eagerly evaluates its third argument regardless of whether
  the assertion passes, consuming the response body stream before a
  later `res.json()` call could read it (`TypeError: Body is unusable`).
  Fixed by reading the body exactly once (`res.text()`, then
  `JSON.parse`) rather than reading it twice.
- **A fake-S3 test-double bug found and fixed** (also not a product bug —
  in `fakeS3Server.js`, not `apkStorage.js`): the AWS SDK appends a
  diagnostic query parameter to its request URL that differs per
  operation (`?x-id=PutObject` vs `?x-id=DeleteObject`) even for the exact
  same object key. The fake server was using the full request URL
  (path + query string) as its object-identity key, so a `PUT` and a
  later `DELETE` for the same real S3 key looked like two different
  objects and the "DB failure triggers cleanup" test failed with the
  object count one higher than expected. A real S3/R2 bucket identifies
  an object by path alone; fixed by stripping the query string before
  using it as the map key.
- **Full regression, this update — every suite on the branch, all
  clean:** `test-app-categories.js` 11/11, `test-browser-policy.js`
  55/55, `test-policy-signing.js` 25/25, `test-db-integration.js` 46/46,
  `test-admin-ui-e2e.js` 38/38, `test-app-catalog-integration.js` 20/20,
  `test-app-catalog-ui-smoke.js` 13/13, `test-policy-signing-integration.js`
  19/19, `test-browser-load.js` 28/28 (including its real
  `service postgresql stop`/`start` fail-closed test). **Zero failures,
  zero regressions from adding this feature.**
- **CodeQL**: this update's commit was pushed to the already-present
  workflow (`.github/workflows/codeql.yml`) to trigger it. As with every
  prior phase, **this session cannot observe the GitHub Actions run
  result directly** — reported honestly rather than assumed clean. Check
  `https://github.com/05484ym-max/android-mdm-system/actions` for the
  actual result.

**Phase 2.4 correction — device-complete snapshot + rollback fix, this update.**

Exact environment: same real local PostgreSQL 16 (`browser_test` database)
and real spawned/killed server processes as the original Phase 2.4 work,
now running on top of the just-merged `origin/main` state.

- **`backend/test-policy-signing.js`: 25/25 passed** (was 21 — 4 net new:
  a tampered-`deviceOverrides` test, a `deviceOverrides`-ordering-
  independence test, a "no `allowSubdomains` on overrides" test, and an
  explicit "signs the SAME `policyVersion` again without error" test).
  Every pre-existing test updated for the `globalDomains`/`deviceOverrides`
  shape and re-verified passing.
- **`backend/test-policy-signing-integration.js`: 19/19 passed** (was 11 —
  8 net new, all against real Postgres + real HTTP): `deviceOverrides`
  present-and-empty for a device with none; a device override `ALLOW`
  appearing alongside a global `BLOCK` for the same domain (and vice
  versa) — proving the data needed for correct precedence is present,
  without the server resolving it itself; **device A never receiving
  device B's overrides** (two real devices, cross-checked both ways); a
  global `allowSubdomains` rule and an exact device override on one of its
  subdomains both appearing in their own correct arrays, never flattened
  or duplicated into the other's; deterministic `deviceOverrides` ordering
  across two real fetches; tampering with `deviceOverrides` on a real
  server-issued envelope invalidating its signature; and an explicit,
  dedicated real-HTTP test that a freshly-generated snapshot with the
  *same* `policyVersion` as a prior real fetch is accepted (200, valid
  signature) — equal is not a rollback.
- **Full regression after the main-merge and both corrections — every
  suite now on this branch, all clean:** `test-browser-policy.js` 55/55,
  `test-app-categories.js` 11/11 (from the merge), `test-db-integration.js`
  46/46, `test-browser-load.js` 28/28, `test-admin-ui-e2e.js` 38/38,
  `test-app-catalog-integration.js` 20/20 (from the merge),
  `test-app-catalog-ui-smoke.js` 13/13 (from the merge), `test-db.js`
  clean. **255 tests total across 9 suites, zero failures, zero
  regressions from the merge or the corrections.**
- **CodeQL**: the workflow (`.github/workflows/codeql.yml`) is now present
  on this branch via the merge, and this update's commit was pushed to
  trigger it. **This session cannot observe the GitHub Actions run result
  directly** (no API/UI access to Actions from this sandbox) — reported
  honestly rather than assumed clean. See KNOWN LIMITATIONS below for
  exactly what that means and how to actually check it.

**Phase 2.4 — signed offline policy snapshot, this update.**

Exact environment: real local PostgreSQL 16 (`browser_test` database, same
as prior phases), real running `backend/index.js` processes (this phase's
integration suite spawns three separate ones itself — a main fixture plus
two deliberately-misconfigured ones for the fail-closed tests — see
`backend/test-policy-signing-integration.js`'s header), and real,
freshly-generated Ed25519 keypairs (`crypto.generateKeyPairSync`) held only
in memory for the duration of each test run — **no key material is
committed anywhere in this repo.**

- **`backend/test-policy-signing.js`: 21/21 passed** (pure, no DB/network):
  real sign+verify round-trip, verification failing against the wrong
  public key, a tampered payload (domain, added row, expiry) failing
  verification, a tampered `policyVersion` specifically failing
  verification (both higher and lower), canonicalization being independent
  of object key order (including nested), canonicalization throwing on
  `undefined` instead of corrupting the byte stream, two independent
  builds of the same logical snapshot producing byte-identical canonical
  bytes, **domain input order provably not affecting the resulting
  canonical bytes/signature** (three domains fed in two different orders,
  byte-identical output), snapshot expiry at/after/before the exact TTL
  boundary, `loadSigningConfig` failing closed for a missing key, a
  missing keyId, garbage PEM content, and a real-but-wrong-algorithm key
  (RSA) — and succeeding correctly for both an escaped-newline PEM and a
  base64-encoded PEM, `derivePublicKeyInfo` never including any private
  key marker in its output, the monotonicity guard allowing forward/equal
  versions and rejecting a regression, `signSnapshot` itself refusing to
  sign a regressed version, and `buildBrowserPolicySnapshot` rejecting a
  negative/non-integer `policyVersion`.
  - **One real test-isolation bug found and fixed while writing this
    suite** (not a bug in `policySigning.js` itself): the monotonicity
    high-water mark is deliberately process-global state, so the test
    file's own sequence of unrelated `signSnapshot()` calls with
    independently-chosen `policyVersion` values tripped the guard against
    each other. Fixed by resetting the tracker at the start of every test
    case — a test-harness fix only, confirmed by first proving each
    individual assertion was semantically correct in isolation.
- **`backend/test-policy-signing-integration.js`: 11/11 passed** (real
  Postgres + real HTTP): device auth enforcement (missing/wrong
  token/unknown device all correctly rejected, correct token succeeds with
  a signature that verifies against the real public key), a REVIEW-decision
  domain excluded from the snapshot while ALLOW/BLOCK rows appear with the
  correct fields, `policyVersion` matching live `browser_policy_meta` and
  strictly increasing after a real policy write, two consecutive fetches
  agreeing on policy content while each independently verifies (see below
  for what "determinism" actually means here), the admin signing-key
  endpoint exposing exactly the public key that verifies real snapshots
  (cross-checked two different ways) with its own auth enforced, and —
  against two separate, genuinely misconfigured real server processes —
  both a missing signing key and a malformed signing key producing a real
  5xx with no envelope-shaped body.
  - **One real test-design bug found and fixed** (not a product bug): the
    first version of the "two consecutive fetches" test asserted
    byte-identical envelopes, which is actually wrong given this phase's
    own deliberate no-caching design — `generatedAt`/`expiresAt` are real
    wall-clock timestamps computed fresh on every request, so two real
    HTTP calls milliseconds apart legitimately produce slightly different
    (and therefore differently-signed) envelopes. Root-caused by checking
    the actual field values in the failure output before changing
    anything, then rewrote the test to check what's actually invariant
    (policy content, and each envelope's own internal consistency and
    validity) rather than something that was never true by design.
- **Zero changes to `browserPolicy.js`, the `/browser/check` route, or any
  pre-existing `db.js` function** — confirmed via `git diff --stat`
  showing no lines touched in `browserPolicy.js` at all.
- **Full regression, re-run after this phase's changes: 55/55**
  (`test-browser-policy.js`), **46/46** (`test-db-integration.js`),
  **28/28** (`test-browser-load.js`), **38/38**
  (`test-admin-ui-e2e.js`) — all unchanged from Phase 2.3, zero
  regressions.
- **CodeQL**: not available to run in this sandbox — no `codeql` CLI
  installed, and the CodeQL GitHub Actions workflow that exists on `main`
  (and on the separate `app-store-categories`/`app-update-check` branches)
  has not been merged into `filtered-browser-server`, which this phase's
  instructions did not ask for. In its place: a manual review pass for the
  issue classes CodeQL's JS/TS queries typically flag (secrets in code,
  logged sensitive material, unsafe deserialization) — confirmed no key
  material is ever logged (grepped every `console.*` call in both new
  files) and no key material is hardcoded anywhere in `backend/**` outside
  test files' own ephemeral, runtime-generated keys. This is a real gap
  relative to the instruction to "run any available CodeQL checks" — there
  simply isn't one available on this branch, stated plainly rather than
  glossed over.
- **What remains unverified**: any of this against a real deployed signing
  key or the actual Render production environment (everything here ran
  against a disposable local Postgres and locally-spawned server
  processes); real Android-side verification (explicitly not implemented,
  per instruction); real key rotation (the `keyId` mechanism is designed
  for it and unit-tested for shape, but no second real key was ever
  actually rotated in during a test).

**Phase 2.3 — load / abuse / failure hardening, this update.**

Exact environment: the same real local PostgreSQL 16 `browser_test`
database as Phase 2.1/2.2, a real running `backend/index.js` for the bulk
of the suite, plus a second real backend process this suite itself spawns
and kills for the restart test, and a real `service postgresql stop`/
`start` for the dependency-unavailable test. Setup/run commands documented
at the top of `backend/test-browser-load.js`.

- **New load/abuse/failure suite: 28/28 passed** (3 load/concurrency, 13
  failure-behavior, 4 rate-limit, 7 query-plan, 1 restart/persistence — see
  DONE above for what each one actually proves and the real numbers
  observed).
- **Real product bug found and fixed: 1** — `backend/db.js`'s PostgreSQL
  pool had no `.on('error', ...)` listener, which crashed the entire
  backend process (not just the in-flight request) the moment Postgres
  dropped an idle connection for any reason. Verified for real by stopping
  Postgres under a live server before the fix (process died) and after
  (process logged the error, stayed up, served correct `5xx` responses,
  and recovered cleanly once Postgres came back). This is the one bug this
  phase's bug-hunting round surfaced — see DONE for detail. No other real
  product bug found; `browserPolicy.js`'s decision logic, `index.js`'s
  routes (besides the two additions above), and `admin-panel/**` needed no
  changes.
- **Concurrency/load numbers observed in this environment** (not
  estimates): ~140-210 req/s for a 25-request single-device burst,
  ~300-460 req/s for a 30-device single-domain burst, ~370-380 req/s for a
  36-request mixed-traffic burst. These are sandbox numbers for
  correctness verification, not a production capacity claim.
- **Rate limit introduced**: 40 `/browser/check` calls per rolling 10s
  window per device (`BROWSER_CHECK_RATE_LIMIT_MAX` /
  `BROWSER_CHECK_RATE_LIMIT_WINDOW_MS` env vars), in-memory, single backend
  process — see `docs/server-api-contract.md`'s new "Resource-abuse
  hardening" section for the full behavior and its one real limitation
  (doesn't coordinate across multiple backend instances).
- **Query plans / index changes**: seven hot/admin-path queries verified
  via real `EXPLAIN ANALYZE` at 2000+ seeded rows. Six already use their
  existing indexes. **No index was added** — the one query doing a
  sequential scan (`getBrowserDomainForHost`, because of its per-row
  dynamic `LIKE` predicate) is still sub-millisecond at this volume on an
  admin-curated, not expected to grow into the tens-of-thousands table;
  adding an index without a real slow query to justify it would have been
  guesswork. Full plans are in the suite's console output; the reasoning
  is recorded in DONE above for whoever revisits this later.
- Confirmed unchanged, run immediately before and after this phase's code
  changes (regression requirement): **55/55 unit tests** (49 existing + 6
  new pure-logic tests for the new length caps), **46/46 PostgreSQL
  integration tests**, **38/38 admin-panel E2E tests**.
- **What remains unverified**: real production traffic volumes/patterns
  (this suite's bursts are synthetic and sized for correctness proof, not
  a load-test benchmark); multi-instance/horizontal-scaling behavior of the
  new rate limiter (documented as a known limitation, not tested, since
  there is only one backend instance in this environment and Redis is
  explicitly out of scope for this phase); a genuine production Postgres
  failover/replica scenario (this phase tested a full service stop/start
  of a single local instance, which is the closest real approximation
  available here, not a managed Postgres provider's actual failover
  behavior).

**Phase 2.2 — real admin-panel UI E2E, this update.**

Exact environment: real headless Chromium (pre-installed in this sandbox
under `/opt/pw-browsers`, launched via the `playwright` package, resolved
executable path logged at the top of the run rather than hardcoded to one
version), driving the real `admin-panel/index.html` served by a real
running `backend/index.js`, backed by the same real local PostgreSQL 16
`browser_test` database used in Phase 2.1. Setup/run commands documented
at the top of `backend/test-admin-ui-e2e.js`.

- **E2E tests: 38/38 passed** (after fixing 4 test-harness bugs found on
  the first run — see DONE for the full breakdown; all four were in the
  test script itself, not in `admin-panel/**` or `backend/**`).
- **Real product bugs found in the admin panel: 0.**
- Zero uncaught JavaScript exceptions during the entire run (tracked via
  Playwright's `pageerror` event, asserted at the end). The suite's own
  negative-path tests generate expected `console.error` noise (Chromium
  logging its own failed 401/404/400 fetches) — tracked separately as
  informational, never asserted on.
- Confirmed unchanged, run immediately before and after this phase's work
  (Section H "regression" requirement): **49/49 unit tests**, **46/46
  PostgreSQL integration tests** — identical counts to Phase 2.1, since no
  source file besides the new E2E test itself was touched.
- **What remains unverified**: a genuine 500/backend-failure UI path (no
  safe way found to force one through the real UI without corrupting
  shared server state for later tests in the same run — documented
  in-line in the test's own output rather than skipped silently; the
  underlying "never fabricate success on a server failure" guarantee is
  already proven at the HTTP layer in `test-db-integration.js`, and
  `browser.js`'s fetch error handling was additionally confirmed by direct
  code reading). Also unverified: real mobile/touch browsers, any browser
  other than Chromium, and the actual Render production deployment (this
  suite only ever runs against a disposable local test database).

**Phase 2.1 (PostgreSQL integration), unit tests (pure), and earlier
phases — all real, run-every-time, no framework needed:**
- Syntax: `node --check` on `db.js`, `index.js`, `browserPolicy.js` — pass.
- 44/44 unit tests pass, covering:
  - Boundary-aware matching (`domainCovers`): exact, subdomain with/without
    `allowSubdomains`, deep subdomain, and the two adversarial "looks like
    a match but isn't" cases (`badexample.com`, `example.com.evil.com`).
  - Rule-write validation (`validateDomainRuleInput`): every rejection
    reason in the table above, each asserted individually.
  - Public Suffix rejection: `co.uk`, `github.io` (with and without
    `allowSubdomains`), `blogspot.com`, `appspot.com` all rejected;
    `someuser.github.io` (a specific site, not the shared boundary itself)
    correctly accepted.
  - IDN/Punycode: a Unicode domain and its Punycode equivalent canonicalize
    to the identical stored value; same for uppercase and a trailing dot.
  - Fail-closed robustness: non-string input (numbers, objects, arrays,
    functions) and pathological strings (10,000-char string, null bytes,
    `....`) never throw and never return an accepting verdict without
    going through real validation.
  - Confirmed the real behavior of `tldts` directly (not assumed) against
    all the domains this task cares about before wiring it in — see the
    `parsed.domain === null` boundary for `github.io`/`co.uk`/`blogspot.com`/
    `appspot.com` vs. `someuser.github.io`.
- **NOT tested**: no live Postgres in this environment, so the actual SQL
  (transactions, `ON CONFLICT`, the partial unique index) is still only
  hand-reviewed, not exercised against a real database — same disclosed
  limitation as Phase 1.

**Phase 2 additions** (49/49 total now, `node backend/test-browser-policy.js`):
- Extracted `browserPolicy.applyRequestResolution(devices, action)` — a
  pure, DB-free mirror of `resolveBrowserRequest`'s SQL semantics (documented
  in its own comment as a specification/test mirror, not something called
  from the real request path — the live DB transaction is what actually has
  to be race-safe, not a plain JS array transform). Used it to write real,
  passing tests for exactly the scenario flagged as critical:
  - Two devices share a request; resolving device A leaves device B still
    at `decision: null` (not fully resolved).
  - Resolving the last still-waiting device flips the request to fully
    resolved.
  - A `GLOBAL` resolution answers every still-waiting device at once.
  - A duplicate `DEVICE` resolution attempt never overwrites an
    already-answered device's earlier decision.
  - A later `GLOBAL` resolution never overwrites a device that already got
    an individual answer — only devices still waiting are affected.
- **Explicitly NOT tested against a live database** (same disclosed gap as
  Phase 1/1.1, now applying to more surface area): the actual transaction/
  rollback behavior, `policyVersion`/`decisionVersion` bump correctness,
  audit-row creation, and concurrent-resolve race safety are hand-reviewed
  in the SQL (every multi-statement write is wrapped `BEGIN`/`COMMIT`/
  `ROLLBACK`; every resolve path uses a `WHERE decision IS NULL` /
  `WHERE status = 'PENDING'` guard specifically so two concurrent resolve
  attempts can't both "win") but not exercised against Postgres. Also not
  tested end-to-end: `requireAdmin` rejecting an unauthenticated request
  (pre-existing, unchanged logic — only extended to expose `req.admin`) and
  the admin-panel UI itself (no browser/DOM environment here — reviewed by
  reading the code, not by clicking through it).

**Phase 2.1 — REAL PostgreSQL integration, this update.** The Phase 1/1.1/2
"not tested against a live database" gap above is now closed for backend
logic (admin-panel UI clicking-through remains untested, no DOM here).

Exact numbers, both suites run clean back-to-back immediately before this
report was written:
- **Unit tests (pure, no DB): 49/49 passed** (`node backend/test-browser-policy.js`, unchanged this phase).
- **PostgreSQL integration tests: 46/46 passed**, against a real local
  PostgreSQL 16 server + a real running instance of `index.js` over real
  HTTP (`node backend/test-db-integration.js` — setup/run commands
  documented at the top of that file). Not against a mock, not skipped.
  - **Concurrency tests: 2/2 passed** — real `Promise.all`-fired races
    (two concurrent `DEVICE`-scope resolves for the same request+device;
    two concurrent `GLOBAL`-scope resolves for the same request), each
    asserting exactly one call wins, no double write, no double audit row.
  - **Rollback tests: 3/3 passed** — a real forced late-transaction
    failure (via a temporary trigger, not a mock — see DONE for why the
    first approach tried, REVOKE-based fault injection, doesn't work
    against a table's own owner role) for `upsertBrowserDomain`,
    `resolveBrowserRequest(GLOBAL)`, and `resolveBrowserRequest(DEVICE)`
    each, confirming zero partial state and an unchanged `policyVersion`
    after every one.
  - Also covered for real: schema/migration creation and idempotent
    re-run, `policyVersion` and `decisionVersion` bump correctness
    (including under the concurrent-upsert case), request deduplication
    under 5 concurrent devices, the full shared-request DEVICE/GLOBAL
    resolution semantics from Phase 2, 9 domain-validation rejection
    cases plus 2 canonicalization cases at the real HTTP layer with
    direct DB row checks, 3 audit-trail shape checks, 6 auth-integration
    cases (missing session, valid session, wrong device token, mismatched
    device/token, unknown device, correct token), and 2 end-to-end
    fail-closed checks (`REVIEW` for an unseen domain, `BLOCK` for a
    dangerous scheme) through the real HTTP endpoint.
- Docker was not usable in this environment (no daemon socket) — a real
  local PostgreSQL 16 server was already installed and was used directly
  instead, per the instruction to try a local alternative before falling
  back to "not verified."
- Not covered even now: the admin-panel UI itself (no browser/DOM
  environment available here) and the actual Render/production deployment
  (this suite runs against a disposable local test database, never
  anything with real customer data).

## CLIENT IMPACT

`ALLOW`/`BLOCK`/`REVIEW` and every existing JSON field are unchanged —
Phase 2.3 does not alter the decision logic at all. Two new, narrow ways
`/browser/check` can respond that GPT's client needs to be ready for
(both already covered by the client's existing fail-closed contract, since
both are non-2xx with no decision object, exactly like any other error):
- **HTTP 429** if a device calls `/browser/check` more than 40 times in a
  rolling 10-second window — `{ "error": "too many browser checks, try
  again shortly" }`. Legitimate browsing (even fast page navigation with a
  handful of checks per load) should never come close to this; it only
  engages under a flood. The client should treat it exactly like a 5xx —
  stay blocked, and its normal retry/backoff (if any) will naturally clear
  it once the window rolls over.
- **HTTP 400** for a `url` over 8192 characters — folded into the existing
  "url must be a valid absolute URL" 400 response the client already
  handles, not a new error shape.
- A hostname over 253 characters (a real DNS-length violation) now
  produces `BLOCK` with the *existing* `reason: "invalid_or_ip_literal_host"`
  — no new reason string, same handling as an IP-literal host already
  required.
See `docs/server-api-contract.md`'s new "Resource-abuse hardening" section
for the full detail. GPT does not need to change anything in `/client/**`
for this update — client-side, this only matters if it starts sending
navigation checks fast enough to hit a rate a real user could never
produce by clicking around.

**Phase 2.4**: `/browser/check`'s `ALLOW`/`BLOCK`/`REVIEW` decision logic
and response shape are **completely unchanged** — confirmed via
`git diff` showing zero lines touched in `browserPolicy.js`. This phase
only adds two brand-new, opt-in endpoints
(`GET /api/devices/:deviceId/browser/policy-snapshot` and
`GET /api/browser/policy/signing-key`) that nothing existing calls. **GPT
does not need to change anything in `/client/**` for this update** — per
the task's own explicit scope, Android-side verification and local
caching are not implemented here; see docs/server-api-contract.md's new
"Signed offline policy snapshot (Phase 2.4)" section for the exact
contract to implement whenever that work is greenlit (it names the
`filtered-browser-client` doc's own `NEXT` item 5 as the point where this
becomes relevant — i.e. after physical-device Phase 0A verification, not
before).

**Phase 2.4 correction**: the snapshot payload shape changed from the
original Phase 2.4 report — `payload.domains` is now
`payload.globalDomains` + a new `payload.deviceOverrides` array (see
docs/server-api-contract.md's "Device overrides in the snapshot"). This
is a contract correction caught before any client code was ever written
against it (`/client/**` still has zero lines related to this endpoint) -
good timing, not a breaking change to anything real. The anti-rollback
wording was also corrected (equal `policyVersion` must be accepted, not
rejected) - same situation, corrected before any client implemented the
wrong version. `/browser/check` and `/sync` remain completely untouched.
**GPT still does not need to change anything in `/client/**` for this
update.**

**Persistent APK upload**: `/browser/check`, `/api/devices/:deviceId/browser/policy-snapshot`,
and every existing `/sync` field are unchanged. `/sync`'s `catalog` array
gains four new, purely additive fields per app —
`appSource`/`apkUrl`/`apkSha256`/`apkSizeBytes` — with `apkUrl`/
`apkSha256`/`apkSizeBytes` always `null` for a Play-sourced app. **GPT
does not need to change anything in `/client/**`/`dpc-app/**` for this
update to keep working exactly as before** — the new fields are purely
additive and only meaningful for an app a device is allowed that also
happens to be `appSource: "APK"` (none exist yet unless an admin uploads
one). Actually downloading/installing/verifying an APK from `apkUrl` on
the device side is intentionally not implemented here — see
`docs/apk-storage.md`'s "Device sync contract" section for the exact
payload shape whenever that Android-side work is greenlit.

## KNOWN LIMITATIONS

- No Redis, queue, analyzer worker, AI, Safe Browsing integration, domain-age/
  RDAP check, FCM emergency revoke, or policy signing yet — explicitly out
  of scope for this phase per instruction, not started.
- Per-device overrides (`browser_device_overrides`) still don't carry
  `allowSubdomains` at all (schema-level), so the Public Suffix hardening in
  this phase only applies to global rules — intentional, not an oversight
  (see the contract doc's note on `scope: "DEVICE"`).
- Matching still does not re-run Public Suffix logic at read time
  (`domainCovers` is deliberately just boundary-string logic) — the
  invariant that `allowSubdomains=true` only ever exists on a genuine
  registrable domain is enforced once, at write time, not re-derived on
  every check. Documented as a deliberate architecture choice, not a gap.
- **Phase 2**: `browser_device_overrides` still has no `allowSubdomains`
  column — a DEVICE-scope resolution is always exact-domain-only, by design
  (unchanged from Phase 1).
- **Phase 2**: `browser_policy_audit.actor` identifies the shared admin
  login, not a specific real person — there is no per-admin account system.
  Acceptable for a single-operator panel; would need real multi-admin
  auth to mean more than that.
- **Phase 2**: the admin panel's "delete rule" and "edit rule" both reuse
  the existing single `POST /api/browser/domains` (upsert) / new `DELETE`
  endpoint — there is no separate `PATCH`. Deliberate: one write path per
  resource is simpler to validate and audit than two overlapping ones.
- No automatic approval, AI, Redis, queue, analyzer worker, Safe Browsing,
  RDAP/domain-age, FCM emergency revoke, or policy signing yet — explicitly
  out of scope for Phase 2 per instruction, not started.
- **Phase 2.1**: the integration suite runs against a disposable local
  Postgres 16 instance created for this task (`browser_test` DB, dropped/
  recreated each time it's run) — it is not, and has never been, connected
  to the real Render deployment or any real customer data. The local
  Postgres server + `browser_test_user` role/database exist only inside
  this environment; a future session/environment needs the one-time setup
  documented at the top of `backend/test-db-integration.js` before this
  suite can run there too.
- **Phase 2.1**: the admin-panel UI itself is still not exercised by any
  test — there's no browser/DOM environment available here. Everything
  verified this phase is backend (API + database) behavior.
- **Phase 2.2**: the admin-panel UI gap above is now closed (real headless
  Chromium, real clicks/forms, 38/38 passed) but three things remain
  unverified: a genuine HTTP 500 reaching the UI (no safe way to force one
  without corrupting shared server state — the underlying fail-safe
  guarantee is already proven at the HTTP layer in the Phase 2.1 suite, and
  `browser.js`'s fetch-error handling was confirmed by code review only);
  real mobile browsers or non-Chromium desktop browsers; and the actual
  Render production deployment (this suite still runs only against a
  disposable local `browser_test` database, never real customer data).
- **Phase 2.3**: the new rate limiter is in-memory/single-process (see
  CLIENT IMPACT and the contract doc's Known Phase 1 limitations) — real
  multi-instance horizontal scaling is not tested or supported by it yet,
  since there is only one backend instance in this environment. The
  load/concurrency numbers recorded this phase are real but are sandbox
  correctness-verification numbers, not a production capacity benchmark —
  no attempt was made to simulate the actual Render production environment's
  hardware/network characteristics. A genuine managed-Postgres failover
  (as opposed to a local `service postgresql stop`/`start`, the closest
  real approximation available here) also remains unverified.
- **Phase 2.4**: no Android verification code and no local client caching
  exist yet — explicitly out of scope per instruction, not started. The
  admin-only public-key endpoint, the exact canonical-serialization rules,
  and every failure mode were tested against a real Ed25519 keypair
  generated fresh for each test run, but never against a real deployed
  production signing key, a real Android verifier, or the actual Render
  environment. Key rotation is designed for (the `keyId` field exists
  specifically so more than one key can be trusted at once) but was never
  exercised with a genuine second key in a test. CodeQL was not run — no
  CLI available in this sandbox and the CodeQL workflow (added on `main`)
  has not been merged into this branch; a manual review for logged/
  hardcoded secrets was done in its place (see TESTED above).
- **Phase 2.4 correction**: the CodeQL workflow is now on this branch (via
  the main-merge) and this update's commit was pushed to trigger it, but
  **this session has no visibility into GitHub Actions run results** - no
  API or web access to Actions from this sandbox. The push happened; the
  actual scan result (pass/fail/findings) has not been observed or
  reported here as clean, and must not be assumed clean just because the
  workflow exists and local tests pass. Check
  `https://github.com/05484ym-max/android-mdm-system/actions` (or the
  "Security" → "Code scanning" tab) after this push to see the real
  result.

- **Persistent APK upload**: no real Cloudflare R2 bucket/credentials or
  network reachability exist in this sandbox — `backend/fakeS3Server.js`
  (a real local HTTP server, not a mock of the AWS SDK) stands in for it;
  see `docs/apk-storage.md`'s "Testing notes" and "What could not be
  verified" for the precise scope of what that does and doesn't prove
  (in particular: it never checks AWS SigV4 request signing, so real
  credentials/signing against an actual R2 endpoint remain unverified).
  No APK content validation beyond a ZIP-magic-bytes check exists — no
  manifest parsing, no signing-certificate check, no cross-check that the
  admin-supplied `packageName` matches what the APK actually contains
  (there is no such parser among this project's dependencies; explicitly
  out of scope per instruction). Android-side install/verification logic
  is not implemented — server/admin-only, per this branch's standing
  scope. Direct unsigned client-to-bucket upload (the admin's browser
  uploading straight to R2 with a presigned URL, bypassing this backend
  entirely) was explicitly deferred — today's backend-authenticated
  upload path was called out as acceptable for this phase.

## NEXT

WAIT FOR GPT INSTRUCTION.
