'use strict';

/**
 * Runs a synchronous module loader while temporarily wrapping the cached
 * Express factory, returning the first app that loader creates. The original
 * module export is always restored, including when the loader throws.
 */
function captureExpressApp(loadModule) {
  if (typeof loadModule !== 'function') {
    throw new Error('captureExpressApp requires a loader function');
  }

  const expressModulePath = require.resolve('express');
  const realExpress = require(expressModulePath);
  const cachedModule = require.cache[expressModulePath];
  if (!cachedModule) throw new Error('Express module cache is unavailable');

  const previousExport = cachedModule.exports;
  let capturedApp = null;
  function capturingExpress(...args) {
    const app = realExpress(...args);
    if (!capturedApp) capturedApp = app;
    return app;
  }

  // Preserve express.Router/json/static/etc. without copying or mutating the
  // real factory. Property lookup falls through to the original function.
  Object.setPrototypeOf(capturingExpress, realExpress);
  cachedModule.exports = capturingExpress;
  try {
    loadModule();
  } finally {
    cachedModule.exports = previousExport;
  }

  if (!capturedApp) {
    throw new Error('Loader did not create an Express app');
  }
  return capturedApp;
}

module.exports = { captureExpressApp };
