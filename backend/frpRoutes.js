'use strict';

const crypto = require('crypto');
const { requireAdmin } = require('./protectionAdminRoutes');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function digestsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function installFrpRoutes(app, { db, frpPersistence, push, logger = console }) {
  app.get('/api/health/frp', requireAdmin, async (_req, res) => {
    try {
      return res.json(await frpPersistence.listAdminStates());
    } catch (error) {
      logger.error?.('[frp] admin list failed:', error.message);
      return res.status(500).json({ error: 'internal error' });
    }
  });

  app.put('/api/health/devices/:deviceId/frp', requireAdmin, async (req, res) => {
    try {
      if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be boolean' });
      }
      const device = await db.getDevice(req.params.deviceId);
      if (!device) return res.status(404).json({ error: 'device not found' });

      const current = await frpPersistence.getDeviceState(req.params.deviceId, true);
      const accountIds = current?.accountIds || [];
      if (req.body.enabled && accountIds.length === 0) {
        return res.status(409).json({ error: 'FRP_RECOVERY_ACCOUNT_REQUIRED' });
      }

      const state = await frpPersistence.setRequestedEnabled(req.params.deviceId, req.body.enabled);
      await push.wake(device.pushToken);
      logger.info?.(`[frp] requested state changed device=${req.params.deviceId} enabled=${req.body.enabled}`);
      return res.json({ status: 'ok', frp: state });
    } catch (error) {
      logger.error?.('[frp] toggle failed:', error.message);
      return res.status(500).json({ error: 'internal error' });
    }
  });

  // Recovery-account identifiers are kept server-side and are never returned
  // by admin read endpoints. This route exists for a later protected setup UI.
  app.put('/api/health/devices/:deviceId/frp/accounts', requireAdmin, async (req, res) => {
    try {
      const device = await db.getDevice(req.params.deviceId);
      if (!device) return res.status(404).json({ error: 'device not found' });
      if (!Array.isArray(req.body?.accountIds)) {
        return res.status(400).json({ error: 'accountIds must be an array' });
      }
      const state = await frpPersistence.setAccounts(req.params.deviceId, req.body.accountIds);
      await push.wake(device.pushToken);
      return res.json({ status: 'ok', frp: state });
    } catch (error) {
      logger.error?.('[frp] account configuration failed:', error.message);
      return res.status(500).json({ error: 'internal error' });
    }
  });

  app.get('/api/devices/:deviceId/frp-policy', async (req, res) => {
    try {
      const device = await db.getDevice(req.params.deviceId);
      if (!device || !device.authTokenHash) return res.status(404).json({ error: 'device not found' });
      const token = bearerToken(req);
      if (!token || !digestsMatch(sha256(token), device.authTokenHash)) {
        return res.status(401).json({ error: 'invalid device token' });
      }
      const state = await frpPersistence.getDeviceState(req.params.deviceId, true);
      return res.json({
        enabled: state?.enabledRequested === true,
        accountIds: state?.accountIds || [],
      });
    } catch (error) {
      logger.warn?.('[frp] device policy lookup failed');
      return res.status(503).json({ error: 'frp policy temporarily unavailable' });
    }
  });

  app.post('/api/devices/:deviceId/frp-status', async (req, res) => {
    try {
      const device = await db.getDevice(req.params.deviceId);
      if (!device || !device.authTokenHash) return res.status(404).json({ error: 'device not found' });
      const token = bearerToken(req);
      if (!token || !digestsMatch(sha256(token), device.authTokenHash)) {
        return res.status(401).json({ error: 'invalid device token' });
      }
      const allowed = ['apiSupported','deviceOwner','policyReadable','enabled','accountCount','matchesDesired','error'];
      const status = {};
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) status[key] = req.body[key];
      const saved = await frpPersistence.recordDeviceStatus(req.params.deviceId, status);
      return res.json({ status: 'ok', frp: saved });
    } catch (error) {
      logger.warn?.('[frp] device status report failed');
      return res.status(503).json({ error: 'frp status temporarily unavailable' });
    }
  });
}

module.exports = { installFrpRoutes };
