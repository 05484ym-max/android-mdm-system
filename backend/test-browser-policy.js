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

console.log(`\n${passed} passed, 0 failed`);
