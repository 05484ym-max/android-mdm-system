'use strict';

const protectionPersistence = require('./protectionPersistence');

const PROTECTION_REPORT_FIELDS = Object.freeze([
  'adapterId',
  'adapterConfidence',
  'oemSkin',
  'oemSkinVersion',
  'deviceCodename',
  'buildDisplay',
  'capabilityDetectedAt',
  'detectedCapabilities',
  'achievedProtectionProfile',
  'uninstallProtection',
]);

/**
 * Old DPC builds do not send Universal Adapter fields. Do not create/update a
 * protection report merely because a legacy device checked in.
 */
function hasProtectionReport(health) {
  if (!health || typeof health !== 'object') return false;
  return PROTECTION_REPORT_FIELDS.some(field => health[field] !== undefined);
}

/**
 * Persists only the already-validated /sync health shape. requestedProfile is
 * intentionally not accepted here: it remains server-owned inside
 * protectionPersistence.
 */
async function persistProtectionFromSync(deviceId, validatedHealth, persistence = protectionPersistence) {
  if (!hasProtectionReport(validatedHealth)) return null;
  return persistence.recordDeviceProtection(deviceId, validatedHealth);
}

module.exports = {
  PROTECTION_REPORT_FIELDS,
  hasProtectionReport,
  persistProtectionFromSync,
};
