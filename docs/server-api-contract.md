# Filtered Browser — Server API Contract

Owner: Claude (Backend / Admin / Worker)
Status: Phase 1 + 1.1 (hardening) + 2 (admin workflow) + 2.3 (load/abuse/failure hardening) + 2.4 (signed offline policy snapshot, server-side foundation only) IMPLEMENTED — see Known Phase 1 Limitations (still current for anything not covered by Phase 2/2.3/2.4)
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

## Signed offline policy snapshot (Phase 2.4)

**Foundation only.** This section is the exact contract GPT's Android
client will need once it implements offline verification and caching —
neither is implemented here (explicitly out of scope for this phase, per
instruction). Nothing in this section changes `/browser/check`'s
`ALLOW`/`BLOCK`/`REVIEW` semantics or existing response fields; it is a
completely separate, additive endpoint. No new database table or column
was needed — the signing key lives in environment/secret configuration,
never in Postgres or in this repo.

### Why this exists

`/browser/check` requires a live network round-trip. A device that's
briefly offline (or whose network the filtering itself depends on is
down) needs a way to enforce the *last known-good* policy without trusting
whatever is sitting in local storage — a plain cached JSON blob could be
tampered with, rolled back to an old (since-revoked) `ALLOW`, or forged
outright. A cryptographic signature the device can verify **offline**,
using a public key it already trusts, closes that gap.

### Endpoint

```
GET /api/devices/:deviceId/browser/policy-snapshot
Authorization: Bearer <deviceToken>      (identical to /browser/check and /sync)
```

Same device authentication as every other device endpoint — `404` if the
device doesn't exist, `401` if the bearer token doesn't match. **No
authentication was weakened or bypassed to add this endpoint.**

### Response — 200, a signed envelope

```json
{
  "payload": {
    "policyVersion": 42,
    "generatedAt": "2026-09-03T12:00:00.000Z",
    "expiresAt": "2026-09-04T12:00:00.000Z",
    "globalDomains": [
      { "domain": "example.com", "decision": "ALLOW", "allowSubdomains": true },
      { "domain": "evil.example.com", "decision": "BLOCK", "allowSubdomains": false }
    ],
    "deviceOverrides": [
      { "domain": "special-case-for-this-device.com", "decision": "ALLOW" }
    ]
  },
  "keyId": "browser-policy-2026-09",
  "algorithm": "Ed25519",
  "signature": "<base64, 64 bytes decoded>"
}
```

**Two clearly separate rule sets, on purpose — see "Device overrides in
the snapshot" below.** This corrects an earlier version of this endpoint
that only included `globalDomains` — incomplete, since
`browser_device_overrides` can change the effective decision for the
specific device the snapshot was requested for (see `evaluateDomain`'s
real precedence: override checked *before* the global table). Both arrays
are always present (empty array, never omitted, when there's nothing to
report) and are part of the same signed payload — tampering with either
invalidates the signature exactly the same way.

### Response — 401/404, device auth failure

Identical semantics to `/browser/check`. No envelope is returned either way.

### Response — 5xx, internal error (fail-closed, no exceptions)

```json
{ "error": "internal error" }
```

**Every one of these returns 5xx with no envelope body — never a
"best-effort" or unsigned snapshot, never a cached fallback:**
- The signing key is missing from environment/secret configuration.
- The configured key is malformed, or is a real key of the wrong type
  (anything other than Ed25519).
- Signing itself fails for any reason.
- A `policyVersion` rollback is detected (see "Anti-rollback" below) —
  this can only happen from a genuine anomaly (e.g. a database read
  returning a value older than one this same process already issued), and
  the server refuses to issue a signature rather than silently proceeding.
- Any database failure while reading the current policy state.

This is enforced structurally, not by a try/catch that could accidentally
swallow the wrong thing: the route lets every one of the above propagate
as a thrown error to the same `wrap()`/global-error-handler pattern every
other endpoint in this API already uses (see "Fail-closed decision logic"
above) — there is no code path in the route handler that can construct an
envelope-shaped response without a real signature actually having
succeeded first.

