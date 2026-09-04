'use strict';

const assert = require('assert');
const {
  normalizeHost,
  evaluateCategoryPayload,
  shouldPromoteToAllowlist,
  MIN_CONFIDENCE_SCORE,
} = require('./browserClassifier');

assert.strictEqual(normalizeHost('Example.COM.'), 'example.com');
assert.strictEqual(normalizeHost('https://example.com'), null);
assert.strictEqual(normalizeHost('127.0.0.1'), null);
assert.strictEqual(normalizeHost('bad host.com'), null);

const safe = evaluateCategoryPayload({
  data: [{
    categories: [
      { id: 'IAB19', parent: 'IAB19', label: 'Technology & Computing', confident: true, score: String(MIN_CONFIDENCE_SCORE + 0.1) },
      { id: 'IAB19-18', parent: 'IAB19', label: 'Internet Technology', confident: true, score: '0.91' },
    ],
  }],
});
assert.strictEqual(safe.allowed, true);
assert.strictEqual(safe.reason, 'safe_category');

const mixed = evaluateCategoryPayload({
  data: [{
    categories: [
      { id: 'IAB5', parent: 'IAB5', label: 'Education', confident: true, score: '0.95' },
      { id: 'IAB25', parent: 'IAB25', label: 'Non-Standard Content', confident: true, score: '0.90' },
    ],
  }],
});
assert.strictEqual(mixed.allowed, false);
assert.strictEqual(mixed.reason, 'category_not_allowed');

const weak = evaluateCategoryPayload({
  data: [{
    categories: [
      { id: 'IAB5', parent: 'IAB5', label: 'Education', confident: true, score: '0.30' },
    ],
  }],
});
assert.strictEqual(weak.allowed, false);
assert.strictEqual(weak.reason, 'classification_not_confident');

const missing = evaluateCategoryPayload({});
assert.strictEqual(missing.allowed, false);
assert.strictEqual(missing.reason, 'classification_missing');

// ---- shouldPromoteToAllowlist(): the single gate the persistent allowlist
// promotion feature relies on. Must be true only for a real, confident,
// stable safe_category decision - false for every transient, low-confidence,
// blocked, invalid-host, or malformed shape the classifier can produce.

assert.strictEqual(shouldPromoteToAllowlist(safe), true, 'a real safe_category decision must promote');
assert.strictEqual(shouldPromoteToAllowlist(mixed), false, 'a blocked category must never promote');
assert.strictEqual(shouldPromoteToAllowlist(weak), false, 'a low-confidence result must never promote');
assert.strictEqual(shouldPromoteToAllowlist(missing), false, 'a malformed/missing classification must never promote');

assert.strictEqual(
  shouldPromoteToAllowlist({ host: 'x.com', allowed: false, reason: 'classifier_unreachable', categories: [] }),
  false,
  'a transient unreachable-classifier result must never promote',
);
assert.strictEqual(
  shouldPromoteToAllowlist({ host: 'x.com', allowed: false, reason: 'classifier_pending_or_unavailable', categories: [] }),
  false,
  'a pending/unavailable classifier result must never promote',
);
assert.strictEqual(
  shouldPromoteToAllowlist({ host: 'x.com', allowed: false, reason: 'classifier_error_500', categories: [] }),
  false,
  'a classifier HTTP error must never promote',
);
assert.strictEqual(
  shouldPromoteToAllowlist({ host: 'x.com', allowed: false, reason: 'classifier_not_configured', categories: [] }),
  false,
  'a misconfigured classifier must never promote',
);
assert.strictEqual(
  shouldPromoteToAllowlist({ host: 'x.com', allowed: false, reason: 'classifier_invalid_response', categories: [] }),
  false,
  'an invalid/malformed classifier response must never promote',
);
assert.strictEqual(
  shouldPromoteToAllowlist({ host: null, allowed: false, reason: 'invalid_host', categories: [] }),
  false,
  'an invalid host must never promote',
);
// Defensive: even a spoofed-looking "allowed: true" with the wrong reason
// string, or the right reason with allowed not strictly true, must not
// promote - only the exact { allowed: true, reason: 'safe_category' } shape
// evaluateCategoryPayload() itself produces qualifies.
assert.strictEqual(
  shouldPromoteToAllowlist({ allowed: true, reason: 'category_not_allowed', categories: [] }),
  false,
  'allowed:true with the wrong reason string must never promote',
);
assert.strictEqual(
  shouldPromoteToAllowlist({ allowed: 'true', reason: 'safe_category', categories: [] }),
  false,
  'a non-boolean-true allowed value must never promote',
);
assert.strictEqual(shouldPromoteToAllowlist(null), false, 'null input must never promote');
assert.strictEqual(shouldPromoteToAllowlist(undefined), false, 'undefined input must never promote');

console.log('Browser automatic classifier: all tests passed');
