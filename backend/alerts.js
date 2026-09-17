// Alert lifecycle on top of the existing diagnostics faults - diagnostics.js
// stays the sole source of truth for what's wrong with a device; this module
// only decides which fault codes are worth an alert, and opens/resolves rows
// in the `alerts` table to match. All actual SQL lives in db.js.
const crypto = require('crypto');
const db = require('./db');
const diagnostics = require('./diagnostics');

// Alert only on actionable management faults. Informational states such as
// HEALTH_DATA_MISSING and LOW_BATTERY are intentionally excluded to avoid
// turning the panel into noise.
const ALERT_FAULT_CODES = new Set([
  'DEVICE_OWNER_LOST',
  'DEVICE_OFFLINE',
  'UPDATE_FAILED',
  'NEVER_CONTACTED',
  'SYNC_STALE',
  'LOW_STORAGE',
  'DNS_FILTER_MISMATCH',
  'DNS_RESOLUTION_FAILED',
  'DNS_PROVIDER_UNREACHABLE',
  'DNS_FAILSAFE_ACTIVE',
]);

/**
 * Reconciles the alerts table with one device's current diagnosis:
 * - a fault newly present (and alert-worthy) opens a new alert, unless one
 *   is already open for that exact deviceId+faultCode;
 * - an alert whose fault is no longer present gets resolved_at set;
 * - a fault that reappears after its alert was resolved opens a fresh alert.
 */
async function syncAlertsForDevice(device) {
  const faults = diagnostics.diagnose(device);
  const activeCodes = new Set(faults.map(f => f.code).filter(code => ALERT_FAULT_CODES.has(code)));

  const openAlerts = await db.listOpenAlertsForDevice(device.deviceId);
  const openCodes = new Set(openAlerts.map(a => a.category));

  for (const fault of faults) {
    if (!ALERT_FAULT_CODES.has(fault.code) || openCodes.has(fault.code)) continue;
    await db.createAlert(crypto.randomUUID(), device.deviceId, fault.code, fault.severity, fault.title);
  }

  for (const alert of openAlerts) {
    if (!activeCodes.has(alert.category)) {
      await db.resolveAlert(alert.id);
    }
  }
}

/**
 * Re-runs syncAlertsForDevice() across the whole fleet. This catches offline
 * devices too, because those devices cannot trigger reconciliation themselves.
 */
async function reconcileAllDevices() {
  const devices = await db.listDeviceHealth();
  for (const device of devices) {
    try {
      await syncAlertsForDevice(device);
    } catch (e) {
      console.warn('[alerts] reconcile failed for device %s: %s', device.deviceId, e.message);
    }
  }
}

function listActiveAlerts() {
  return db.listActiveAlerts();
}

module.exports = { syncAlertsForDevice, reconcileAllDevices, listActiveAlerts };
