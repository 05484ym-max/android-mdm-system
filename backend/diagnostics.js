// Read-only fault diagnosis for one device - no commands, no auto-fixes.
// Every condition here reuses healthPanel.js's own threshold constants and
// helper functions (never re-derives them), so this module can never
// disagree with healthPanel about whether a given condition applies to a
// device: if healthPanel classifies a device 'ok', diagnose() is guaranteed
// to return no faults for it, because every fault below is gated on exactly
// the same boolean condition healthPanel uses to leave status at 'ok'.
const {
  HOUR_MS,
  DEFAULT_WARNING_AFTER_MS,
  BATTERY_WARNING_MAX,
  FREE_STORAGE_WARNING_MAX_BYTES,
  LAST_SYNC_STALE_AFTER_MS,
  UNKNOWN_TO_CRITICAL_AFTER_MS,
  seenThresholds,
  hasAnyHealthData,
  updateFailureResolved,
} = require('./healthPanel');

/** Diagnoses one device-health row (the same shape db.listDeviceHealth()
 * returns) into an array of fault objects. Never mutates the device, never
 * queues a command, never talks to the network - pure function of its input
 * plus the current time. */
function diagnose(device, now = Date.now()) {
  if (!hasAnyHealthData(device)) {
    const registeredAt = device.registeredAt ? new Date(device.registeredAt).getTime() : null;
    if (registeredAt != null && now - registeredAt > UNKNOWN_TO_CRITICAL_AFTER_MS) {
      return [{
        code: 'NEVER_CONTACTED',
        severity: 'critical',
        title: 'המכשיר נרשם במערכת אך עדיין לא יצר קשר',
        description: 'המכשיר נרשם למערכת אך מעולם לא שלח דיווח בריאות, למרות שחלף זמן רב מאז ההרשמה.',
        likelyCause: 'ייתכן שהמכשיר לא הופעל, לא חובר לאינטרנט, לא הושלם תהליך ה-Provisioning, או שאפליקציית ה-MDM לא הותקנה/לא רצה בפועל.',
        recommendedAction: 'לבדוק פיזית שהמכשיר דולק, מחובר לרשת, ושתהליך רישום ה-MDM הושלם עד הסוף.',
        remoteFixAvailable: false,
        physicalAccessRequired: true,
        technicalDetails: { registeredAt: device.registeredAt },
      }];
    }
    return [{
      code: 'HEALTH_DATA_MISSING',
      severity: 'info',
      title: 'ממתין לנתוני בריאות ראשונים',
      description: 'המכשיר נרשם לאחרונה ועדיין לא ביצע סנכרון ראשון, כך שאין עדיין נתוני בריאות להציג.',
      likelyCause: 'זהו מצב צפוי מיד לאחר רישום מכשיר חדש - עוד לא עבר מספיק זמן לסנכרון הראשון.',
      recommendedAction: 'אין צורך בפעולה. אם המצב נמשך זמן רב, יש לבדוק שהמכשיר פעיל ומחובר לאינטרנט.',
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
      title: 'Device Owner אינו פעיל',
      description: 'המכשיר דיווח שהוא אינו רשום כ-Device Owner. ברוב יכולות הניהול (מדיניות, נעילת קיוסק, חסימת הסרת התקנה) תלויות בהרשאה הזו ואינן פעילות ללא Device Owner.',
      likelyCause: 'ה-Device Owner הוסר עקב איפוס להגדרות יצרן, שחזור גיבוי, או הסרה ידנית של הרשאות המנהל במכשיר.',
      recommendedAction: 'יש צורך בגישה פיזית למכשיר כדי לבצע מחדש את תהליך ה-Provisioning ולהגדיר את ה-Device Owner מחדש.',
      remoteFixAvailable: false,
      physicalAccessRequired: true,
      technicalDetails: { deviceOwnerLostAt: device.deviceOwnerLostAt },
    });
  }

  if (device.lastUpdateStatus === 'FAILED' && !updateFailureResolved(device)) {
    faults.push({
      code: 'UPDATE_FAILED',
      severity: 'critical',
      title: 'העדכון האחרון נכשל',
      description: 'ניסיון העדכון האחרון של אפליקציית ה-MDM במכשיר נכשל, והמכשיר עדיין לא עדכן בהצלחה לגרסה שנכשלה או לגרסה מאוחרת ממנה.',
      likelyCause: 'תקלת רשת בהורדת הקובץ, שטח אחסון לא מספיק בזמן ההתקנה, או חוסר התאמת חתימה/גרסה.',
      recommendedAction: 'כרגע אין פעולה אוטומטית זמינה. בעתיד ניתן יהיה לנסות עדכון מרחוק מכאן.',
      remoteFixAvailable: true,
      physicalAccessRequired: false,
      technicalDetails: {
        lastUpdateVersion: device.lastUpdateVersion,
        lastUpdateError: device.lastUpdateError,
        currentVersionCode: device.currentVersionCode,
      },
    });
  }

  const { warningAfterMs, criticalAfterMs } = seenThresholds(device.syncIntervalMinutes);
  const seenAge = device.lastSeenAt != null ? now - new Date(device.lastSeenAt).getTime() : null;

  if (seenAge != null && seenAge > criticalAfterMs) {
    faults.push({
      code: 'DEVICE_OFFLINE',
      severity: 'critical',
      title: 'המכשיר לא זמין',
      description: 'כבר זמן רב לא התקבל קשר מהמכשיר.',
      likelyCause: 'המכשיר כבוי, ללא חיבור לאינטרנט, או שאפליקציית ה-MDM הוסרה/הופסקה.',
      recommendedAction: 'לבדוק שהמכשיר דולק, מחובר לאינטרנט, ושאפליקציית ה-MDM עדיין פעילה במכשיר.',
      remoteFixAvailable: false,
      physicalAccessRequired: true,
      technicalDetails: { lastSeenAt: device.lastSeenAt, criticalAfterHours: Math.round(criticalAfterMs / HOUR_MS) },
    });
  }

  // Only meaningful when lastSeen is fresh - mirrors healthPanel's own gate
  // exactly, so a slow-interval device's normal behavior is never flagged here.
  if (seenAge != null && seenAge <= DEFAULT_WARNING_AFTER_MS) {
    const syncAge = device.lastSyncAt == null ? Infinity : now - new Date(device.lastSyncAt).getTime();
    if (syncAge > LAST_SYNC_STALE_AFTER_MS) {
      faults.push({
        code: 'SYNC_STALE',
        severity: 'warning',
        title: 'המכשיר מתקשר עם השרת אך לא משלים סנכרון',
        description: 'המכשיר מגיע לשרת באופן סדיר, אך הסנכרון המלא (מדיניות, קטלוג, פקודות) לא מסתיים בהצלחה.',
        likelyCause: 'תקלה זמנית באמצע תהליך הסנכרון, או ניתוק לפני שהתגובה המלאה התקבלה.',
        recommendedAction: 'ניתן יהיה בעתיד לנסות מכאן סנכרון מחדש. בינתיים מומלץ לעקוב אם המצב נמשך לאורך מספר מחזורי סנכרון.',
        remoteFixAvailable: true,
        physicalAccessRequired: false,
        technicalDetails: { lastSeenAt: device.lastSeenAt, lastSyncAt: device.lastSyncAt },
      });
    }
  }

  if (device.freeStorageBytes != null && device.freeStorageBytes < FREE_STORAGE_WARNING_MAX_BYTES) {
    faults.push({
      code: 'LOW_STORAGE',
      severity: 'warning',
      title: 'אין מספיק שטח פנוי במכשיר',
      description: 'שטח האחסון הפנוי במכשיר נמוך.',
      likelyCause: 'האפליקציות המותקנות, מטמון, או קבצים שנצברו במכשיר תופסים את רוב האחסון הזמין.',
      recommendedAction: 'לפנות מקום במכשיר (הסרת אפליקציות/קבצים מיותרים) לפני ניסיון עדכון נוסף.',
      remoteFixAvailable: false,
      physicalAccessRequired: true,
      technicalDetails: { freeStorageBytes: device.freeStorageBytes },
    });
  }

  if (device.batteryLevel != null && device.batteryLevel <= BATTERY_WARNING_MAX) {
    faults.push({
      code: 'LOW_BATTERY',
      severity: 'warning',
      title: 'הסוללה נמוכה',
      description: 'אחוז הסוללה במכשיר נמוך.',
      likelyCause: 'המכשיר לא היה מחובר לטעינה לאחרונה.',
      recommendedAction: 'לחבר את המכשיר לטעינה. אין צורך בדאגה נוספת - זו אינה תקלה מערכתית חמורה.',
      remoteFixAvailable: false,
      physicalAccessRequired: true,
      technicalDetails: { batteryLevel: device.batteryLevel },
    });
  }

  return faults;
}

module.exports = { diagnose };
