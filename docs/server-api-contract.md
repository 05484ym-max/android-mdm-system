# Filtered Browser — Server API Contract

Owner: Claude (Backend / Admin / Worker)
Status: Phase 1 + 1.1 (hardening) + 2 (admin workflow) + 2.3 (load/abuse/failure hardening) IMPLEMENTED — see Known Phase 1 Limitations (still current for anything not covered by Phase 2/2.3)
Branch: `filtered-browser-server`

This document describes what the server actually guarantees to the Android
client today. It is written against `/docs/client-api-requirements.md` and
does not deviate from the shared contract there. If anything here needs to
differ from that draft, this file is updated first and the difference is
called out explicitly — nothing is changed silently.

## Shared decision values (frozen)

```
ALLOW | BLOCK | REVIEW
```

No fourth value exists anywhere in this API. The server never returns
`ALLOW` as a fallback for a timeout, an internal error, a missing analysis,
or an unavailable dependency — those cases are either a non-2xx HTTP
response (see "Fail-closed guarantee" below) or an explicit `BLOCK`/`REVIEW`
decision object, never silence and never `ALLOW`.

## Endpoint: check a navigation target

```
POST /api/devices/:deviceId/browser/check
Authorization: Bearer <deviceToken>      (identical to /api/devices/:deviceId/sync)
Content-Type: application/json

{ "url": "https://example.com/path" }
```

### Response — 200, a decision was made

```json
{
  "decision": "ALLOW",
  "domain": "example.com",
  "decisionVersion": 3,
  "policyVersion": 12,
  "expiresAt": "2026-09-03T05:47:24.000Z",
  "allowSubdomains": false,
  "reason": "global_policy",
  "confidence": 0.92,
  "riskScore": 0.03
}
```

Field meaning:
- `decision` — `ALLOW` / `BLOCK` / `REVIEW`, per the shared vocabulary above.
- `domain` — the normalized (lowercased, no trailing dot) host the decision
  applies to. For a forbidden-scheme request with no real host (see below),
  this is the scheme itself (e.g. `"javascript:"`), for audit purposes only.
- `decisionVersion` — integer, specific to this domain's row in
  `browser_domains`. Increments every time an admin changes that domain's
  decision. `0` when there is no stored row at all (i.e. every `REVIEW`
  from an unknown domain).
- `policyVersion` — a single **global** monotonic integer, incremented on
  every admin browser-policy write (a domain decision or a device
  override). Intended for the client to detect a stale/rolled-back local
  cache once it has one (see Known Phase 1 Limitations — the client has no
  real cache to protect yet).
- `expiresAt` — ISO-8601 timestamp. `ALLOW`/`BLOCK` are valid for 24h from
  the moment they were computed; `REVIEW` always expires immediately
  (`expiresAt` = now) — it must never be cached client-side even briefly.
- `allowSubdomains` — whether this decision's domain rule covers
  subdomains. Always `false` for a device override or for `REVIEW`.
- `reason` — short machine-readable string, e.g. `global_policy`,
  `device_override`, `no_policy_decision_yet`, `forbidden_scheme`,
  `invalid_or_ip_literal_host`.
- `confidence`, `riskScore` — present only when the matched policy row set
  them (Phase 1 admins are not required to fill these in when manually
  approving a domain, so they are frequently absent — the client must treat
  a missing value as "no signal", not as `0`).

### Response — 400, the request itself is malformed

Only when `url` is missing or does not parse as a URL at all (e.g. `""`,
not a string, or a string not accepted by the WHATWG URL parser):

```json
{ "error": "url must be a valid absolute URL" }
```

This is a client-side bug signal, not a policy decision — it means the
client sent something that isn't a URL, which should never happen from a
correctly implemented navigation interceptor.

### Response — 401/404, device auth failure

Identical semantics to `/api/devices/:deviceId/sync`: `404` if the device
doesn't exist, `401` if the bearer token doesn't match. No decision object
is returned either way.

### Response — 5xx, internal error

```json
{ "error": "internal error" }
```

