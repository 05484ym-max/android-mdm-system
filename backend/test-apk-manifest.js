'use strict';

const assert = require('assert');
const { extractPackageName } = require('./apkManifest');
const { buildTestApk } = require('./testApkFixture');

const cases = [
  'org.yehudikasher.browser',
  'com.example.app',
  'co.il.example.product',
];

for (const packageName of cases) {
  const apk = buildTestApk(packageName, 4096);
  assert.strictEqual(extractPackageName(apk), packageName);
}

assert.throws(
  () => extractPackageName(Buffer.from('not-an-apk')),
  /ZIP central directory not found/,
);

console.log('APK package auto-detection: all tests passed');