### Device overrides in the snapshot

The snapshot reproduces the **full effective offline policy for the
specific device it was requested for** — not just the global rule set.
`browser_device_overrides` rows for `req.params.deviceId` (the device the
already-verified bearer token belongs to — never any other id) are
included in `payload.deviceOverrides`, kept in a **separate array from**
`payload.globalDomains`, never merged/flattened into one pre-resolved
list. A verifier must apply the same precedence `evaluateDomain` already
uses at request time:

1. Check `deviceOverrides` for an **exact** match on the host (device
   overrides are exact-domain-only — `browser_device_overrides` has no
   `allowSubdomains` column, so a `deviceOverrides` entry never carries
   that field; a verifier must never invent subdomain matching for one).
   If found, that decision wins — full stop.
2. Otherwise check `globalDomains`: exact match, or an ancestor domain
   whose `allowSubdomains` is `true`.
3. Otherwise: unknown → treat exactly like `REVIEW`/fail-closed (stays
   blocked; there is no offline path to "ask an admin" the way
   `/browser/check`'s request queue provides online).

**Isolation**: one device can never receive another device's overrides —
enforced by construction, not by a filter that could be gotten wrong
later: the query backing `deviceOverrides` (`db.
getBrowserDeviceOverridesForSnapshot`) is called with only the
`requireDevice`-authenticated `req.params.deviceId`, never a value from
the request body/query/anywhere else a client could influence. Verified
for real (`test-policy-signing-integration.js`): two real devices, each
with its own override, each only ever seeing its own.

### The exact Android verification contract

This is the precise information a client-side verifier needs — written so
it can be implemented later without re-deriving anything from this
server's source:

- **Algorithm**: Ed25519 (RFC 8032). Not HMAC, not RSA, not ECDSA. No
  shared secret exists on any device — verification uses only a public
  key.
- **Public-key encoding**: available in two forms from
  `GET /api/browser/policy/signing-key` (admin-authenticated today — see
  below):
  - `publicKeyPem` — standard SPKI PEM (`-----BEGIN PUBLIC KEY-----`),
    parseable by any standard crypto library (`java.security.KeyFactory`
    with `X509EncodedKeySpec`, OpenSSL, Node's `crypto`, etc.).
  - `publicKeyBase64` — the raw 32-byte Ed25519 public key, standard
    (not URL-safe) base64 — for a library that wants the raw key material
    directly rather than parsing an SPKI/DER wrapper (e.g. Tink,
    BouncyCastle's `Ed25519PublicKeyParameters`).
- **keyId**: an opaque string (`envelope.keyId`) identifying which key
  signed this envelope. A future key rotation adds a new keyId/key pair;
  a client should look up the public key by `keyId` and **fail closed
  (reject the snapshot) if it doesn't recognize the keyId** — never fall
  back to "try whatever key I have."
- **Canonical payload format**: the signature covers the UTF-8 bytes of a
  deterministic ("canonical") JSON serialization of `envelope.payload`
  only (never `keyId`/`algorithm`/`signature` themselves — those are
  envelope metadata used only to select which public key to verify with;
  tampering with either can only ever make verification fail, never make
  a forged payload verify successfully, since Ed25519 verification is
  tied to the exact (message, signature, public key) triple). Canonical
  form: object keys sorted recursively (lexicographic, by UTF-16 code
  unit — i.e. plain JavaScript/most languages' default string sort), no
  whitespace, no trailing commas, `globalDomains` and `deviceOverrides`
  each always already sorted by `domain` ascending by the server before
  signing (never re-sorted or otherwise reordered by a verifier, and never
  merged into one list — see "Device overrides in the snapshot" above for
  why they must stay separate). A verifying client must reproduce
  **exactly** this serialization before checking the signature — schemas
  such as protobuf/CBOR were deliberately not used so both sides can
  implement this from a plain description without a shared codegen step;
  the reference implementation is `backend/policySigning.js`'s
  `canonicalize()`, and `backend/test-policy-signing.js` is a runnable
  spec of its exact behavior (byte-for-byte, run it against reference
  values if ever reimplementing this independently).
- **Signature encoding**: standard base64 (not URL-safe) of the raw
  64-byte Ed25519 signature (`crypto.sign(null, canonicalBytes, privateKey)`
  in Node terms — Ed25519 has no separate hash-algorithm parameter, unlike
  RSA/ECDSA).
- **policyVersion handling**: monotonically increasing, sourced directly
  from `browser_policy_meta.policy_version` (the same counter
  `/browser/check` responses already expose) — never a separate counter
  that could drift from it. **The client must reject (never apply) any
  signed snapshot whose `policyVersion` is strictly lower than the
  highest one it has already durably accepted — and must accept one that
  is equal**, provided the signature/keyId/expiry/format are otherwise
  valid. This distinction matters: the server signs a brand-new envelope
  on every single request (see "Endpoint" above — no caching), so a
  device that re-fetches its snapshot without any policy change in
  between will legitimately receive the *same* `policyVersion` with a
  *renewed* `generatedAt`/`expiresAt` every time. Rejecting an equal
  version would make ordinary periodic renewal impossible without an
  actual policy mutation, which is never the intent — only a version
  strictly *behind* what was already accepted indicates a rollback/replay
  attempt. This is the actual anti-rollback enforcement point; the
  server-side guard (see below) only protects against a narrower,
  server-local anomaly, not against an attacker replaying an old,
  validly-signed-at-the-time snapshot to a device later. Persist the
  accepted `policyVersion` in the same trusted local store the cached
  policy itself lives in once that's implemented (a future phase); a
  store an attacker could reset without also being able to reset the
  device's own tamper-evident state would defeat this.
- **Expiry handling**: `expiresAt` is `generatedAt` + 24h
  (`policySigning.SNAPSHOT_TTL_MS`). **A client must treat an expired
  snapshot as invalid for enforcement** (fail closed — same posture as any
  other untrusted/stale state), even if its signature verifies correctly;
  signature validity proves authenticity and integrity, not freshness.
  Re-fetch a new snapshot before/upon expiry whenever network is available.
- **Failure behavior a client must implement**: signature doesn't verify →
  reject. Unrecognized `keyId` → reject. `policyVersion` **strictly lower**
  than already-accepted → reject (even if it verifies — see anti-rollback).
  An **equal** `policyVersion` must be **accepted** if the signature/keyId/
  expiry/format are otherwise valid — a fresh snapshot legitimately renews
  `generatedAt`/`expiresAt` without any policy content changing, and a
  client that rejected same-version renewals would make normal periodic
  re-fetching indistinguishable from an attack. Expired → reject for
  enforcement purposes (may still be shown as "last known state" in a UI,
  clearly marked stale, at the client's discretion — never silently
  treated as current). Any parse/format error → reject.
  **A rejected snapshot must never be treated as "no policy" (open) — it
  must fail exactly like `/browser/check` failing: the affected
  navigation stays blocked**, consistent with the fail-closed contract
  this whole API already commits to.

### Anti-rollback (server-side scope, precisely stated)

`policyVersion` itself is the same durable, Postgres-persisted,
already-proven-monotonic-across-restarts counter every other browser
policy endpoint uses (see Phase 2.3's restart/persistence verification) —
a freshly-generated snapshot is built by reading it live, so it can never
itself be "behind" the true current value at the moment of signing.

On top of that, this phase adds one extra, narrower safety net:
`policySigning.js` keeps a per-process, in-memory high-water mark of every
`policyVersion` it has ever signed, and refuses (throws → 500) to sign a
lower one. **This catches an anomaly within one running process's
lifetime** (e.g. a lagging database replica read) — **it does not, and
cannot, protect against an attacker later replaying an old, validly-signed
snapshot to a device** (a signature made for `policyVersion: 5` while `5`
was current stays a valid signature for `policyVersion: 5` forever; the
server has no way to "unsign" it). That protection is entirely the
client's responsibility, per "policyVersion handling" above — this
document states that plainly rather than implying the server alone
handles rollback safety.

### Key handling

- The private key is loaded once per process from
  `BROWSER_POLICY_SIGNING_PRIVATE_KEY` (PEM, PKCS8) — either real newlines
  or a single-line value with literal `\n` escapes (the common shape once
  a multi-line PEM passes through a platform limited to single-line env
  vars), or base64-encoded PEM. `BROWSER_POLICY_SIGNING_KEY_ID` is
  required alongside it. **Never committed to this repository, never
  logged** (verified: no log statement anywhere references the raw env
  var or the parsed key object).
- `GET /api/browser/policy/signing-key` (admin-authenticated, not a public
  endpoint yet) exposes `{ keyId, algorithm, publicKeyPem,
  publicKeyBase64 }` — **only** the public key and identifying metadata,
  never private material. Making this endpoint unauthenticated/public so
  Android can fetch it directly is an explicit later decision, not made
  here (see Known Phase 1 limitations below).
- Key rotation: introduce a new `BROWSER_POLICY_SIGNING_PRIVATE_KEY`/
  `_KEY_ID` pair, and a client-side trust store that can hold more than one
  known `keyId` → public key at once during the rollover window. Nothing
  in this design assumes exactly one key ever exists.

## Data model (Postgres)

- `browser_domains` — global policy: `domain` (PK), `decision`,
  `allow_subdomains`, `category`, `risk_score`, `confidence`, `source`,
  `approval_method`, `reason`, `last_checked_at`, `approved_at`,
  `decision_version`, timestamps.
- `browser_device_overrides` — `(device_id, domain)` PK, `decision`,
  `reason`, `created_at`. No `allowSubdomains` column — a device override
  is always an exact-domain match. **Phase 2.4**: also consumed (domain +
  decision only, never `reason`) by the signed offline snapshot's
  `deviceOverrides` array, scoped to the requesting device only.
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
- **Phase 2.4: server-side foundation only — no Android verification, no
  local client caching.** Both are explicitly out of scope for this phase
  per instruction; see "The exact Android verification contract" above for
  what a future implementation needs. The public-key endpoint
  (`GET /api/browser/policy/signing-key`) is admin-authenticated, not yet a
  public/device-facing endpoint — making it so is a deliberate later
  decision, not an oversight. The server-side monotonicity guard is
  process-local only (see "Anti-rollback" above for its precise, narrower
  scope) — real anti-replay protection is entirely the client's
  responsibility once it exists. Not verified in production: this was
  developed and tested only against a real local PostgreSQL and a real
  locally-run backend process with ephemeral test keys; no real deployed
  signing key, no real Android verifier, and no production Render
  deployment of this endpoint have been exercised.
- **Phase 2.4 correction, same update as above**: an earlier version of
  this endpoint only signed `globalDomains`, which was incomplete (device
  overrides could silently change the effective offline decision for a
  device without the snapshot ever reflecting it) — corrected to include
  `deviceOverrides`, kept in its own array, never merged with
  `globalDomains`. Also corrected: this document previously said a client
  must reject a `policyVersion` "at or below" its highest accepted one,
  which was wrong — equal must be **accepted** (a renewed snapshot with no
  policy change legitimately repeats the same `policyVersion`); only a
  **strictly lower** version indicates rollback/replay. See "policyVersion
  handling" and "Failure behavior" above, both corrected.

None of the above blocks the Android client's Phase 0A (WebView security
PoC using local mocks). They matter starting whenever the client is ready
to talk to this endpoint for real.
