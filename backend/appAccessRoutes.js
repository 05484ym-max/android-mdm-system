'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const PACKAGE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const MAX_BLOCKED_APPS = 500;
const SAFE_ADMIN_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeBlockedApps(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean))]
    .filter(item => PACKAGE_NAME_REGEX.test(item))
    .slice(0, MAX_BLOCKED_APPS);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function digestsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function isSameOriginAdminMutation(req) {
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

function installAppAccessRoutes(app, { db, push }) {
  const authEnabled = Boolean(
    process.env.ADMIN_USERNAME &&
    (process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD) &&
    process.env.JWT_SECRET
  );

  function requireAdmin(req, res, next) {
    if (!authEnabled) {
      if (process.env.ALLOW_INSECURE_ADMIN === '1') return next();
      return res.status(503).json({ error: 'admin authentication is not configured' });
    }
    const token = req.cookies && req.cookies.session;
    if (!token) return res.status(401).json({ error: 'not authenticated' });
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      if (!isSameOriginAdminMutation(req)) {
        return res.status(403).json({ error: 'cross-site admin request rejected' });
      }
      next();
    } catch {
      res.status(401).json({ error: 'invalid session' });
    }
  }

  async function requireDevice(req, res, next) {
    try {
      const device = await db.getDevice(req.params.deviceId);
      if (!device || !device.authTokenHash) {
        return res.status(404).json({ error: 'device not found' });
      }
      const token = bearerToken(req);
      if (!token || !digestsMatch(sha256(token), device.authTokenHash)) {
        return res.status(401).json({ error: 'invalid device token' });
      }
      req.appAccessDevice = device;
      next();
    } catch (error) {
      next(error);
    }
  }

  app.get('/api/devices/:deviceId/app-access-policy', requireDevice, (req, res) => {
    const device = req.appAccessDevice;
    res.json({
      mode: device.fullOpenMode === true ? 'OPEN_WITH_BLACKLIST' : 'APPROVED_ONLY',
      blockedApps: normalizeBlockedApps(device.policy && device.policy.blockedApps),
    });
  });

  app.get('/api/devices/:deviceId/blocked-apps', requireAdmin, async (req, res, next) => {
    try {
      const device = await db.getDevice(req.params.deviceId);
      if (!device) return res.status(404).json({ error: 'device not found' });
      res.json({
        blockedApps: normalizeBlockedApps(device.policy && device.policy.blockedApps),
        fullOpen: device.fullOpenMode === true,
      });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/devices/:deviceId/policy/blocked-apps', requireAdmin, async (req, res, next) => {
    try {
      if (!req.body || !Array.isArray(req.body.blockedApps)) {
        return res.status(400).json({ error: 'blockedApps must be an array' });
      }
      if (req.body.blockedApps.length > MAX_BLOCKED_APPS) {
        return res.status(400).json({ error: `blockedApps may contain at most ${MAX_BLOCKED_APPS} packages` });
      }
      const invalid = req.body.blockedApps.find(item =>
        typeof item !== 'string' || !PACKAGE_NAME_REGEX.test(item.trim())
      );
      if (invalid !== undefined) {
        return res.status(400).json({ error: 'blockedApps contains an invalid package name' });
      }
      const device = await db.getDevice(req.params.deviceId);
      if (!device) return res.status(404).json({ error: 'device not found' });
      const blockedApps = normalizeBlockedApps(req.body.blockedApps);
      const policy = { ...(device.policy || {}), blockedApps };
      const updated = await db.setPolicy(device.deviceId, policy);
      await push.wake(updated.pushToken);
      res.json({ blockedApps, fullOpen: updated.fullOpenMode === true });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { installAppAccessRoutes, normalizeBlockedApps };