**The client MUST treat this exactly like a timeout or a network failure:
the site stays blocked.** The server deliberately does not catch internal
errors into a synthetic `REVIEW`/`BLOCK` JSON body — a 500 with no decision
object is itself the fail-closed signal, matching what
`client-api-requirements.md` already commits to on the client side
("Server/dependency failure => non-ALLOW response/error; the client
remains blocked").

## Dangerous schemes and hosts (explicit BLOCK, not a request error)

`file:`, `data:`, `javascript:`, `blob:`, `intent:`, and any scheme other
than `http`/`https` resolve to an explicit `BLOCK` with
`reason: "forbidden_scheme"` — **not** a 400. The client asking about one of
these is itself meaningful signal (e.g. it means a client-side guard was
bypassed or hasn't been added yet for that particular scheme), not a
malformed request.

Note for implementers: `file:`, `data:`, `javascript:`, and `blob:` all
parse with an **empty hostname** in a standard URL parser (verified
directly against Node's own `URL` implementation), while `intent://` often
does have one (e.g. `intent://scan/...` → host `scan`). Both cases are
handled — the scheme check runs before any host check, never after.

A syntactically-invalid host, or a bare IP-literal host (`192.168.1.1`,
`::1`) on an otherwise-valid `http`/`https` URL, is also an explicit `BLOCK`
with `reason: "invalid_or_ip_literal_host"` — a raw IP can't be evaluated
against a domain policy in any meaningful way, and is a common evasion
technique.

## Fail-closed decision logic

| Situation | Decision |
|---|---|
| Per-device override exists for this host | Override's `ALLOW`/`BLOCK` |
| Global `browser_domains` row exists (exact or subdomain-eligible ancestor) with `ALLOW`/`BLOCK` | That decision |
| No row anywhere for this host | `REVIEW` (a request is recorded — see below) |
| Global row exists but is explicitly `REVIEW` | `REVIEW` |
| Forbidden scheme | `BLOCK` |
| Invalid host / bare IP literal | `BLOCK` |
| Malformed request (no parseable URL) | HTTP 400, no decision object |
| Internal error / dependency unavailable / timeout | HTTP 5xx or no response — client treats as blocked, server never fabricates `ALLOW` |

`ALLOW` is returned **only** when an admin has explicitly recorded that
decision (globally or for that device). There is no automatic/AI-driven
`ALLOW` path in Phase 1 — see Known Phase 1 Limitations.

## Resource-abuse hardening (Phase 2.3)

Three additions, none of which change `ALLOW`/`BLOCK`/`REVIEW` semantics or
any existing response field — they only tighten what counts as a malformed
or abusive request, verified for real under load (see
`backend/test-browser-load.js`):

- **Overlong `url`**: a `url` longer than 8192 characters is treated exactly
  like an unparseable URL — HTTP 400, `{ "error": "url must be a valid
  absolute URL" }`, no decision object. Well beyond any real navigation
  target a filtered browser needs to check.
- **Overlong host**: a hostname longer than 253 characters (the real DNS
  name-length ceiling) is rejected the same way an IP-literal host already
  was — `BLOCK` with `reason: "invalid_or_ip_literal_host"`, not a 400 (the
  request itself still parsed fine; the *host* just can't be a real DNS
  name). Applies identically to `POST /api/browser/domains`'s admin-rule
  validation.
- **Per-device rate limit on `/browser/check`**: at most 40 calls per
  rolling 10-second window per `deviceId` (both configurable via
  `BROWSER_CHECK_RATE_LIMIT_MAX` / `BROWSER_CHECK_RATE_LIMIT_WINDOW_MS`, in
  case a real fleet's legitimate browsing pattern ever needs a different
  ceiling). Exceeding it returns:
  ```
  HTTP 429
  { "error": "too many browser checks, try again shortly" }
  ```
  No decision object — the client already treats any non-2xx exactly like a
  timeout (stays blocked), so this can never become a silent `ALLOW`. Purely
  in-memory, per backend process, keyed by `deviceId` (no Redis, no shared
  state across processes — acceptable for the current single-instance
  deployment, called out again under Known Phase 1 limitations below). A
  device that
  exceeds its window can check again once the window rolls over — this is a
  throttle, not a ban.

## Request queue (unknown domains)

Every time a device hits a domain with no policy row, the server records a
`browser_requests` row keyed by domain — concurrent first-seen requests
from many devices for the *same* domain collapse into one row (a unique
partial index on `domain WHERE status = 'PENDING'` enforces this at the
database level), with each distinct requesting device tracked separately
for the admin panel's "how many users asked for this" count. This is the
thundering-herd protection called for in the architecture review: one
job per domain, never one per request.

## Admin endpoints

All require the existing admin session cookie (`requireAdmin`, same as
every other `/api/...` admin route).

```
GET  /api/browser/domains?search=<text>&decision=ALLOW|BLOCK|REVIEW
```
Returns rows from `browser_domains` (global policy), most recently updated
first. Both query params are optional; `search` is a case-insensitive
substring match on the domain.

```
POST /api/browser/domains
{ "domain": "example.com", "decision": "ALLOW", "allowSubdomains": false,
  "category": "news", "riskScore": 0.1, "confidence": 0.9, "reason": "..." }
```
Directly sets (or updates — same endpoint, upsert semantics) the global
decision for a domain — bypasses the request queue entirely (e.g. for
pre-seeding a known-good/known-bad list, or editing an existing rule's
category/reason/`allowSubdomains`). Bumps that domain's `decisionVersion`
and the global `policyVersion`, and writes an audit row (action
`domain_upsert`). `domain` is validated before being written — see "Domain
rule validation" below. An invalid domain returns HTTP 400, never reaches
the database:
```json
{ "error": "invalid domain: <reason>" }
```

```
DELETE /api/browser/domains/:domain
{ "reason": "..." }
```
*(Phase 2)* Deletes a global rule — the domain reverts to "no decision"
(evaluates to `REVIEW` again on the next `/browser/check`, exactly as if it
had never been ruled on). Never touches `browser_device_overrides` or
request history. Writes an audit row (action `domain_delete`, `newDecision:
null`). Returns 404 if no rule exists for that domain.

```
GET  /api/browser/requests
```
Returns every request still `PENDING` overall (see "Shared-request
resolution" below for what that means once more than one device is
involved), each shaped as:
```json
{
  "id": "...", "domain": "example.com", "exampleUrl": "https://example.com/x",
  "requesterCount": 2, "totalRequesterCount": 3,
  "createdAt": "...", "lastRequestedAt": "...",
  "category": null, "riskScore": null, "confidence": null, "reason": null
}
```
`requesterCount` is devices **still waiting** on a decision (the
operationally meaningful number — this is what changed from Phase 1.1);
`totalRequesterCount` is everyone who ever asked, including anyone already
answered individually via a prior `DEVICE`-scope resolution.

```
GET  /api/browser/requests/:id/devices
```
*(Phase 2)* Per-device breakdown of one request:
```json
[
  { "deviceId": "...", "decision": null, "resolvedAt": null, "createdAt": "..." },
  { "deviceId": "...", "decision": "ALLOW", "resolvedAt": "...", "createdAt": "..." }
]
```
`decision: null` means that device is still waiting. Powers the admin panel's
"show pending devices" view before a `DEVICE`-scope resolve — an admin must
be able to see exactly who is still waiting before picking one.

```
POST /api/browser/requests/:id/resolve
{ "scope": "GLOBAL", "decision": "ALLOW", "reason": "..." }
{ "scope": "DEVICE", "decision": "BLOCK", "deviceId": "...", "reason": "..." }
```
Response:
```json
{ "status": "resolved", "domain": "example.com", "scope": "GLOBAL" }
{ "status": "resolved", "domain": "example.com", "scope": "DEVICE", "deviceId": "...", "requestFullyResolved": false }
```

**As of Phase 1.1**, `scope: "GLOBAL"` also runs the request's stored
domain through the same validation as `POST /api/browser/domains` *before*
resolving — a request whose domain fails validation (e.g. it's a bare
shared-hosting boundary like `github.io`) returns HTTP 400 and is left
**PENDING**, not silently resolved:
```json
{ "error": "cannot resolve globally, domain failed validation: <reason>" }
```
`scope: "DEVICE"` is not affected — per-device overrides never carry
`allowSubdomains` (see the data model), so the Public Suffix risk this
closes doesn't apply there.

**As of Phase 2** (critical semantic — see "Shared-request resolution"
below): `scope: "GLOBAL"` writes `browser_domains` and answers **every**
device that was still waiting on the request; `scope: "DEVICE"` writes
`browser_device_overrides` for **only** the named device. A request shared
by several devices is only marked fully resolved once every one of them has
been answered — resolving it for one device leaves it visibly `PENDING`
(with a reduced `requesterCount`) for the others, it is never silently
closed out from under them. `requestFullyResolved` in the response tells
the caller whether this particular call was the one that closed it. A 404
on `scope: "DEVICE"` means *this device* has no still-pending row on this
request (already answered, or never actually requested it) — not
necessarily that the whole request is gone.

```
GET  /api/browser/audit?domain=<host>&limit=<n>
```
*(Phase 2)* Recent policy-**change** audit trail (never browsing history —
see the data model). Both params optional; `limit` defaults to 100, capped
at 500. Each entry: `{ id, createdAt, actor, action, domain, scope,
deviceId, oldDecision, newDecision, reason, policyVersionAfter }`. `actor`
is the admin-panel session's username — Phase 2 has one shared admin login,
not per-admin accounts, so this identifies "the admin panel", not a
specific real person (documented limitation, not a gap in this endpoint).

## Shared-request resolution (Phase 2)

This is the model behind the two endpoints above, and the fix for a
correctness issue flagged before this phase started: if device A and
device B both request `example.com`, and an admin resolves it for device A
only (`scope: "DEVICE"`), device B's request must not vanish or read as
resolved. Concretely:
- Each requesting device gets its own row in `browser_request_devices`
  (`decision: null` while waiting).
- `scope: "GLOBAL"` sets every still-`null` row to the same decision (a
  global rule genuinely does answer everyone at once) and closes the
  parent request.
- `scope: "DEVICE"` sets only the named device's row, and only if it was
  still `null` (resolving the same device twice is a no-op on the second
  call, returning 404 — see "duplicate resolution" in the test suite). The
  parent request closes only once every row is non-`null`.
- A device already individually resolved is never overwritten by a later
  `GLOBAL` resolution on the same request (its earlier, specific answer is
  preserved) — only the devices still waiting are affected.

All of this happens inside a single database transaction per resolve call,
so a crash mid-way never leaves a request marked resolved without the
corresponding `browser_domains`/`browser_device_overrides` write — and
never the reverse — actually having committed.

## Domain rule validation (Phase 1.1)

Every domain written into `browser_domains` — via `POST /api/browser/domains`
directly, or via resolving a request with `scope: "GLOBAL"` — passes through
`browserPolicy.validateDomainRuleInput(domain, allowSubdomains)` first.
**This does not change the `ALLOW`/`BLOCK`/`REVIEW` vocabulary or any
response field** — it only decides whether an admin-submitted rule is
accepted at write time. Rejection reasons (the `<reason>` in the 400 body
above):

| Reason | Meaning |
|---|---|
| `empty` | No domain given |
| `contains_whitespace` | Domain string contains whitespace |
| `contains_scheme` | Domain includes `://` (a full URL was submitted, not a bare host) |
| `contains_path_or_query` | Domain includes `/`, `?`, or `#` |
| `contains_userinfo` | Domain includes `@` |
| `contains_wildcard` | Domain includes a manual `*` (wildcards are expressed via `allowSubdomains`, never a literal `*` label) |
| `contains_port_or_invalid_char` | Domain includes `:` (a port, or a stray colon) |
| `malformed` | Doesn't parse as a valid hostname at all |
| `ip_literal` | Domain is a bare IPv4/IPv6 literal |
| `public_suffix_only` | Domain **is** a public/private Public-Suffix-List boundary with nothing registrable beneath it (`github.io`, `co.uk`, `blogspot.com`, `appspot.com`, …) — rejected unconditionally, regardless of `allowSubdomains` |
| `allow_subdomains_requires_registrable_domain` | `allowSubdomains: true` was requested on a domain narrower than its own true registrable domain (e.g. `mail.example.com` instead of `example.com`) |
| `validation_error` | An unexpected internal failure during validation (e.g. the Public Suffix List library threw) — **fail-closed: treated as a rejection, never as a pass-through** |

Two guarantees this closes, concretely:
1. **No accidental shared-hosting wildcard.** `ALLOW github.io +
   allowSubdomains=true` can never be written — it would otherwise approve
   every GitHub Pages user's site, not the one the admin actually meant.
   The Public Suffix List (via the `tldts` library, `allowPrivateDomains:
   true` so GitHub Pages/Blogspot/App Engine-style *private* PSL entries are
   honored, not just ICANN TLDs) is the source of truth for where that
   boundary is — never a hand-rolled list, since the PSL changes over time.
2. **One canonical representation per real site.** Admin input is
   normalized through the same ASCII/Punycode host-parsing Node's `URL`
   already applies to real navigation hosts (see `parseNavigationUrl`)
   before it's validated or stored — a Unicode domain and its Punycode
   equivalent, mixed case, and a trailing dot all collapse to the exact
   same `browser_domains.domain` value, so the same real-world site can
   never end up as two different rows.

Subdomain **matching** (at `/browser/check` time, read-only, no PSL lookup
involved) is boundary-aware for the same reason: `sub.example.com` matches
a rule for `example.com` with `allowSubdomains: true` only via a genuine
label boundary (host ends with `.example.com`), never a bare substring —
`badexample.com` and `example.com.evil.com` never match a rule for
`example.com`. See `browserPolicy.domainCovers`, used as an independent
defense-in-depth re-check on every database read, not only relied on in SQL.

## Data model (Postgres)

- `browser_domains` — global policy: `domain` (PK), `decision`,
  `allow_subdomains`, `category`, `risk_score`, `confidence`, `source`,
  `approval_method`, `reason`, `last_checked_at`, `approved_at`,
  `decision_version`, timestamps.
- `browser_device_overrides` — `(device_id, domain)` PK, `decision`,
  `reason`, `created_at`.
- `browser_requests` — pending/resolved review queue, one PENDING row per
  domain at a time (`status`, `resolution_scope`, `resolution_decision` —
  the latter two are only meaningful for a `GLOBAL` resolution; a request
  closed via individual `DEVICE` resolutions leaves them `null` since each
  device may have gotten a different answer — see each device's own row
  instead).
- `browser_request_devices` — one row per requesting device per request.
  **Phase 2**: `decision` (`null` while that device is still waiting,
  `ALLOW`/`BLOCK` once answered) and `resolved_at` — see "Shared-request
  resolution" above.
- `browser_decision_log` — append-only audit trail of every `/browser/check`
  outcome (device browsing activity, not policy changes).
- `browser_policy_meta` — single row holding the global `policy_version`
  counter.
- `browser_policy_audit` — **Phase 2**. One row per admin **policy change**
  (never per navigation/browsing event — that stays in
  `browser_decision_log`): `actor`, `action`, `domain`, `scope`, `device_id`,
  `old_decision`, `new_decision`, `reason`, `policy_version_after`. Written
  in the same transaction as the change it documents.

Full column definitions and comments are in `backend/db.js` (SCHEMA
constant, "Filtered Browser: Browser Policy foundation" / "Admin workflow +
audit" sections).

## Known Phase 1 limitations (read before assuming more than this)

This phase is deliberately minimal — foundations only, no over-engineering
ahead of real traffic:

- **No automated analysis.** There is no Redis, no queue, no analyzer
  worker, and no AI classification yet. Every `ALLOW`/`BLOCK` in
  `browser_domains` today can only come from a direct admin action (either
  via `POST /api/browser/domains` or by resolving a request). An unknown
  domain is *always* `REVIEW` — never auto-approved.
- **No real emergency-revoke push channel.** `expiresAt` (fixed 24h TTL for
  decided domains) is the only mechanism that limits how long a
  since-revoked `ALLOW` could theoretically remain valid if the client ever
  builds a local cache. A true instant global revoke needs the existing
  FCM channel (`PushRegistration.kt` on the Android side) wired up — not
  built yet.
- **No policy blob signing.** The client is currently using local mocks
  (per `client-progress.md`) with no real cache to protect, so signing is
  deferred until the client is actually ready to persist and trust a local
  copy of policy state.
- **No redirect-chain, subresource, or iframe analysis on the server.**
  Each `/browser/check` call evaluates exactly the one hostname it's asked
  about, once. Per-hop redirect re-validation, subresource filtering, and
  iframe policy are entirely a client-side responsibility in this phase
  (see `client-api-requirements.md`).
- **No caching layer.** Every check is a direct Postgres query. At current
  scale this is intentional — adding Redis before there is real traffic to
  justify it would be premature.
- **Phase 2.3: the per-device rate limiter is in-process, in-memory state**
  (a plain `Map`, same pattern as the existing admin-login rate limiter) —
  it resets on every backend restart/deploy, and does not coordinate across
  multiple backend instances if this is ever scaled horizontally. Acceptable
  for the current single-instance deployment; a real multi-instance
  deployment would need a shared store (Redis, out of scope per this
  phase's instructions) for the limit to hold fleet-wide rather than
  per-instance.

None of the above blocks the Android client's Phase 0A (WebView security
PoC using local mocks). They matter starting whenever the client is ready
to talk to this endpoint for real.
