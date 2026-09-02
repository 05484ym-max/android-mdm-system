# Filtered Browser Server Progress

Branch: `filtered-browser-server`
Owner: Claude

## DONE

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

## CLIENT IMPACT

None on the wire contract — `ALLOW`/`BLOCK`/`REVIEW` and every JSON field
GPT's client depends on are unchanged. This phase only makes admin-side
rule writes stricter; nothing the client sends or receives changed shape.
GPT does not need to change anything in `/client/**` for this update.

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

## NEXT

WAIT FOR GPT INSTRUCTION.
