// Ad hoc test script for browserPolicy.js's pure (DB-free) functions - same
// style as test-db.js, run directly with `node test-browser-policy.js`.
// evaluateDomain() itself is NOT covered here: it needs a real Postgres
// connection (see db.js), which this sandbox does not have. Everything
// exercised here has zero DB dependency and runs for real, every time.
const assert = require('assert');
const bp = require('./browserPolicy');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

check('normalizeHost lowercases and strips a trailing dot', () => {
  assert.strictEqual(bp.normalizeHost('Example.COM.'), 'example.com');
});

check('normalizeHost tolerates null/undefined', () => {
  assert.strictEqual(bp.normalizeHost(undefined), '');
});

check('isValidDomainLabel accepts a normal hostname', () => {
  assert.strictEqual(bp.isValidDomainLabel('sub.example.com'), true);
});

check('isValidDomainLabel rejects a bare label with no dot', () => {
  assert.strictEqual(bp.isValidDomainLabel('localhost'), false);
});

check('isValidDomainLabel rejects SQL-LIKE-wildcard characters', () => {
  assert.strictEqual(bp.isValidDomainLabel('ev%l.example.com'), false);
  assert.strictEqual(bp.isValidDomainLabel('ev_l.example.com'), false);
});

check('isValidDomainLabel rejects a leading/trailing hyphen label', () => {
  assert.strictEqual(bp.isValidDomainLabel('-example.com'), false);
  assert.strictEqual(bp.isValidDomainLabel('example-.com'), false);
});

check('isIpLiteralHost recognizes an IPv4 literal', () => {
  assert.strictEqual(bp.isIpLiteralHost('192.168.1.1'), true);
});

check('isIpLiteralHost recognizes an IPv6 literal', () => {
  assert.strictEqual(bp.isIpLiteralHost('::1'), true);
});

check('isIpLiteralHost does not flag a normal hostname', () => {
  assert.strictEqual(bp.isIpLiteralHost('example.com'), false);
});

check('parseNavigationUrl extracts scheme and normalized host', () => {
  const parsed = bp.parseNavigationUrl('HTTPS://Example.com:443/path?q=1');
  assert.deepStrictEqual(parsed, { scheme: 'https:', host: 'example.com' });
});

check('parseNavigationUrl returns null for an unparseable URL', () => {
  assert.strictEqual(bp.parseNavigationUrl('not a url'), null);
});

check('parseNavigationUrl returns an empty host for schemes with no authority (never null)', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'blob:https://x/y']) {
    const parsed = bp.parseNavigationUrl(url);
    assert.notStrictEqual(parsed, null, `${url} should still parse`);
    assert.strictEqual(parsed.host, '', `${url} should have an empty host`);
    assert.strictEqual(bp.isForbiddenScheme(parsed.scheme), true, `${url} scheme must be forbidden`);
  }
});

check('parseNavigationUrl gives intent:// a real host (still a forbidden scheme)', () => {
  const parsed = bp.parseNavigationUrl('intent://scan/#Intent;package=com.evil;end');
  assert.strictEqual(parsed.host, 'scan');
  assert.strictEqual(bp.isForbiddenScheme(parsed.scheme), true);
});

check('isForbiddenScheme allows only http/https', () => {
  assert.strictEqual(bp.isForbiddenScheme('https:'), false);
  assert.strictEqual(bp.isForbiddenScheme('http:'), false);
  assert.strictEqual(bp.isForbiddenScheme('intent:'), true);
  assert.strictEqual(bp.isForbiddenScheme('data:'), true);
});

check('buildDecisionResponse never expires an ALLOW/BLOCK immediately', () => {
  const res = bp.buildDecisionResponse({
    decision: bp.DECISIONS.ALLOW, domain: 'example.com', decisionVersion: 3,
    policyVersion: 7, allowSubdomains: false, reason: 'global_policy',
  });
  const ttl = new Date(res.expiresAt).getTime() - Date.now();
  assert.ok(ttl > 23 * 60 * 60 * 1000, `expected ~24h TTL, got ${ttl}ms`);
});

check('buildDecisionResponse never caches a REVIEW decision', () => {
  const res = bp.buildDecisionResponse({
    decision: bp.DECISIONS.REVIEW, domain: 'example.com', decisionVersion: 0,
    policyVersion: 7, allowSubdomains: false, reason: 'no_policy_decision_yet',
  });
  const ttl = new Date(res.expiresAt).getTime() - Date.now();
  assert.ok(ttl <= 0, `expected REVIEW to expire immediately, got ${ttl}ms`);
});

