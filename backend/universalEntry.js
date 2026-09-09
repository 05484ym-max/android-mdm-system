'use strict';

require('dotenv').config();

const db = require('./db');
const protectionSync = require('./protectionSync');
const protectionPersistence = require('./protectionPersistence');
const { installProtectionRuntimeBridge } = require('./protectionRuntimeBridge');
const { installProtectionAdminRoutes } = require('./protectionAdminRoutes');

installProtectionRuntimeBridge(db, protectionSync, protectionPersistence);

// Capture the single Express app created by index.js without rewriting the
// large legacy entry file. Static Express helpers (Router/json/static/etc.)
// remain available through the real function object's prototype.
const expressModulePath = require.resolve('express');
const realExpress = require(expressModulePath);
let capturedApp = null;
function capturingExpress(...args) {
  const app = realExpress(...args);
  if (!capturedApp) capturedApp = app;
  return app;
}
Object.setPrototypeOf(capturingExpress, realExpress);
require.cache[expressModulePath].exports = capturingExpress;
try {
  require('./index');
} finally {
  require.cache[expressModulePath].exports = realExpress;
}

if (!capturedApp) {
  throw new Error('Could not capture backend Express app for Universal protection routes');
}
installProtectionAdminRoutes(capturedApp, { db, protectionPersistence });
