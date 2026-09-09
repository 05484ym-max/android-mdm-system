'use strict';

const assert = require('assert');
const realExpress = require('express');
const { captureExpressApp } = require('./expressAppCapture');

function main() {
  const before = require('express');
  let loaderSawWrappedFactory = false;

  const app = captureExpressApp(() => {
    const express = require('express');
    loaderSawWrappedFactory = express !== realExpress;
    assert.strictEqual(typeof express.Router, 'function');
    assert.strictEqual(typeof express.json, 'function');
    const created = express();
    created.get('/capture-test', (_req, res) => res.json({ ok: true }));
  });

  assert.strictEqual(loaderSawWrappedFactory, true);
  assert.ok(app && typeof app.listen === 'function');
  assert.strictEqual(require('express'), before, 'original Express export must be restored');

  assert.throws(
    () => captureExpressApp(() => {}),
    /did not create an Express app/,
  );
  assert.strictEqual(require('express'), before, 'Express export must also restore after empty loader');

  assert.throws(
    () => captureExpressApp(() => { throw new Error('loader exploded'); }),
    /loader exploded/,
  );
  assert.strictEqual(require('express'), before, 'Express export must restore after loader failure');

  console.log('express app capture tests passed');
}

main();