check('buildDecisionResponse omits confidence/riskScore when not given', () => {
  const res = bp.buildDecisionResponse({
    decision: bp.DECISIONS.BLOCK, domain: 'example.com', decisionVersion: 1,
    policyVersion: 1, allowSubdomains: false, reason: 'threat_hit',
  });
  assert.ok(!('confidence' in res));
  assert.ok(!('riskScore' in res));
});

// ---------- Phase 1.1: boundary-aware subdomain matching (domainCovers) ----------

check('domainCovers: PASS - exact match', () => {
  assert.strictEqual(bp.domainCovers('example.com', 'example.com', false), true);
});

check('domainCovers: PASS - subdomain covered when allowSubdomains=true', () => {
  assert.strictEqual(bp.domainCovers('sub.example.com', 'example.com', true), true);
});

check('domainCovers: BLOCK - subdomain NOT covered when allowSubdomains=false', () => {
  assert.strictEqual(bp.domainCovers('sub.example.com', 'example.com', false), false);
});

check('domainCovers: NO MATCH - sibling-looking domain is not a substring match', () => {
  assert.strictEqual(bp.domainCovers('badexample.com', 'example.com', true), false);
});

check('domainCovers: NO MATCH - a domain that merely ends with the rule string', () => {
  // example.com.evil.com genuinely IS a different, attacker-controlled
  // registrable domain (evil.com) - it must never match a rule for
  // example.com just because the string "example.com" appears as a prefix.
  assert.strictEqual(bp.domainCovers('example.com.evil.com', 'example.com', true), false);
});

check('domainCovers: deep subdomain still covered under allowSubdomains=true', () => {
  assert.strictEqual(bp.domainCovers('a.b.example.com', 'example.com', true), true);
});

// ---------- Phase 1.1: admin rule write validation (validateDomainRuleInput) ----------

check('validateDomainRuleInput: PASS - plain registrable domain', () => {
  const r = bp.validateDomainRuleInput('example.com', false);
  assert.deepStrictEqual(r, { ok: true, host: 'example.com' });
});

check('validateDomainRuleInput: PASS - allowSubdomains at the true registrable boundary', () => {
  const r = bp.validateDomainRuleInput('example.com', true);
  assert.strictEqual(r.ok, true);
});

check('validateDomainRuleInput: PASS - a specific narrow subdomain without allowSubdomains', () => {
  const r = bp.validateDomainRuleInput('sub.example.com', false);
  assert.strictEqual(r.ok, true);
});

check('validateDomainRuleInput: REJECT - allowSubdomains on a narrower-than-registrable domain', () => {
  const r = bp.validateDomainRuleInput('mail.example.com', true);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'allow_subdomains_requires_registrable_domain');
});

check('validateDomainRuleInput: REJECT - full URL with scheme', () => {
  const r = bp.validateDomainRuleInput('https://example.com', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'contains_scheme');
});

check('validateDomainRuleInput: REJECT - domain with a path', () => {
  const r = bp.validateDomainRuleInput('example.com/path', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'contains_path_or_query');
});

check('validateDomainRuleInput: REJECT - domain with an explicit port', () => {
  const r = bp.validateDomainRuleInput('example.com:443', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'contains_port_or_invalid_char');
});

check('validateDomainRuleInput: REJECT - manual wildcard label', () => {
  const r = bp.validateDomainRuleInput('*.example.com', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'contains_wildcard');
});

check('validateDomainRuleInput: REJECT - userinfo prefix', () => {
  const r = bp.validateDomainRuleInput('user@example.com', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'contains_userinfo');
});

check('validateDomainRuleInput: REJECT - whitespace', () => {
  const r = bp.validateDomainRuleInput('exa mple.com', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'contains_whitespace');
});

check('validateDomainRuleInput: REJECT - IP literal', () => {
  const r = bp.validateDomainRuleInput('192.168.1.1', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'ip_literal');
});

check('validateDomainRuleInput: REJECT - empty/missing', () => {
  assert.strictEqual(bp.validateDomainRuleInput('', false).ok, false);
  assert.strictEqual(bp.validateDomainRuleInput(undefined, false).ok, false);
  assert.strictEqual(bp.validateDomainRuleInput(null, false).ok, false);
});

// ---------- Phase 1.1: Public Suffix / shared-hosting boundary rejection ----------

check('validateDomainRuleInput: REJECT - bare ICANN public suffix (co.uk)', () => {
  const r = bp.validateDomainRuleInput('co.uk', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'public_suffix_only');
});

