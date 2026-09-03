'use strict';

const assert = require('assert');
const {
  normalizeHost,
  evaluateCategoryPayload,
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

console.log('Browser automatic classifier: all tests passed');
