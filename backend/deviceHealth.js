// Validation for the device-health fields reported on every /sync request.
// Kept separate from index.js/db.js so the sync route doesn't keep growing -
// this module only validates and sanitizes; db.js still owns all SQL.

const MAX_TEXT_LENGTH = 200;
const MAX_ERROR_LENGTH = 500;
const UPDATE_STATUSES = ['SUCCESS', 'FAILED', 'SKIPPED'];

function str(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

/**
 * Validates and sanitizes the optional device-health fields on a /sync
 * request body. Returns { error } if something PRESENT is malformed, or
 * { value } containing only the fields that were actually present (already
 * clamped/truncated). A field simply being absent is never an error - that's
 * what keeps an older device, which doesn't send any of this, still able to
 * sync normally.
 *
 * model/androidVersion keep their original lenient behavior (silently
 * dropped if not a string, never rejected) to exactly preserve the existing
 * /sync contract those two fields already had before this change.
 */
function validateHealthPayload(body) {
  const value = {};

  value.model = str(body.model, 100);
  value.androidVersion = str(body.androidVersion, 20);

  if (body.currentVersionCode !== undefined) {
    const n = body.currentVersionCode;
    if (!Number.isInteger(n) || n <= 0) {
      return { error: 'currentVersionCode must be a positive integer' };
    }
    value.currentVersionCode = n;
  }

  if (body.currentVersionName !== undefined) {
    if (typeof body.currentVersionName !== 'string') {
      return { error: 'currentVersionName must be a string' };
    }
    value.currentVersionName = str(body.currentVersionName, MAX_TEXT_LENGTH);
  }

  if (body.isDeviceOwner !== undefined) {
    if (typeof body.isDeviceOwner !== 'boolean') {
      return { error: 'isDeviceOwner must be a boolean' };
    }
    value.isDeviceOwner = body.isDeviceOwner;
  }

  if (body.lastUpdateStatus !== undefined) {
    if (!UPDATE_STATUSES.includes(body.lastUpdateStatus)) {
      return { error: 'lastUpdateStatus must be one of ' + UPDATE_STATUSES.join(', ') };
    }
    value.lastUpdateStatus = body.lastUpdateStatus;
  }

  if (body.lastUpdateVersion !== undefined) {
    const n = body.lastUpdateVersion;
    if (!Number.isInteger(n) || n <= 0) {
      return { error: 'lastUpdateVersion must be a positive integer' };
    }
    value.lastUpdateVersion = n;
  }

  if (body.lastUpdateError !== undefined) {
    if (typeof body.lastUpdateError !== 'string') {
      return { error: 'lastUpdateError must be a string' };
    }
    value.lastUpdateError = str(body.lastUpdateError, MAX_ERROR_LENGTH);
  }

  if (body.batteryLevel !== undefined) {
    const n = body.batteryLevel;
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return { error: 'batteryLevel must be an integer between 0 and 100' };
    }
    value.batteryLevel = n;
  }

  if (body.freeStorageBytes !== undefined) {
    const n = body.freeStorageBytes;
    if (!Number.isInteger(n) || n < 0) {
      return { error: 'freeStorageBytes must be a non-negative integer' };
    }
    value.freeStorageBytes = n;
  }

  if (body.manufacturer !== undefined) {
    if (typeof body.manufacturer !== 'string') {
      return { error: 'manufacturer must be a string' };
    }
    value.manufacturer = str(body.manufacturer, MAX_TEXT_LENGTH);
  }

  return { value };
}

module.exports = { validateHealthPayload };