check('validateDomainRuleInput: REJECT - bare private-suffix shared host (github.io)', () => {
  const r = bp.validateDomainRuleInput('github.io', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'public_suffix_only');
  // Also rejected even if the admin tried to pair it with allowSubdomains -
  // that combination is exactly the dangerous case this hardening exists
  // to close (ALLOW github.io + allowSubdomains=true would approve every
  // GitHub Pages user site).
  assert.strictEqual(bp.validateDomainRuleInput('github.io', true).ok, false);
});

check('validateDomainRuleInput: REJECT - bare private-suffix shared host (blogspot.com)', () => {
  assert.strictEqual(bp.validateDomainRuleInput('blogspot.com', false).ok, false);
});

check('validateDomainRuleInput: REJECT - bare private-suffix shared host (appspot.com)', () => {
  assert.strictEqual(bp.validateDomainRuleInput('appspot.com', false).ok, false);
});

check('validateDomainRuleInput: PASS - one specific user page under a shared host is fine', () => {
  // someuser.github.io IS a real, specific, individually-approvable site -
  // only the bare shared-hosting boundary itself is rejected, not every
  // page hosted on it.
  const r = bp.validateDomainRuleInput('someuser.github.io', false);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.host, 'someuser.github.io');
});

// ---------- Phase 1.1: IDN / Punycode canonical equivalence ----------

check('validateDomainRuleInput: Unicode and Punycode forms of the same domain canonicalize identically', () => {
  const unicode = bp.validateDomainRuleInput('münchen.de', false);
  const punycode = bp.validateDomainRuleInput('xn--mnchen-3ya.de', false);
  assert.strictEqual(unicode.ok, true);
  assert.strictEqual(punycode.ok, true);
  assert.strictEqual(unicode.host, punycode.host);
});

check('validateDomainRuleInput: uppercase and trailing dot canonicalize the same as plain lowercase', () => {
  const plain = bp.validateDomainRuleInput('example.com', false);
  const upper = bp.validateDomainRuleInput('EXAMPLE.COM', false);
  const dotted = bp.validateDomainRuleInput('example.com.', false);
  assert.strictEqual(upper.host, plain.host);
  assert.strictEqual(dotted.host, plain.host);
});

// ---------- Phase 1.1: fail-closed under garbage/unexpected input ----------
// "If normalization/PSL validation throws or fails, ALLOW must never be
// accepted" - proven here by feeding validateDomainRuleInput inputs a real
// admin form could never send cleanly, and asserting it always returns a
// plain rejection object rather than throwing (which would 500 the request,
// or worse, some untested code path around it treating a thrown error as
// permissive).

check('validateDomainRuleInput: never throws and never accepts non-string input', () => {
  for (const garbage of [123, {}, [], true, NaN, () => {}]) {
    let result;
    assert.doesNotThrow(() => { result = bp.validateDomainRuleInput(garbage, false); });
    assert.strictEqual(result.ok, false);
  }
});

check('validateDomainRuleInput: never throws on pathological strings', () => {
  const pathological = [' ', 'a'.repeat(10000), '....', '...com', String.fromCharCode(0, 1, 2), '中文.com'];
  for (const input of pathological) {
    let result;
    assert.doesNotThrow(() => { result = bp.validateDomainRuleInput(input, false); });
    assert.strictEqual(typeof result.ok, 'boolean');
    // Whatever the verdict, a garbage/edge-case string must never be
    // silently treated as a safe rule target without at least going
    // through real validation - a thrown-and-uncaught exception would be
    // the only way that could happen, which is exactly what this test rules out.
  }
});

// ---------- Phase 2: shared-request resolution (applyRequestResolution) ----------
// Mirrors db.js's resolveBrowserRequest SQL semantics line-by-line - see
// that function's own tests further down for the exact scenario GPT
// flagged as critical: a request shared by two devices must not have one
// device's resolution silently close it out for the other.

check('shared request: DEVICE resolution for A leaves B still pending', () => {
  const devices = [{ deviceId: 'A', decision: null }, { deviceId: 'B', decision: null }];
  const r = bp.applyRequestResolution(devices, { scope: 'DEVICE', deviceId: 'A', decision: 'ALLOW' });
  assert.deepStrictEqual(r.devices, [{ deviceId: 'A', decision: 'ALLOW' }, { deviceId: 'B', decision: null }]);
  assert.strictEqual(r.fullyResolved, false, 'request must NOT be fully resolved while B is still waiting');
});

check('shared request: resolving the last still-waiting device fully resolves it', () => {
  const afterA = [{ deviceId: 'A', decision: 'ALLOW' }, { deviceId: 'B', decision: null }];
  const r = bp.applyRequestResolution(afterA, { scope: 'DEVICE', deviceId: 'B', decision: 'BLOCK' });
  assert.deepStrictEqual(r.devices, [{ deviceId: 'A', decision: 'ALLOW' }, { deviceId: 'B', decision: 'BLOCK' }]);
  assert.strictEqual(r.fullyResolved, true);
});

