// Read-only diagnosis for one device. Every fault here must describe a real
// management problem and give the administrator a concrete next step.
const {
  HOUR_MS,
  DEFAULT_WARNING_AFTER_MS,
  LAST_SYNC_STALE_AFTER_MS,
  UNKNOWN_TO_CRITICAL_AFTER_MS,
  seenThresholds,
  hasAnyHealthData,
  updateFailureResolved,
} = require('./healthPanel');

function diagnose(device, now = Date.now()) {
  if (!hasAnyHealthData(device)) {
    const registeredAt = device.registeredAt ? new Date(device.registeredAt).getTime() : null;
    if (registeredAt != null && now - registeredAt > UNKNOWN_TO_CRITICAL_AFTER_MS) {
      return [{
        code: 'NEVER_CONTACTED',
        severity: 'critical',
        title: 'המכשיר לא התחבר למערכת',
        description: 'המכשיר נרשם, אבל עדיין לא התקבל ממנו סנכרון.',
        solution: 'במכשיר: ודא שיש אינטרנט, פתח את יהודי כשר ולחץ סנכרון. אם הוא עדיין לא מתחבר, בצע רישום מחדש.',
        remoteFixAvailable: false,
        physicalAccessRequired: true,
        technicalDetails: { registeredAt: device.registeredAt },
      }];
    }
    return [{
      code: 'HEALTH_DATA_MISSING',
      severity: 'info',
      title: 'ממתין לסנכרון ראשון',
      description: 'המכשיר נרשם לאחרונה ועדיין לא שלח נתונים.',
      solution: 'אין צורך לעשות דבר כרגע. אם המצב נשאר כך מעל יום, פתח את האפליקציה במכשיר ולחץ סנכרון.',
      remoteFixAvailable: false,
      physicalAccessRequired: false,
      technicalDetails: { registeredAt: device.registeredAt },
    }];
  }

  const faults = [];

  if (device.isDeviceOwner === false) {
    faults.push({
      code: 'DEVICE_OWNER_LOST',
      severity: 'critical',
      title: 'ניהול המכשיר אינו פעיל',
      description: 'Device Owner אינו פעיל ולכן ההגבלות המרכזיות אינן מובטחות.',
      solution: 'נדרש רישום מחדש של המכשיר כ-Device Owner. בפאנל ניתן ליצור קוד רישום חדש, ולאחר מכן לבצע Provisioning במכשיר.',
      remoteFixAvailable: false,
      physicalAccessRequired: true,
      technicalDetails: { deviceOwnerLostAt: device.deviceOwnerLostAt },
    });
  }

  if (device.lastUpdateStatus === 'FAILED' && !updateFailureResolved(device)) {
    faults.push({
      code: 'UPDATE_FAILED',
      severity: 'critical',
      title: 'עדכון האפליקציה נכשל',
      description: 'המכשיר ניסה להתעדכן ולא הצליח.',
      solution: 'לחץ "נסה עדכון מחדש". אם הוא נכשל שוב, בדוק את הודעת השגיאה במידע הטכני.',
      remoteFixAvailable: true,
      physicalAccessRequired: false,
      technicalDetails: {
        lastUpdateVersion: device.lastUpdateVersion,
        lastUpdateError: device.lastUpdateError,
        currentVersionCode: device.currentVersionCode,
        freeStorageBytes: device.freeStorageBytes,
      },
    });
  }

  const { criticalAfterMs } = seenThresholds(device.syncIntervalMinutes);
  const seenAge = device.lastSeenAt != null ? now - new Date(device.lastSeenAt).getTime() : null;

  if (seenAge != null && seenAge > criticalAfterMs) {
    faults.push({
      code: 'DEVICE_OFFLINE',
      severity: 'critical',
      title: 'המכשיר לא זמין',
      description: 'לא התקבל קשר מהמכשיר זמן רב.',
      solution: 'במכשיר: ודא שהוא דולק ומחובר לאינטרנט, פתח את יהודי כשר ולחץ סנכרון.',
      remoteFixAvailable: false,
      physicalAccessRequired: true,
      technicalDetails: { lastSeenAt: device.lastSeenAt, criticalAfterHours: Math.round(criticalAfterMs / HOUR_MS) },
    });
  }

  if (seenAge != null && seenAge <= DEFAULT_WARNING_AFTER_MS) {
    const syncAge = device.lastSyncAt == null ? Infinity : now - new Date(device.lastSyncAt).getTime();
    if (syncAge > LAST_SYNC_STALE_AFTER_MS) {
      faults.push({
        code: 'SYNC_STALE',
        severity: 'warning',
        title: 'הסנכרון תקוע',
        description: 'המכשיר מחובר לשרת, אבל הסנכרון המלא לא מסתיים.',
        solution: 'לחץ "נסה סנכרון מחדש" ואז רענן את האבחון.',
        remoteFixAvailable: true,
        physicalAccessRequired: false,
        technicalDetails: { lastSeenAt: device.lastSeenAt, lastSyncAt: device.lastSyncAt },
      });
    }
  }

  return faults;
}

module.exports = { diagnose };
