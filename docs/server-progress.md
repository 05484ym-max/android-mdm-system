# Filtered Browser Server Progress

Branch: `filtered-browser-server`
Owner: Claude

## DONE

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

All real, run-every-time (`node backend/test-browser-policy.js`), no
framework needed:
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

None on the wire contract — `ALLOW`/`BLOCK`/`REVIEW` and every JSON field
GPT's client depends on are unchanged. Phase 2.1 added test coverage only —
`db.js`, `index.js`, and `browserPolicy.js` were not modified at all this
phase, only `backend/test-db-integration.js` was added. GPT does not need
to change anything in `/client/**` for this update.

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

## NEXT

WAIT FOR GPT INSTRUCTION.
