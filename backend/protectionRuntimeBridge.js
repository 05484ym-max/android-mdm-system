'use strict';

const BRIDGE_INSTALLED = Symbol.for('mdm.universalProtectionBridgeInstalled');

/**
 * Installs a narrow compatibility bridge around the existing DB methods so the
 * current /sync and /api/health/devices routes can consume Universal Adapter
 * state without changing their public contracts or Device Owner enforcement.
 *
 * The bridge is deliberately best-effort: a protection telemetry/persistence
 * failure must never break an otherwise valid device sync or health dashboard.
 */
function installProtectionRuntimeBridge(db, protectionSync, protectionPersistence, logger = console) {
  if (!db || db[BRIDGE_INSTALLED]) return false;
  if (typeof db.recordDeviceHealth !== 'function' || typeof db.listDeviceHealth !== 'function') {
    throw new Error('protection runtime bridge requires recordDeviceHealth and listDeviceHealth');
  }

  const originalRecordDeviceHealth = db.recordDeviceHealth.bind(db);
  const originalListDeviceHealth = db.listDeviceHealth.bind(db);
  const originalGetDeviceHealth = typeof db.getDeviceHealth === 'function'
    ? db.getDeviceHealth.bind(db)
    : null;

  db.recordDeviceHealth = async function bridgedRecordDeviceHealth(deviceId, health) {
    const result = await originalRecordDeviceHealth(deviceId, health);
    try {
      await protectionSync.persistProtectionFromSync(deviceId, health, protectionPersistence);
    } catch (error) {
      logger.warn?.(`[universal-protection] persist failed for device ${deviceId}:`, error.message);
    }
    return result;
  };

  db.listDeviceHealth = async function bridgedListDeviceHealth(...args) {
    const devices = await originalListDeviceHealth(...args);
    try {
      const rows = await protectionPersistence.listDeviceProtection();
      const byId = new Map(rows.map(row => [row.deviceId, row]));
      return devices.map(device => ({
        ...device,
        protection: byId.get(device.deviceId) || null,
      }));
    } catch (error) {
      logger.warn?.('[universal-protection] health enrichment failed:', error.message);
      return devices.map(device => ({ ...device, protection: null }));
    }
  };

  if (originalGetDeviceHealth) {
    db.getDeviceHealth = async function bridgedGetDeviceHealth(deviceId, ...args) {
      const device = await originalGetDeviceHealth(deviceId, ...args);
      if (!device) return null;
      try {
        const protection = await protectionPersistence.getDeviceProtection(deviceId);
        return { ...device, protection };
      } catch (error) {
        logger.warn?.(`[universal-protection] health lookup enrichment failed for device ${deviceId}:`, error.message);
        return { ...device, protection: null };
      }
    };
  }

  Object.defineProperty(db, BRIDGE_INSTALLED, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return true;
}

module.exports = { installProtectionRuntimeBridge, BRIDGE_INSTALLED };
