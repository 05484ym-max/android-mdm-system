# Filtered Browser Server Progress

Branch: `filtered-browser-server`
Owner: Claude

## DONE

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

## NEXT

WAIT FOR GPT INSTRUCTION.
