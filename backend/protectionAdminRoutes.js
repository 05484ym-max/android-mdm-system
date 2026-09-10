'use strict';

const jwt = require('jsonwebtoken');
const { normalizeRequestedProfile } = require('./protectionState');

const ALLOWED_PROFILES = Object.freeze([
  'BASIC',
  'HARDENED',
  'HARDENED_ADMIN',
  'DEVICE_OWNER',
  'SYSTEM_LEVEL',
]);

const SAFE_ADMIN_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function authEnabled() {
  return Boolean(
    process.env.ADMIN_USERNAME &&
    (process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD) &&
    process.env.JWT_SECRET
  );
}

function sameOriginMutation(req) {
  if (SAFE_ADMIN_METHODS.has(req.method)) return true;
  const origin = req.get('origin');
  const fetchSite = (req.get('sec-fetch-site') || '').toLowerCase();
  if (!origin) return fetchSite !== 'cross-site';
  try {
    const expectedOrigin = new URL(`${req.protocol}://${req.get('host')}`).origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (!authEnabled()) {
    if (process.env.ALLOW_INSECURE_ADMIN === '1') return next();
    return res.status(503).json({ error: 'admin authentication is not configured' });
  }

  const token = req.cookies && req.cookies.session;
  if (!token) return res.status(401).json({ error: 'not authenticated' });

  try {
    jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid session' });
  }

  if (!sameOriginMutation(req)) {
    return res.status(403).json({ error: 'cross-site admin request rejected' });
  }
  next();
}

function validateRequestedProfile(value) {
  if (typeof value !== 'string' || !ALLOWED_PROFILES.includes(value)) return null;
  return normalizeRequestedProfile(value);
}

function installProtectionAdminRoutes(app, { db, protectionPersistence, logger = console }) {
  if (!app || typeof app.put !== 'function') {
    throw new Error('protection admin routes require an Express app');
  }
  if (!db || typeof db.getDevice !== 'function') {
    throw new Error('protection admin routes require db.getDevice');
  }
  if (!protectionPersistence || typeof protectionPersistence.setRequestedProfile !== 'function') {
    throw new Error('protection admin routes require protectionPersistence.setRequestedProfile');
  }

  app.put('/api/health/devices/:deviceId/protection/requested', requireAdmin, async (req, res) => {
    try {
      const requestedProfile = validateRequestedProfile(req.body && req.body.requestedProfile);
      if (!requestedProfile) {
        return res.status(400).json({
          error: 'requestedProfile must be one of ' + ALLOWED_PROFILES.join(', '),
        });
      }

      const device = await db.getDevice(req.params.deviceId);
      if (!device) return res.status(404).json({ error: 'device not found' });

      const state = await protectionPersistence.setRequestedProfile(
        req.params.deviceId,
        requestedProfile,
      );
      logger.info?.(
        `[universal-protection] requested profile device=${req.params.deviceId} profile=${requestedProfile}`,
      );
      return res.json({ status: 'ok', protection: state });
    } catch (error) {
      logger.error?.(
        `[universal-protection] requested profile update failed for device ${req.params.deviceId}:`,
        error.message,
      );
      return res.status(500).json({ error: 'internal error' });
    }
  });
}

module.exports = {
  ALLOWED_PROFILES,
  installProtectionAdminRoutes,
  validateRequestedProfile,
  sameOriginMutation,
  requireAdmin,
};
