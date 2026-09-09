'use strict';

const crypto = require('crypto');
const { describeProtectionRequirements } = require('./protectionRequirements');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function digestsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function installProtectionDeviceRoutes(app, { db, protectionPersistence, logger = console }) {
  if (!app || typeof app.get !== 'function') {
    throw new Error('protection device routes require an Express app');
  }
  if (!db || typeof db.getDevice !== 'function') {
    throw new Error('protection device routes require db.getDevice');
  }
  if (!protectionPersistence || typeof protectionPersistence.getDeviceProtection !== 'function') {
    throw new Error('protection device routes require protectionPersistence.getDeviceProtection');
  }

  app.get('/api/devices/:deviceId/protection-target', async (req, res) => {
    try {
      const device = await db.getDevice(req.params.deviceId);
      if (!device || !device.authTokenHash) {
        return res.status(404).json({ error: 'device not found' });
      }

      const token = bearerToken(req);
      if (!token || !digestsMatch(sha256(token), device.authTokenHash)) {
        return res.status(401).json({ error: 'invalid device token' });
      }

      const state = await protectionPersistence.getDeviceProtection(req.params.deviceId);
      const effective = state || {
        requestedProfile: 'HARDENED_ADMIN',
        achievedProfile: 'BASIC',
        detectedCapabilities: [],
      };
      const requirements = describeProtectionRequirements(effective);

      return res.json({
        requestedProfile: effective.requestedProfile || 'HARDENED_ADMIN',
        achievedProfile: effective.achievedProfile || 'BASIC',
        protectionSatisfied: requirements.satisfied,
        missingCapabilities: requirements.missingCapabilities,
        nextActions: requirements.nextActions,
        requiresReprovisioning: requirements.requiresReprovisioning,
        requiresSystemIntegration: requirements.requiresSystemIntegration,
      });
    } catch (error) {
      logger.warn?.(`[universal-protection] device target lookup failed for ${req.params.deviceId}:`, error.message);
      if (!res.headersSent) return res.status(503).json({ error: 'protection target temporarily unavailable' });
    }
  });
}

module.exports = {
  installProtectionDeviceRoutes,
  bearerToken,
  digestsMatch,
  sha256,
};