check('shared request: GLOBAL resolution answers every still-waiting device at once', () => {
  const devices = [{ deviceId: 'A', decision: null }, { deviceId: 'B', decision: null }, { deviceId: 'C', decision: null }];
  const r = bp.applyRequestResolution(devices, { scope: 'GLOBAL', decision: 'ALLOW' });
  assert.deepStrictEqual(r.devices, [
    { deviceId: 'A', decision: 'ALLOW' }, { deviceId: 'B', decision: 'ALLOW' }, { deviceId: 'C', decision: 'ALLOW' },
  ]);
  assert.strictEqual(r.fullyResolved, true);
});

check('shared request: duplicate DEVICE resolution never overwrites an already-answered device', () => {
  const devices = [{ deviceId: 'A', decision: 'ALLOW' }, { deviceId: 'B', decision: null }];
  const r = bp.applyRequestResolution(devices, { scope: 'DEVICE', deviceId: 'A', decision: 'BLOCK' });
  // A already had an answer (ALLOW) - a second DEVICE resolution attempt
  // for the same device must be a no-op on A's row, not silently flip it.
  assert.strictEqual(r.devices.find(d => d.deviceId === 'A').decision, 'ALLOW');
  assert.strictEqual(r.fullyResolved, false, 'B is still untouched and waiting');
});

check('shared request: GLOBAL resolution does not overwrite a device already answered individually', () => {
  const devices = [{ deviceId: 'A', decision: 'BLOCK' }, { deviceId: 'B', decision: null }];
  const r = bp.applyRequestResolution(devices, { scope: 'GLOBAL', decision: 'ALLOW' });
  assert.strictEqual(r.devices.find(d => d.deviceId === 'A').decision, 'BLOCK', "A's earlier individual answer must survive");
  assert.strictEqual(r.devices.find(d => d.deviceId === 'B').decision, 'ALLOW');
  assert.strictEqual(r.fullyResolved, true);
});

// ---------- Phase 2.3: resource-abuse hardening (pure logic) ----------

check('isValidDomainLabel accepts a host right at the 253-char DNS ceiling', () => {
  // 'aaa...a.co': first label sized so the whole string lands exactly on
  // the limit, second label a valid short one - avoids hardcoding the
  // limit's arithmetic twice.
  const host = `${'a'.repeat(bp.MAX_HOST_LENGTH - 3)}.co`;
  assert.strictEqual(host.length, bp.MAX_HOST_LENGTH);
  assert.strictEqual(bp.isValidDomainLabel(host), true);
});

check('isValidDomainLabel rejects a host one character past the 253-char DNS ceiling', () => {
  const host = `${'a'.repeat(bp.MAX_HOST_LENGTH - 2)}.co`;
  assert.strictEqual(host.length, bp.MAX_HOST_LENGTH + 1);
  assert.strictEqual(bp.isValidDomainLabel(host), false);
});

check('isValidDomainLabel rejects non-string input rather than throwing', () => {
  assert.strictEqual(bp.isValidDomainLabel(12345), false);
  assert.strictEqual(bp.isValidDomainLabel(null), false);
  assert.strictEqual(bp.isValidDomainLabel(undefined), false);
});

check('parseNavigationUrl treats an overlong URL as unparseable (never silently truncates)', () => {
  const overlong = `https://example.com/${'a'.repeat(bp.MAX_CHECK_URL_LENGTH)}`;
  assert.ok(overlong.length > bp.MAX_CHECK_URL_LENGTH);
  assert.strictEqual(bp.parseNavigationUrl(overlong), null);
});

check('parseNavigationUrl still parses a URL right at the length ceiling', () => {
  const atLimit = `https://example.com/${'a'.repeat(bp.MAX_CHECK_URL_LENGTH - 'https://example.com/'.length)}`;
  assert.strictEqual(atLimit.length, bp.MAX_CHECK_URL_LENGTH);
  assert.notStrictEqual(bp.parseNavigationUrl(atLimit), null);
});

check('parseNavigationUrl rejects wrong-JSON-type input (number/object/array/null) without throwing', () => {
  for (const bad of [12345, {}, [], null, undefined, true]) {
    assert.strictEqual(bp.parseNavigationUrl(bad), null, `${JSON.stringify(bad)} must not parse`);
  }
});

console.log(`\n${passed} passed, 0 failed`);
