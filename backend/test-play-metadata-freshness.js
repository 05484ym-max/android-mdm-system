// Pure (DB-free) unit tests for playMetadataFreshness.js - the 3-state
// freshness model that stands in for a real "does this device need an
// update" answer, which the backend can never honestly compute from public
// Google Play data alone (see docs/app-update-check.md). Run directly with
// `node test-play-metadata-freshness.js`, no network/DB needed.
'use strict';

const assert = require('assert');
const fm = require('./playMetadataFreshness');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const NOW = 1_700_000_000_000; // fixed clock, no wall-clock flakiness

// ================= scenario: fresh metadata =================

check('fresh: recently checked, real version, no error -> "fresh"', () => {
  const grade = fm.computeMetadataFreshness({
    playVersion: '5.4.2',
    playMetadataCheckedAt: NOW - 60_000, // 1 minute ago
    playMetadataError: null,
  }, NOW);
  assert.strictEqual(grade, 'fresh');
});

check('fresh: right at the freshness boundary (not yet over it) -> "fresh"', () => {
  const grade = fm.computeMetadataFreshness({
    playVersion: '1.0',
    playMetadataCheckedAt: NOW - fm.PLAY_METADATA_FRESH_MS, // exactly the window
    playMetadataError: null,
  }, NOW);
  assert.strictEqual(grade, 'fresh');
});

// ================= scenario: stale metadata =================

check('stale: checked a long time ago, no error -> "stale"', () => {
  const grade = fm.computeMetadataFreshness({
    playVersion: '2.1',
    playMetadataCheckedAt: NOW - fm.PLAY_METADATA_FRESH_MS - 1,
    playMetadataError: null,
  }, NOW);
  assert.strictEqual(grade, 'stale');
});

check('stale: checked just now but far outside the window over a long absence -> "stale"', () => {
  const grade = fm.computeMetadataFreshness({
    playVersion: '2.1',
    playMetadataCheckedAt: NOW - fm.PLAY_METADATA_FRESH_MS * 100,
    playMetadataError: null,
  }, NOW);
  assert.strictEqual(grade, 'stale');
});

// ================= scenario: Play lookup failure =================

check('failure: a recorded error on the last check -> "stale", even if the check just happened', () => {
  const grade = fm.computeMetadataFreshness({
    playVersion: '2.1', // last known-good version, from BEFORE the failure
    playMetadataCheckedAt: NOW - 1000, // one second ago
    playMetadataError: 'Google Play HTTP 503',
  }, NOW);
  assert.strictEqual(grade, 'stale');
});

check('failure: an error takes priority over an otherwise-fresh timestamp', () => {
  const grade = fm.computeMetadataFreshness({
    playVersion: '2.1',
    playMetadataCheckedAt: NOW,
    playMetadataError: 'timeout',
  }, NOW);
  assert.strictEqual(grade, 'stale');
});

// ================= scenario: rollout/version mismatch uncertainty =================

check('rollout uncertainty: Play\'s own "Varies with device" version -> "unknown", even if just checked', () => {
  const grade = fm.computeMetadataFreshness({
    playVersion: 'Varies with device',
    playMetadataCheckedAt: NOW - 1000,
    playMetadataError: null,
  }, NOW);
  assert.strictEqual(grade, 'unknown');
});

check('rollout uncertainty: no version string at all (a successful check that returned nothing usable) -> "unknown"', () => {
  const grade = fm.computeMetadataFreshness({
    playVersion: null,
    playMetadataCheckedAt: NOW - 1000,
    playMetadataError: null,
  }, NOW);
  assert.strictEqual(grade, 'unknown');
});

check('isVersionAmbiguous recognizes null, empty string, and "Varies with device"', () => {
  assert.strictEqual(fm.isVersionAmbiguous(null), true);
  assert.strictEqual(fm.isVersionAmbiguous(undefined), true);
  assert.strictEqual(fm.isVersionAmbiguous(''), true);
  assert.strictEqual(fm.isVersionAmbiguous('Varies with device'), true);
});

check('isVersionAmbiguous does not flag a real version string', () => {
  for (const v of ['1.0', '5.4.2', '2024.03.15', 'v3', '10.0.0-beta1']) {
    assert.strictEqual(fm.isVersionAmbiguous(v), false, v);
  }
});

// ================= scenario: never checked =================

check('never checked (playMetadataCheckedAt null) -> "unknown", regardless of any other field', () => {
  assert.strictEqual(fm.computeMetadataFreshness({
    playVersion: '9.9.9', playMetadataCheckedAt: null, playMetadataError: null,
  }, NOW), 'unknown');
  assert.strictEqual(fm.computeMetadataFreshness({
    playVersion: null, playMetadataCheckedAt: null, playMetadataError: 'irrelevant',
  }, NOW), 'unknown');
});

// ================= backward-compatible / never throws =================

check('never throws on missing/partial input', () => {
  assert.doesNotThrow(() => fm.computeMetadataFreshness({}, NOW));
  assert.strictEqual(fm.computeMetadataFreshness({}, NOW), 'unknown');
});

check('defaults `now` to Date.now() when not supplied (real-world call shape)', () => {
  const grade = fm.computeMetadataFreshness({
    playVersion: '1.0', playMetadataCheckedAt: Date.now(), playMetadataError: null,
  });
  assert.strictEqual(grade, 'fresh');
});

console.log(`\n${passed} passed, 0 failed`);
