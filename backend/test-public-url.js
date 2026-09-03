'use strict';

const assert = require('assert');
const { publicBaseUrl, cleanConfiguredBase } = require('./publicUrl');

assert.strictEqual(cleanConfiguredBase('https://example.com/path?q=1'), 'https://example.com');
assert.strictEqual(cleanConfiguredBase('javascript:alert(1)'), null);

const old = process.env.PUBLIC_BASE_URL;
delete process.env.PUBLIC_BASE_URL;

const req = {
  protocol: 'http',
  get(name) {
    const values = {
      'x-forwarded-proto': 'https',
      host: 'android-mdm-system.onrender.com',
    };
    return values[name.toLowerCase()] || '';
  },
};
assert.strictEqual(publicBaseUrl(req), 'https://android-mdm-system.onrender.com');

process.env.PUBLIC_BASE_URL = 'https://fixed.example/';
assert.strictEqual(publicBaseUrl(req), 'https://fixed.example');

if (old === undefined) delete process.env.PUBLIC_BASE_URL;
else process.env.PUBLIC_BASE_URL = old;

console.log('Public URL construction: all tests passed');
