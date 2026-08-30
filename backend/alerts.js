// Alert lifecycle on top of the existing diagnostics faults - diagnostics.js
// stays the sole source of truth for what's wrong with a device; this module
// only decides which fault codes are worth an alert, and opens/resolves rows
// in the `alerts` table to match. All actual SQL lives in db.js.
const crypto = require('crypto');
const db = require('./db');
const diagnostics = require('./diagnostics');

// Deliberately excludes LOW_BATTERY (too noisy for a first version) and
// HEALTH_DATA_MISSING (informational, not actionable).
const ALERT_FAULT_CODES = new Set([
  'DEVICE_OWNER_LOST',
  'DEVICE_OFFLINE',
  'UPDATE_FAILED',
  'NEVER_CONTACTED',
  'SYNC_STALE',
  'LOW_STORAGE',
]);

/**
 * Reconciles the alerts table with one device's current diagnosis:
 * - a fault newly present (and alert-worthy) opens a new alert, unless one
 *   is already open for that exact deviceId+faultCode (createAlert no-ops
 *   via the DB's own unique index either way, so this is never a duplicate
 *   even under a race between overlapping calls for the same device);
 * - an alert whose fault is no longer present gets resolved_at set;
 * - a fault that reappears after its alert was resolved opens a fresh
 *   alert (history of the earlier one is never deleted or reused).
 *
 * Never throws in a way a caller must handle specially for it to be safe to
 * ignore - errors from db.js propagate normally, but this function's own
 * logic never leaves alerts half-updated in a way that would need a rollback
 * (each open/resolve is an independent statement).
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
 * Re-runs syncAlertsForDevice() across the whole fleet. This exists because
 * sync-triggered reconciliation alone can never catch DEVICE_OFFLINE or
 * NEVER_CONTACTED: by definition, a device in either state has stopped
 * syncing, so nothing ever re-invokes syncAlertsForDevice() for it again on
 * its own. Called when the admin loads the alerts panel so those two fault
 * codes still get surfaced - sync-time reconciliation stays the primary,
 * per-device-triggered path for every other fault code; this is the
 * necessary backstop for the two it structurally cannot reach, not a
 * replacement for it. Best-effort per device, like the /sync call site.
 */
async function reconcileAllDevices() {
  const devices = await db.listDeviceHealth();
  for (const device of devices) {
    try {
      await syncAlertsForDevice(device);
    } catch (e) {
      console.warn(`[alerts] reconcile failed for device ${device.deviceId}:`, e.message);
    }
  }
}

function listActiveAlerts() {
  return db.listActiveAlerts();
}

module.exports = { syncAlertsForDevice, reconcileAllDevices, listActiveAlerts };
