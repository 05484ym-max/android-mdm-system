'use strict';

const { assessProtectionState, normalizeRequestedProfile } = require('./protectionState');

/**
 * Produces the exact server-owned persistence shape for Universal Adapter
 * reporting. The device may report observed capabilities/achieved state, but
 * requestedProfile is always supplied by server policy, never trusted from the
 * device request body.
 */
function buildDeviceProtectionRecord({ requestedProfile, health }) {
  const requested = normalizeRequestedProfile(requestedProfile);
  const achieved = health && health.achievedProtectionProfile
    ? health.achievedProtectionProfile
    : 'BASIC';
  const assessment = assessProtectionState(requested, achieved);

  return {
    requestedProfile: assessment.requestedProfile,
    achievedProfile: assessment.achievedProfile,
    protectionSatisfied: assessment.satisfied,
    protectionGap: assessment.gap,
    uninstallProtection: health && health.uninstallProtection || 'NONE',
    adapterId: health && health.adapterId || null,
    adapterConfidence: health && Number.isInteger(health.adapterConfidence)
      ? health.adapterConfidence
      : null,
    oemSkin: health && health.oemSkin || null,
    oemSkinVersion: health && health.oemSkinVersion || null,
    deviceCodename: health && health.deviceCodename || null,
    buildDisplay: health && health.buildDisplay || null,
    detectedCapabilities: health && Array.isArray(health.detectedCapabilities)
      ? [...new Set(health.detectedCapabilities)]
      : [],
    capabilityDetectedAt: health && Number.isInteger(health.capabilityDetectedAt)
      ? health.capabilityDetectedAt
      : null,
  };
}

module.exports = { buildDeviceProtectionRecord };
