'use strict';

const crypto = require('crypto');

const RELEASE_STATUSES = new Set(['TEST', 'ROLLOUT', 'STABLE', 'HALTED']);

function normalizeReleaseControl(status, rolloutPercentage) {
  const normalizedStatus = String(status || '').toUpperCase();
  if (!RELEASE_STATUSES.has(normalizedStatus)) {
    throw new Error('invalid release status');
  }

  const raw = Number(rolloutPercentage);
  if (!Number.isInteger(raw) || raw < 0 || raw > 100) {
    throw new Error('rolloutPercentage must be an integer from 0 to 100');
  }

  if (normalizedStatus === 'TEST') {
    return { status: normalizedStatus, rolloutPercentage: 0 };
  }
  if (normalizedStatus === 'STABLE') {
    return { status: normalizedStatus, rolloutPercentage: 100 };
  }
  if (normalizedStatus === 'HALTED') {
    return { status: normalizedStatus, rolloutPercentage: 0 };
  }
  if (raw < 1 || raw > 99) {
    throw new Error('ROLLOUT percentage must be between 1 and 99');
  }
  return { status: normalizedStatus, rolloutPercentage: raw };
}

function rolloutBucket(deviceId, versionCode) {
  const digest = crypto
    .createHash('sha256')
    .update(`${String(deviceId)}:${String(versionCode)}`)
    .digest();
  return digest.readUInt32BE(0) % 100;
}

function isDeviceEligibleForRelease(release, { deviceId, isTestDevice = false } = {}) {
  if (!release) return false;
  const status = String(release.releaseStatus || release.release_status || '').toUpperCase();
  const percentage = Number(release.rolloutPercentage ?? release.rollout_percentage ?? 0);

  if (status === 'HALTED') return false;
  if (status === 'STABLE') return true;
  if (isTestDevice) return true;
  if (status === 'TEST') return false;
  if (status !== 'ROLLOUT') return false;

  return rolloutBucket(deviceId, release.versionCode ?? release.version_code) < percentage;
}

module.exports = {
  RELEASE_STATUSES,
  normalizeReleaseControl,
  rolloutBucket,
  isDeviceEligibleForRelease,
};
