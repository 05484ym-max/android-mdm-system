'use strict';

const REQUESTED_PROFILES = [
  'BASIC',
  'HARDENED',
  'HARDENED_ADMIN',
  'DEVICE_OWNER',
  'SYSTEM_LEVEL',
];

const RANK = Object.freeze({
  BASIC: 0,
  HARDENED: 1,
  HARDENED_ADMIN: 2,
  DEVICE_OWNER: 3,
  SYSTEM_LEVEL: 4,
});

function normalizeRequestedProfile(value, fallback = 'HARDENED_ADMIN') {
  return REQUESTED_PROFILES.includes(value) ? value : fallback;
}

function assessProtectionState(requestedProfile, achievedProfile) {
  const requested = normalizeRequestedProfile(requestedProfile);
  const achieved = REQUESTED_PROFILES.includes(achievedProfile) ? achievedProfile : 'BASIC';
  const requestedRank = RANK[requested];
  const achievedRank = RANK[achieved];

  return {
    requestedProfile: requested,
    achievedProfile: achieved,
    satisfied: achievedRank >= requestedRank,
    gap: Math.max(0, requestedRank - achievedRank),
  };
}

module.exports = {
  REQUESTED_PROFILES,
  normalizeRequestedProfile,
  assessProtectionState,
};
