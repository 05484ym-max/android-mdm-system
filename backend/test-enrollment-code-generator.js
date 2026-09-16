const assert = require('assert');
const crypto = require('crypto');

const LENGTH = 10;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateEnrollmentCode() {
  const bytes = crypto.randomBytes(LENGTH);
  let code = '';
  for (let i = 0; i < LENGTH; i += 1) code += ALPHABET[bytes[i] & 31];
  return code;
}

const seen = new Set();
for (let i = 0; i < 1000; i += 1) {
  const code = generateEnrollmentCode();
  assert.strictEqual(code.length, LENGTH);
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
  seen.add(code);
}
assert(seen.size > 990, 'unexpectedly high collision count');
console.log('enrollment code generator checks passed');
