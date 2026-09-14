// Pure classification logic for the admin-panel health dashboard.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_WARNING_AFTER_MS = 3 * HOUR_MS;
const DEFAULT_CRITICAL_AFTER_MS = DAY_MS;
const LAST_SYNC_STALE_AFTER_MS = 6 * HOUR_MS;
const UNKNOWN_TO_CRITICAL_AFTER_MS = DAY_MS;

const RANK = { ok: 0, warning: 1, critical: 2 };

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

function hasAnyHealthData(device) {
  return device.lastSeenAt != null ||
    device.currentVersionCode != null ||
    device.isDeviceOwner != null ||
    device.lastUpdateStatus != null;
}

function updateFailureResolved(device) {
  return device.lastUpdateVersion != null &&
    device.currentVersionCode != null &&
    device.currentVersionCode >= device.lastUpdateVersion;
}

/**
 * Only conditions that represent a real management problem are promoted to
 * warning/critical here. Battery and storage remain visible as device facts
 * in the panel, but are intentionally not faults by themselves.
 */
function classify(device, now = Date.now()) {
  const flags = {
    neverContacted: false,
    deviceOwnerLost: false,
    updateFailed: false,
    staleLastSeen: false,
    staleSync: false,
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
    return { status: 'unknown', reasons: ['ממתין לסנכרון ראשון מהמכשיר'], flags };
  }

  const reasons = [];
  let status = 'ok';
  const bump = (level, reason) => {
    reasons.push(reason);
    if (RANK[level] > RANK[status]) status = level;
  };

  if (device.isDeviceOwner === false) {
    flags.deviceOwnerLost = true;
    bump('critical', 'ניהול Device Owner אינו פעיל');
  }

  if (device.lastUpdateStatus === 'FAILED' && !updateFailureResolved(device)) {
    flags.updateFailed = true;
    bump('critical', 'העדכון האחרון נכשל');
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

  if (seenAge != null && seenAge <= DEFAULT_WARNING_AFTER_MS) {
    const syncAge = device.lastSyncAt == null ? Infinity : now - new Date(device.lastSyncAt).getTime();
    if (syncAge > LAST_SYNC_STALE_AFTER_MS) {
      flags.staleSync = true;
      bump('warning', 'המכשיר מחובר אך הסנכרון לא הושלם');
    }
  }

  return { status, reasons, flags };
}

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
  HOUR_MS,
  DEFAULT_WARNING_AFTER_MS,
  LAST_SYNC_STALE_AFTER_MS,
  UNKNOWN_TO_CRITICAL_AFTER_MS,
  seenThresholds,
  hasAnyHealthData,
  updateFailureResolved,
};
