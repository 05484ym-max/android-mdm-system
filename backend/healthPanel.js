// Pure classification logic for the admin-panel "health dashboard" (no DB, no
// HTTP) - takes the flat rows from db.listDeviceHealth() and decides each
// device's overall status plus why. Kept separate so the thresholds/rules
// are one place, and testable without a server or database.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_WARNING_AFTER_MS = 3 * HOUR_MS;
const DEFAULT_CRITICAL_AFTER_MS = DAY_MS;
const BATTERY_WARNING_MAX = 20;
const FREE_STORAGE_WARNING_MAX_BYTES = 500 * 1024 * 1024;
const LAST_SYNC_STALE_AFTER_MS = 6 * HOUR_MS;
const UNKNOWN_TO_CRITICAL_AFTER_MS = DAY_MS;

const RANK = { ok: 0, warning: 1, critical: 2 };

/** last-seen thresholds scale with the device's own sync interval, so a
 * device configured for infrequent syncing isn't flagged for behaving
 * exactly as configured. Falls back to the fixed defaults when the policy
 * doesn't carry a usable interval. */
function seenThresholds(syncIntervalMinutes) {
  if (!Number.isFinite(syncIntervalMinutes) || syncIntervalMinutes <= 0) {
    return { warningAfterMs: DEFAULT_WARNING_AFTER_MS, criticalAfterMs: DEFAULT_CRITICAL_AFTER_MS };
  }
  const intervalMs = syncIntervalMinutes * 60 * 1000;
  return {
    warningAfterMs: Math.max(DEFAULT_WARNING_AFTER_MS, intervalMs * 3),
    criticalAfterMs: Math.max(DEFAULT_CRITICAL_AFTER_MS, intervalMs * 6),
  };
}

/** True once the device has reported anything through the new health
 * columns at least once. False for a freshly-registered device that hasn't
 * synced yet - that's "unknown", not "ok". */
function hasAnyHealthData(device) {
  return device.lastSeenAt != null ||
    device.currentVersionCode != null ||
    device.isDeviceOwner != null ||
    device.batteryLevel != null ||
    device.freeStorageBytes != null ||
    device.lastUpdateStatus != null;
}

/** A FAILED update stops being reported as critical once the device is
 * actually running the version that failed (or a newer one) - the failure
 * is history at that point, not an open problem. */
function updateFailureResolved(device) {
  return device.lastUpdateVersion != null &&
    device.currentVersionCode != null &&
    device.currentVersionCode >= device.lastUpdateVersion;
}

/**
 * Classifies one device-health row into { status, reasons, flags }.
 * status is one of 'unknown' | 'ok' | 'warning' | 'critical'.
 * reasons are human-readable (Hebrew) strings for display.
 * flags are booleans a caller (e.g. summarize()) can count on without
 * re-parsing the reason text.
 */
