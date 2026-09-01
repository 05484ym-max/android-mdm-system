// Validation for the device-health fields reported on every /sync request.
// Kept separate from index.js/db.js so the sync route doesn't keep growing -
// this module only validates and sanitizes; db.js still owns all SQL.

const MAX_TEXT_LENGTH = 200;
const MAX_ERROR_LENGTH = 500;
const UPDATE_STATUSES = ['SUCCESS', 'FAILED', 'SKIPPED'];
const MAX_NO_LAUNCHER_CANDIDATES = 200;
const DNS_MODES = ['OFF', 'OPPORTUNISTIC', 'PROVIDER_HOSTNAME', 'UNKNOWN', 'ERROR'];
const DNS_FAIL_SAFE_STATES = ['NORMAL', 'DEGRADED', 'ROLLED_BACK', 'RECOVERING'];
const DNS_NETWORK_TYPES = ['WIFI', 'CELLULAR', 'OTHER', 'NONE'];

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

  // DNS filtering status (see AdBlockDns.kt). dnsFilteringRequested is
  // deliberately not read here - the server owns that value (see
  // setDnsDesiredState); the device's own echo of it is inert and ignored
  // rather than validated, since nothing ever stores it back.
  if (body.dnsMode !== undefined) {
    if (!DNS_MODES.includes(body.dnsMode)) {
      return { error: 'dnsMode must be one of ' + DNS_MODES.join(', ') };
    }
    value.dnsMode = body.dnsMode;
  }

  if (body.dnsActualProviderHost !== undefined) {
    if (typeof body.dnsActualProviderHost !== 'string') {
      return { error: 'dnsActualProviderHost must be a string' };
    }
    value.dnsActualProviderHost = str(body.dnsActualProviderHost, MAX_TEXT_LENGTH);
  }

  if (body.dnsFilteringActual !== undefined) {
    if (typeof body.dnsFilteringActual !== 'boolean') {
      return { error: 'dnsFilteringActual must be a boolean' };
    }
    value.dnsFilteringActual = body.dnsFilteringActual;
  }

  if (body.dnsFailSafeState !== undefined) {
    if (!DNS_FAIL_SAFE_STATES.includes(body.dnsFailSafeState)) {
      return { error: 'dnsFailSafeState must be one of ' + DNS_FAIL_SAFE_STATES.join(', ') };
    }
    value.dnsFailSafeState = body.dnsFailSafeState;
  }

  if (body.dnsResolutionOk !== undefined) {
    if (typeof body.dnsResolutionOk !== 'boolean') {
      return { error: 'dnsResolutionOk must be a boolean' };
    }
    value.dnsResolutionOk = body.dnsResolutionOk;
  }

  if (body.dotProviderReachable !== undefined) {
    if (typeof body.dotProviderReachable !== 'boolean') {
      return { error: 'dotProviderReachable must be a boolean' };
    }
    value.dotProviderReachable = body.dotProviderReachable;
  }

  if (body.currentNetworkType !== undefined) {
    if (!DNS_NETWORK_TYPES.includes(body.currentNetworkType)) {
      return { error: 'currentNetworkType must be one of ' + DNS_NETWORK_TYPES.join(', ') };
    }
    value.currentNetworkType = body.currentNetworkType;
  }

  if (body.consecutiveDnsFailures !== undefined) {
    const n = body.consecutiveDnsFailures;
    if (!Number.isInteger(n) || n < 0) {
      return { error: 'consecutiveDnsFailures must be a non-negative integer' };
    }
    value.consecutiveDnsFailures = n;
  }

  if (body.lastDnsCheckAt !== undefined) {
    if (!Number.isInteger(body.lastDnsCheckAt) || body.lastDnsCheckAt <= 0) {
      return { error: 'lastDnsCheckAt must be a positive integer' };
    }
    value.lastDnsCheckAt = body.lastDnsCheckAt;
  }

  if (body.lastDnsModeChangeAt !== undefined) {
    if (!Number.isInteger(body.lastDnsModeChangeAt) || body.lastDnsModeChangeAt <= 0) {
      return { error: 'lastDnsModeChangeAt must be a positive integer' };
    }
    value.lastDnsModeChangeAt = body.lastDnsModeChangeAt;
  }

  if (body.lastRollbackAt !== undefined) {
    if (!Number.isInteger(body.lastRollbackAt) || body.lastRollbackAt <= 0) {
      return { error: 'lastRollbackAt must be a positive integer' };
    }
    value.lastRollbackAt = body.lastRollbackAt;
  }

  if (body.failureReason !== undefined) {
    if (typeof body.failureReason !== 'string') {
      return { error: 'failureReason must be a string' };
    }
    value.failureReason = str(body.failureReason, MAX_TEXT_LENGTH);
  }

  if (body.previousDnsMode !== undefined) {
    if (!DNS_MODES.includes(body.previousDnsMode)) {
      return { error: 'previousDnsMode must be one of ' + DNS_MODES.join(', ') };
    }
    value.previousDnsMode = body.previousDnsMode;
  }

  // A customer-initiated DNS toggle not yet confirmed by the server (see
  // Config.setDnsPendingCustomerRequest in the app) - handled directly in
  // index.js's /sync route (re-derives allowCustomerDnsToggle server-side
  // before honoring it), not stored via recordDeviceHealth.
  if (body.customerDnsToggleRequest !== undefined) {
    if (typeof body.customerDnsToggleRequest !== 'boolean') {
      return { error: 'customerDnsToggleRequest must be a boolean' };
    }
    value.customerDnsToggleRequest = body.customerDnsToggleRequest;
  }

  // Read-only DRY-RUN report (see PolicyEnforcer.kt / DeviceHealth.kt) - no
  // enforcement anywhere reads this back, so a malformed entry is dropped
  // rather than failing the whole sync. Only the field being present but not
  // an array at all is treated as a real bug worth rejecting.
  if (body.wouldHideNoLauncherPackages !== undefined) {
    if (!Array.isArray(body.wouldHideNoLauncherPackages)) {
      return { error: 'wouldHideNoLauncherPackages must be an array' };
    }
    value.wouldHideNoLauncherPackages = body.wouldHideNoLauncherPackages
      .filter(item => item && typeof item.packageName === 'string' && item.packageName.length > 0)
      .slice(0, MAX_NO_LAUNCHER_CANDIDATES)
      .map(item => ({
        packageName: str(item.packageName, MAX_TEXT_LENGTH),
        label: typeof item.label === 'string' ? str(item.label, MAX_TEXT_LENGTH) : null,
      }));
  }

  return { value };
}

module.exports = { validateHealthPayload };
