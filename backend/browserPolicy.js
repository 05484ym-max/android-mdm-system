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
  if (globalRule && globalRule.decision !== DECISIONS.REVIEW) {
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
};
