// Filtered Browser Policy Engine - Phase 1 foundation.
//
// Decision values are frozen by the cross-team contract (see
// /docs/server-api-contract.md): ALLOW, BLOCK, REVIEW. Never invent a
// fourth value here - the Android client's fail-closed logic only knows
// these three.
//
// Fail-closed is enforced at two levels:
//   1. A domain with no explicit admin decision evaluates to REVIEW (see
//      evaluateDomain) - there is no "unset = allowed" path anywhere.
//   2. Any thrown error while evaluating is left to propagate (index.js's
//      wrap() turns it into a 500) rather than being caught here and turned
//      into a manufactured decision - the contract requires the client to
//      treat any non-2xx/timeout as blocked, so this module never invents
//      an ALLOW/REVIEW object to paper over a failure.
//
// The functions below are split deliberately: parseNavigationUrl,
// isForbiddenScheme, isIpLiteralHost, normalizeHost, isValidDomainLabel and
// buildDecisionResponse are pure and have no DB dependency, so they're
// covered by real, run-every-time unit tests in test-browser-policy.js.
// evaluateDomain is the only function that talks to the database (via the
// `db` module passed in), kept intentionally thin.

const crypto = require('crypto');
const tldts = require('tldts');

const DECISIONS = Object.freeze({ ALLOW: 'ALLOW', BLOCK: 'BLOCK', REVIEW: 'REVIEW' });

// A decision is cached client-side, so even ALLOW/BLOCK must expire and
// force a re-check - this is the Phase 1 stand-in for the real push-based
// emergency-revoke channel (see server-api-contract.md's "Known Phase 1
// limitations"). REVIEW is never cacheable at all (expiresAt = now).
const DECIDED_TTL_MS = 24 * 60 * 60 * 1000;

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// Only letters, digits, hyphen and dot - matches real DNS hostname syntax.
// Rejecting anything else at the boundary (both for incoming navigation
// hosts and for admin-submitted domains) also closes a subtle SQL edge
// case: getBrowserDomainForHost's subdomain match uses `$1 LIKE '%.' ||
// domain`, and a domain containing '%' or '_' would otherwise change what
// that LIKE pattern matches.
const VALID_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.+$/, '');
}

function isValidDomainLabel(host) {
  return VALID_HOST_RE.test(host);
}

function isIpLiteralHost(host) {
  // IPv4 dotted-quad, or a bracketed/bare IPv6 literal. A bare IP host
  // can't be evaluated against a domain whitelist in any meaningful way,
  // and is a common evasion technique - Phase 1 treats it as BLOCK, not
  // REVIEW (see evaluateDomain).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith('[') || host.includes(':')) return true;
  return false;
}

/**
 * Parses a navigation target. Returns { scheme, host } whenever the string
 * parses as a URL at all, or null if it doesn't parse as one (caller
 * treats null as a 400 - a client-side bug, not a policy decision).
 *
 * `host` may be '' - several dangerous schemes (file:, data:, javascript:,
 * blob:) have no authority component at all in the WHATWG URL parser, so
 * they parse successfully with an empty hostname (verified directly:
 * `new URL('javascript:alert(1)').hostname === ''`, while
 * `new URL('intent://scan/...').hostname === 'scan'` - the two behave
 * differently and both must be handled). The caller MUST check
 * isForbiddenScheme() first, before ever looking at `host` - a forbidden
 * scheme is an explicit BLOCK regardless of whether a host happened to be
 * present, never a 400 and never left to fall through to a host check.
 */
function parseNavigationUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return null;
  }
  return { scheme: parsed.protocol, host: normalizeHost(parsed.hostname) };
}

function isForbiddenScheme(scheme) {
  return !ALLOWED_SCHEMES.has(scheme);
}

// ---------- Phase 1.1: admin rule validation (Public Suffix hardening) ----------
//
// Everything below runs at RULE-WRITE time only (POST /api/browser/domains,
// and resolving a request as GLOBAL) - never on the /browser/check hot path.
// A malicious/malformed rule is far cheaper to reject once at write time
// than to re-derive safety on every navigation check.
//
// The core risk this closes: without Public Suffix awareness, an admin
// could write ALLOW github.io + allowSubdomains=true, intending to approve
// one GitHub Pages site, and instead approve every *.github.io site ever
// hosted by any GitHub user - because github.io is a shared-hosting
// boundary (a "private" entry in the Public Suffix List), not a single
// business's domain the way example.com is. Same principle for
// blogspot.com, appspot.com, and ICANN-section multi-label suffixes like
// co.uk. tldts (with allowPrivateDomains: true, so the PSL's private
// section - GitHub Pages, Blogspot, Google App Engine, etc. - is honored,
// not just ICANN TLDs) is the source of truth for this, not a hand-rolled
// list: the PSL changes over time and re-deriving it here would drift.

