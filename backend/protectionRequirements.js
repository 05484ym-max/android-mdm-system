'use strict';

const { REQUESTED_PROFILES, assessProtectionState } = require('./protectionState');

const KNOWN_CAPABILITIES = new Set([
  'LAUNCHER',
  'DEFAULT_HOME',
  'ACCESSIBILITY',
  'DEVICE_ADMIN',
  'DEVICE_OWNER',
  'ROOT',
  'PRIV_APP',
]);

const TARGET_REQUIREMENTS = Object.freeze({
  BASIC: [],
  HARDENED: ['DEFAULT_HOME', 'ACCESSIBILITY'],
  HARDENED_ADMIN: ['DEVICE_ADMIN'],
  DEVICE_OWNER: ['DEVICE_OWNER'],
  SYSTEM_LEVEL: ['PRIV_APP'],
});

const ACTION_BY_CAPABILITY = Object.freeze({
  DEFAULT_HOME: 'SET_DEFAULT_HOME',
  ACCESSIBILITY: 'ENABLE_ACCESSIBILITY',
  DEVICE_ADMIN: 'ACTIVATE_DEVICE_ADMIN',
  DEVICE_OWNER: 'REPROVISION_DEVICE_OWNER',
  PRIV_APP: 'SYSTEM_INTEGRATION_REQUIRED',
});

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === 'string' && KNOWN_CAPABILITIES.has(item)))];
}

/**
 * Explains what is still missing to satisfy the server-owned requested profile.
 * This intentionally mirrors the Android ProtectionAssessmentResolver semantics:
 * a stronger achieved profile already satisfies a weaker request, so in that
 * case there are no synthetic "missing" capabilities to display.
 */
function describeProtectionRequirements(state) {
  const requestedProfile = REQUESTED_PROFILES.includes(state?.requestedProfile)
    ? state.requestedProfile
    : 'HARDENED_ADMIN';
  const achievedProfile = REQUESTED_PROFILES.includes(state?.achievedProfile)
    ? state.achievedProfile
    : 'BASIC';
  const assessment = assessProtectionState(requestedProfile, achievedProfile);
  const capabilities = normalizeCapabilities(state?.detectedCapabilities);
  const observed = new Set(capabilities);

  if (assessment.satisfied) {
    return {
      requestedProfile,
      achievedProfile,
      satisfied: true,
      missingCapabilities: [],
      nextActions: [],
      requiresReprovisioning: false,
      requiresSystemIntegration: false,
    };
  }

  const target = TARGET_REQUIREMENTS[requestedProfile] || [];
  const missingCapabilities = target.filter(capability => !observed.has(capability));
  const nextActions = missingCapabilities
    .map(capability => ACTION_BY_CAPABILITY[capability])
    .filter(Boolean);

  return {
    requestedProfile,
    achievedProfile,
    satisfied: false,
    missingCapabilities,
    nextActions,
    requiresReprovisioning: missingCapabilities.includes('DEVICE_OWNER'),
    requiresSystemIntegration: missingCapabilities.includes('PRIV_APP'),
  };
}

module.exports = {
  KNOWN_CAPABILITIES,
  TARGET_REQUIREMENTS,
  ACTION_BY_CAPABILITY,
  normalizeCapabilities,
  describeProtectionRequirements,
};