function classify(device, now = Date.now()) {
  const flags = {
    neverContacted: false,
    deviceOwnerLost: false,
    updateFailed: false,
    staleLastSeen: false,
    staleSync: false,
    lowBattery: false,
    lowStorage: false,
  };

  if (!hasAnyHealthData(device)) {
    const registeredAt = device.registeredAt ? new Date(device.registeredAt).getTime() : null;
    if (registeredAt != null && now - registeredAt > UNKNOWN_TO_CRITICAL_AFTER_MS) {
      flags.neverContacted = true;
      flags.staleLastSeen = true;
      return {
        status: 'critical',
        reasons: ['המכשיר נרשם אך עדיין לא יצר קשר עם השרת'],
        flags,
      };
    }
    return { status: 'unknown', reasons: ['ממתין לנתונים ראשונים מהמכשיר'], flags };
  }

  const reasons = [];
  let status = 'ok';
  const bump = (level, reason) => {
    reasons.push(reason);
    if (RANK[level] > RANK[status]) status = level;
  };

  if (device.isDeviceOwner === false) {
    flags.deviceOwnerLost = true;
    bump('critical', 'המכשיר אינו רשום כ-Device Owner');
  }

  if (device.lastUpdateStatus === 'FAILED' && !updateFailureResolved(device)) {
    flags.updateFailed = true;
    bump('critical', 'עדכון הגרסה האחרון נכשל');
  }

  const { warningAfterMs, criticalAfterMs } = seenThresholds(device.syncIntervalMinutes);
  let seenAge = null;
  if (device.lastSeenAt == null) {
    flags.staleLastSeen = true;
    bump('warning', 'לא התקבל דיווח זמינות מהמכשיר');
  } else {
    seenAge = now - new Date(device.lastSeenAt).getTime();
    if (seenAge > criticalAfterMs) {
      flags.staleLastSeen = true;
      bump('critical', `המכשיר לא נראה מעל ${Math.round(criticalAfterMs / HOUR_MS)} שעות`);
    } else if (seenAge > warningAfterMs) {
      flags.staleLastSeen = true;
      bump('warning', `המכשיר לא נראה מעל ${Math.round(warningAfterMs / HOUR_MS)} שעות`);
    }
  }

  // Only meaningful when the device is otherwise checking in fine. This gate
  // is intentionally the fixed default (not the interval-scaled
  // warningAfterMs above) - a slow-interval device stretching "fresh" out
  // for hours would make the fixed 6h stale-sync threshold below fire on
  // completely normal behavior. If lastSeenAt is itself stale, the rule
  // above already covers it.
  if (seenAge != null && seenAge <= DEFAULT_WARNING_AFTER_MS) {
    const syncAge = device.lastSyncAt == null ? Infinity : now - new Date(device.lastSyncAt).getTime();
    if (syncAge > LAST_SYNC_STALE_AFTER_MS) {
      flags.staleSync = true;
      bump('warning', 'המכשיר מתקשר עם השרת אך לא משלים סנכרון מלא');
    }
  }

  if (device.batteryLevel != null && device.batteryLevel <= BATTERY_WARNING_MAX) {
    flags.lowBattery = true;
    bump('warning', `סוללה נמוכה (${device.batteryLevel}%)`);
  }

  if (device.freeStorageBytes != null && device.freeStorageBytes < FREE_STORAGE_WARNING_MAX_BYTES) {
    flags.lowStorage = true;
    bump('warning', 'שטח אחסון פנוי נמוך');
  }

  return { status, reasons, flags };
}

/** Aggregate counts for the dashboard's summary row. outdatedVersion is
 * intentionally always null - version-outdated classification is deferred
 * until app_releases/staged rollout exists, so a TEST device on a newer
 * build doesn't make the rest of the fleet look stale. */
function summarize(classifiedDevices) {
  const summary = {
    total: classifiedDevices.length,
    ok: 0,
    warning: 0,
    critical: 0,
    unknown: 0,
    staleLastSeen: 0,
    updateFailed: 0,
    outdatedVersion: null,
  };
  for (const { status, flags } of classifiedDevices) {
    summary[status] = (summary[status] || 0) + 1;
    if (flags.staleLastSeen) summary.staleLastSeen++;
    if (flags.updateFailed) summary.updateFailed++;
  }
  return summary;
}

module.exports = {
  classify,
  summarize,
  // Exported so diagnostics.js can reuse the exact same rules/thresholds
  // instead of re-implementing them - the two modules must never disagree
  // about whether a given condition applies to a device.
  HOUR_MS,
  DEFAULT_WARNING_AFTER_MS,
  BATTERY_WARNING_MAX,
  FREE_STORAGE_WARNING_MAX_BYTES,
  LAST_SYNC_STALE_AFTER_MS,
  UNKNOWN_TO_CRITICAL_AFTER_MS,
  seenThresholds,
  hasAnyHealthData,
  updateFailureResolved,
};
