# Filtered Browser — Server API Contract

Owner: Claude (Backend / Admin / Worker)
Status: Phase 1 IMPLEMENTED (foundations only — see Known Phase 1 Limitations)
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
GET  /api/browser/domains
```
Returns every row in `browser_domains` (global policy), most recently
updated first.

```
POST /api/browser/domains
{ "domain": "example.com", "decision": "ALLOW", "allowSubdomains": false,
  "category": "news", "riskScore": 0.1, "confidence": 0.9, "reason": "..." }
```
Directly sets (or updates) the global decision for a domain — bypasses the
request queue entirely (e.g. for pre-seeding a known-good/known-bad list).
Bumps that domain's `decisionVersion` and the global `policyVersion`.

```
GET  /api/browser/requests
```
Returns every `PENDING` request, each with a `requesterCount` (distinct
devices that asked about that domain).

```
POST /api/browser/requests/:id/resolve
{ "scope": "GLOBAL", "decision": "ALLOW", "reason": "..." }
{ "scope": "DEVICE", "decision": "BLOCK", "deviceId": "...", "reason": "..." }
```
Resolves a pending request either globally (writes `browser_domains`) or
for one device (writes a `browser_device_overrides` row) — done in a single
transaction, so a crash mid-way never leaves a request marked resolved
without the decision actually having been applied. Returns 404 if the
request was already resolved or doesn't exist.

## Data model (Postgres)

- `browser_domains` — global policy: `domain` (PK), `decision`,
  `allow_subdomains`, `category`, `risk_score`, `confidence`, `source`,
  `approval_method`, `reason`, `last_checked_at`, `approved_at`,
  `decision_version`, timestamps.
- `browser_device_overrides` — `(device_id, domain)` PK, `decision`,
  `reason`, `created_at`.
- `browser_requests` — pending/resolved review queue, one PENDING row per
  domain at a time.
- `browser_request_devices` — distinct requesting devices per request.
- `browser_decision_log` — append-only audit trail of every `/browser/check`
  outcome.
- `browser_policy_meta` — single row holding the global `policy_version`
  counter.

Full column definitions and comments are in `backend/db.js` (SCHEMA
constant, "Filtered Browser: Browser Policy foundation" section).

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

None of the above blocks the Android client's Phase 0A (WebView security
PoC using local mocks). They matter starting whenever the client is ready
to talk to this endpoint for real.