// Characters that must never appear in a bare admin-submitted domain field -
// checked BEFORE any URL-wrapping/canonicalization, with a specific reason
// each, so a scheme/path/query/port/userinfo/wildcard is rejected outright
// (with a message that actually says why) instead of being silently
// mangled by wrapping it in a synthetic https:// URL.
const REJECTED_RAW_DOMAIN_PATTERNS = [
  [/\s/, 'contains_whitespace'],
  [/:\/\//, 'contains_scheme'],
  [/[/?#]/, 'contains_path_or_query'],
  [/@/, 'contains_userinfo'],
  [/\*/, 'contains_wildcard'],
  [/:/, 'contains_port_or_invalid_char'],
];

/**
 * Canonicalizes an already-raw-validated bare hostname string to the same
 * ASCII/Punycode representation used everywhere else (see
 * parseNavigationUrl, which gets this for free from the URL parser on real
 * navigation hosts). Wrapping in a throwaway https:// URL reuses Node's own
 * WHATWG host-parsing/IDNA implementation rather than a second, hand-rolled
 * IDN normalizer that could disagree with it - one normalization pipeline
 * for both incoming navigation hosts and admin-submitted rules is what
 * guarantees the same real-world site never ends up as two different
 * database rows (Unicode vs. Punycode, mixed case, trailing dot, ...).
 * Returns null if the string still isn't a plausible hostname.
 */
function canonicalizeAdminDomainInput(raw) {
  try {
    return normalizeHost(new URL(`https://${raw}/`).hostname);
  } catch {
    return null;
  }
}

/**
 * Full validation for a domain being written into browser_domains, either
 * directly (POST /api/browser/domains) or via resolving a request as
 * GLOBAL. Returns { ok: true, host } or { ok: false, reason }.
 *
 * Fail-closed: any unexpected exception from tldts (or anything else in
 * here) is caught and treated as a rejection, never as a pass-through -
 * a rule this code cannot confidently classify must never be written,
 * because a write that slips through unclassified could become a
 * silent ALLOW later.
 */
function validateDomainRuleInput(rawDomain, allowSubdomains) {
  try {
    if (typeof rawDomain !== 'string' || !rawDomain.trim()) {
      return { ok: false, reason: 'empty' };
    }
    const trimmed = rawDomain.trim();
    for (const [pattern, reason] of REJECTED_RAW_DOMAIN_PATTERNS) {
      if (pattern.test(trimmed)) return { ok: false, reason };
    }

    const host = canonicalizeAdminDomainInput(trimmed);
    if (!host) return { ok: false, reason: 'malformed' };
    if (isIpLiteralHost(host)) return { ok: false, reason: 'ip_literal' };
    if (!isValidDomainLabel(host)) return { ok: false, reason: 'malformed' };

    const parsed = tldts.parse(host, { allowPrivateDomains: true });
    if (parsed.isIp) return { ok: false, reason: 'ip_literal' };
    // domain === null means the input IS a public/private suffix boundary
    // with nothing registrable beneath it (github.io, co.uk, blogspot.com,
    // appspot.com, or an unrecognized bare TLD) - there is no safe way to
    // scope a rule to "everyone on this shared host", so it's rejected
    // unconditionally, regardless of allowSubdomains.
    if (!parsed.domain) return { ok: false, reason: 'public_suffix_only' };

    if (allowSubdomains && parsed.domain !== host) {
      // Stricter check for the wildcard-granting case: allowSubdomains is
      // only safe at the true registrable-domain boundary (example.com),
      // never on an already-narrower subdomain (mail.example.com) - a
      // wildcard grant below the registrable domain doesn't correspond to
      // "this business's whole domain" the way it does at the boundary,
      // and only adds ambiguity.
      return { ok: false, reason: 'allow_subdomains_requires_registrable_domain' };
    }

    return { ok: true, host };
  } catch {
    return { ok: false, reason: 'validation_error' };
  }
}

/**
 * Boundary-aware coverage check: does `ruleDomain` (as configured, with
 * `allowSubdomains`) cover `host`? Exact match always covers; a subdomain
 * only covers when allowSubdomains is set, and only via a real label
 * boundary (a leading '.' before ruleDomain) - never a bare substring/
 * suffix match, which is what would wrongly let "badexample.com" or
 * "example.com.evil.com" match a rule for "example.com".
 *
 * This mirrors getBrowserDomainForHost's SQL predicate exactly (see
 * db.js) and is used as a defense-in-depth re-check in evaluateDomain:
 * a row fetched from the database is never trusted for an ALLOW/BLOCK
 * decision without this pure function independently confirming it
 * actually covers the host being evaluated.
 */
function domainCovers(host, ruleDomain, allowSubdomains) {
  if (host === ruleDomain) return true;
  if (!allowSubdomains) return false;
  return host.endsWith(`.${ruleDomain}`);
}

/**
 * Shapes the response object the Android client is contractually
 * guaranteed (see /docs/server-api-contract.md). `expiresAt` is an ISO
 * timestamp; REVIEW always expires immediately (never cached), ALLOW/BLOCK
 * get the Phase 1 fixed TTL.
 */
function buildDecisionResponse({
  decision, domain, decisionVersion, policyVersion, allowSubdomains, reason, confidence, riskScore,
}) {
  const now = Date.now();
  const expiresAt = new Date(decision === DECISIONS.REVIEW ? now : now + DECIDED_TTL_MS).toISOString();
  return {
    decision,
    domain,
    decisionVersion: decisionVersion ?? 0,
    policyVersion,
    expiresAt,
    allowSubdomains: Boolean(allowSubdomains),
    reason,
    ...(confidence != null ? { confidence } : {}),
    ...(riskScore != null ? { riskScore } : {}),
  };
}

/**
 * Full Phase 1 evaluation for one (host, deviceId) pair. Order of checks:
 *   1. Per-device override (can both loosen and tighten vs. the global
 *      decision - see db.js's comment on browser_device_overrides).
 *   2. Global browser_domains (exact match, or an ancestor domain that
 *      opted into allow_subdomains).
 *   3. Unknown -> REVIEW, and a request is recorded (deduped per domain -
 *      see db.recordBrowserRequest) so an admin/analyzer can act on it.
 * Never returns ALLOW unless step 1 or 2 found an explicit ALLOW row.
 */
async function evaluateDomain({ db, host, url, deviceId }) {
  const policyVersion = await db.getBrowserPolicyVersion();

  const override = await db.getBrowserDeviceOverride(deviceId, host);
  if (override) {
    return buildDecisionResponse({
      decision: override.decision,
      domain: host,
      decisionVersion: 1,
      policyVersion,
      allowSubdomains: false,
      reason: override.reason || 'device_override',
    });
  }

  const globalRule = await db.getBrowserDomainForHost(host);
  // Defense-in-depth: never trust the database row alone for an ALLOW/BLOCK
  // decision. domainCovers() independently re-derives whether this rule
  // actually covers `host` under the same boundary-aware rules the SQL
  // query is supposed to enforce - if a future SQL change ever regressed
  // that boundary-safety, this catches it here rather than silently
  // granting a wrong decision. A rule that fails this re-check is treated
  // exactly like "no rule at all" (falls through to REVIEW below).
  if (globalRule && globalRule.decision !== DECISIONS.REVIEW &&
      domainCovers(host, globalRule.domain, globalRule.allowSubdomains)) {
    return buildDecisionResponse({
      decision: globalRule.decision,
      domain: globalRule.domain,
      decisionVersion: globalRule.decisionVersion,
      policyVersion,
      allowSubdomains: globalRule.allowSubdomains,
      reason: globalRule.reason || 'global_policy',
      confidence: globalRule.confidence,
      riskScore: globalRule.riskScore,
    });
  }

  const requestId = await db.recordBrowserRequest(crypto.randomUUID(), { domain: host, url, deviceId });
  return buildDecisionResponse({
    decision: DECISIONS.REVIEW,
    domain: host,
    decisionVersion: globalRule ? globalRule.decisionVersion : 0,
    policyVersion,
    allowSubdomains: false,
    reason: requestId ? 'no_policy_decision_yet' : 'no_policy_decision_yet_request_race',
  });
}

// ---------- Phase 2: shared-request resolution semantics (spec mirror) ----------
//
// A domain requested by several devices must not have one device's
// DEVICE-scope resolution silently close the request out for the others
// still waiting - that was flagged as a critical correctness requirement.
// The real enforcement happens atomically in SQL (see db.js's
// resolveBrowserRequest: `UPDATE ... WHERE decision IS NULL`, and the
// parent only flips to RESOLVED once every sibling row is non-null) -
// this function is NOT itself called from the request path (a live
// database transaction is what actually has to be race-safe under
// concurrent resolutions, not a plain JS array transform). It exists so
// the *intended* semantics can be proven correct with a real, running
// test instead of only a hand-reviewed SQL statement - see
// test-browser-policy.js's "shared request" test block, which mirrors
// this function's behavior against db.js's SQL line by line.

/**
 * Pure simulation of one resolution action against a request's current
 * per-device state. `devices` is [{ deviceId, decision }], decision null
 * meaning "still waiting". Returns { devices: <new state>, fullyResolved }.
 *
 * GLOBAL sets `decision` on every still-waiting (null) row - a global rule
 * genuinely does answer everyone who was waiting at once.
 * DEVICE sets `decision` only on the named device's row, and only if it
 * was still null (already-resolved devices are left untouched - resolving
 * the same device twice must never silently overwrite the earlier answer).
 */
function applyRequestResolution(devices, action) {
  const next = action.scope === 'GLOBAL'
    ? devices.map(d => (d.decision === null ? { ...d, decision: action.decision } : d))
    : devices.map(d => (
      d.deviceId === action.deviceId && d.decision === null
        ? { ...d, decision: action.decision }
        : d
    ));
  return { devices: next, fullyResolved: next.every(d => d.decision !== null) };
}

module.exports = {
  DECISIONS,
  DECIDED_TTL_MS,
  normalizeHost,
  isValidDomainLabel,
  isIpLiteralHost,
  parseNavigationUrl,
  isForbiddenScheme,
  buildDecisionResponse,
  evaluateDomain,
  validateDomainRuleInput,
  domainCovers,
  applyRequestResolution,
};
