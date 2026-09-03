// Pure unit tests for apkStorage.js - no network, no database. Run:
//   node test-apk-storage.js
'use strict';

const assert = require('assert');
const apkStorage = require('./apkStorage');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`FAIL - ${name}`);
    console.log(`  ${e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e.message}`);
  }
}

const FULL_ENV = {
  APK_STORAGE_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  APK_STORAGE_REGION: 'auto',
  APK_STORAGE_BUCKET: 'test-bucket',
  APK_STORAGE_ACCESS_KEY_ID: 'test-access-key',
  APK_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
  APK_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/apks',
};

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(FULL_ENV)) saved[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries({ ...FULL_ENV, ...overrides })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ---------- loadStorageConfig: fail-closed ----------

for (const missingVar of [
  'APK_STORAGE_ENDPOINT', 'APK_STORAGE_BUCKET', 'APK_STORAGE_ACCESS_KEY_ID',
  'APK_STORAGE_SECRET_ACCESS_KEY', 'APK_STORAGE_PUBLIC_BASE_URL',
]) {
  test(`loadStorageConfig throws (fail-closed) when ${missingVar} is missing`, () => {
    withEnv({ [missingVar]: undefined }, () => {
      assert.throws(() => apkStorage.loadStorageConfig(), new RegExp(missingVar));
    });
  });
}

test('loadStorageConfig succeeds and defaults region to "auto" when APK_STORAGE_REGION is unset', () => {
  withEnv({ APK_STORAGE_REGION: undefined }, () => {
    const config = apkStorage.loadStorageConfig();
    assert.strictEqual(config.region, 'auto');
  });
});

test('loadStorageConfig returns every configured field, never fabricating a default endpoint/bucket', () => {
  withEnv({}, () => {
    const config = apkStorage.loadStorageConfig();
    assert.strictEqual(config.endpoint, FULL_ENV.APK_STORAGE_ENDPOINT);
    assert.strictEqual(config.bucket, FULL_ENV.APK_STORAGE_BUCKET);
    assert.strictEqual(config.accessKeyId, FULL_ENV.APK_STORAGE_ACCESS_KEY_ID);
    assert.strictEqual(config.secretAccessKey, FULL_ENV.APK_STORAGE_SECRET_ACCESS_KEY);
    assert.strictEqual(config.publicBaseUrl, FULL_ENV.APK_STORAGE_PUBLIC_BASE_URL);
  });
});

// ---------- generateApkStorageKey ----------

test('generateApkStorageKey produces a key shaped like apps/<uuid>.apk', () => {
  const key = apkStorage.generateApkStorageKey();
  assert.match(key, /^apps\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$/);
});

test('generateApkStorageKey never derives the key from anything caller-supplied (no arguments) and is random each call', () => {
  assert.strictEqual(apkStorage.generateApkStorageKey.length, 0, 'must take no arguments - nothing to trust from a caller');
  const keys = new Set();
  for (let i = 0; i < 50; i++) keys.add(apkStorage.generateApkStorageKey());
  assert.strictEqual(keys.size, 50, 'every generated key must be unique');
});

// ---------- publicUrlForKey ----------

test('publicUrlForKey joins the configured base URL and key with exactly one slash', () => {
  withEnv({}, () => {
    const config = apkStorage.loadStorageConfig();
    assert.strictEqual(
      apkStorage.publicUrlForKey(config, 'apps/abc.apk'),
      'https://cdn.example.com/apks/apps/abc.apk',
    );
  });
});

test('publicUrlForKey strips a trailing slash on the configured base URL to avoid a doubled slash', () => {
  withEnv({ APK_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/apks/' }, () => {
    const config = apkStorage.loadStorageConfig();
    assert.strictEqual(
      apkStorage.publicUrlForKey(config, 'apps/abc.apk'),
      'https://cdn.example.com/apks/apps/abc.apk',
    );
  });
});

// ---------- APK_CONTENT_TYPE ----------

test('APK_CONTENT_TYPE is the correct Android package MIME type', () => {
  assert.strictEqual(apkStorage.APK_CONTENT_TYPE, 'application/vnd.android.package-archive');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.error.message}`);
}
process.exit(failed ? 1 : 0);
