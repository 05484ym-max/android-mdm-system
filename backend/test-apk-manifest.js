'use strict';

const assert = require('assert');
const { extractPackageName, extractAppIcon } = require('./apkManifest');
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

const iconBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8, 9]);
const iconApk = buildTestApk('org.yehudikasher.browser', 4096, { buffer: iconBytes });
const icon = extractAppIcon(iconApk);
assert.ok(icon, 'launcher icon should be detected');
assert.strictEqual(icon.contentType, 'image/png');
assert.strictEqual(icon.extension, 'png');
assert.deepStrictEqual(icon.buffer, iconBytes);

assert.throws(
  () => extractPackageName(Buffer.from('not-an-apk')),
  /ZIP central directory not found/,
);

console.log('APK package/icon auto-detection: all tests passed');
