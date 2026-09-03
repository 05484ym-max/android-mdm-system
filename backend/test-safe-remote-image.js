'use strict';

const assert = require('assert');
const {
  isPublicIp,
  validateImageUrl,
  detectImageType,
} = require('./safeRemoteImage');

for (const ip of [
  '127.0.0.1',
  '10.0.0.1',
  '172.16.0.1',
  '192.168.1.1',
  '169.254.169.254',
  '100.64.0.1',
  '::1',
  'fc00::1',
  'fe80::1',
  '2001:db8::1',
]) {
  assert.strictEqual(isPublicIp(ip), false, ip + ' must be blocked');
}

assert.strictEqual(isPublicIp('8.8.8.8'), true);
assert.strictEqual(isPublicIp('1.1.1.1'), true);
assert.strictEqual(isPublicIp('2606:4700:4700::1111'), true);

assert.throws(() => validateImageUrl('http://example.com/a.png'), /image_https_required/);
assert.throws(() => validateImageUrl('https://127.0.0.1/a.png'), /invalid_image_url|image/);
assert.throws(() => validateImageUrl('https://user:pass@example.com/a.png'), /invalid_image_url/);
assert.throws(() => validateImageUrl('https://example.com:8443/a.png'), /image_non_default_port/);
assert.strictEqual(validateImageUrl('https://example.com/a.png#x').toString(), 'https://example.com/a.png');

const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
assert.strictEqual(detectImageType(png).mimeType, 'image/png');

const jpg = Buffer.from([0xff,0xd8,0xff,0,0,0,0,0,0,0,0,0]);
assert.strictEqual(detectImageType(jpg).mimeType, 'image/jpeg');

const webp = Buffer.from('RIFFxxxxWEBP', 'ascii');
assert.strictEqual(detectImageType(webp).mimeType, 'image/webp');

assert.strictEqual(detectImageType(Buffer.from('not-an-image')), null);

console.log('Safe remote image primitives: all tests passed');
