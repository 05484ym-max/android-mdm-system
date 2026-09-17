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

const MB = 1024 * 1024;
const STORAGE_WARNING_BYTES = 500 * MB;
const STORAGE_CRITICAL_BYTES = 200 * MB;

function fault(code, severity, title, description, solution, opts = {}) {
  return {
    code,
    severity,
    title,
    description,
    solution,
    remoteFixAvailable: Boolean(opts.remoteFixAvailable),
    physicalAccessRequired: Boolean(opts.physicalAccessRequired),
    technicalDetails: opts.technicalDetails || undefined,
  };
}

function diagnose(device, now = Date.now()) {
  if (!hasAnyHealthData(device)) {
    const registeredAt = device.registeredAt ? new Date(device.registeredAt).getTime() : null;
    if (registeredAt != null && now - registeredAt > UNKNOWN_TO_CRITICAL_AFTER_MS) {
      return [fault(
        'NEVER_CONTACTED',
        'critical',
        'המכשיר לא התחבר למערכת',
        'המכשיר נרשם, אבל עדיין לא התקבל ממנו סנכרון.',
        'בדוק שהמכשיר דולק ומחובר לאינטרנט. פתח את יהודי כשר ולחץ סנכרון. אם אין שינוי, בצע רישום מחדש.',
        { physicalAccessRequired: true, technicalDetails: { registeredAt: device.registeredAt } },
      )];
    }
    return [fault(
      'HEALTH_DATA_MISSING',
      'info',
      'ממתין לסנכרון ראשון',
      'המכשיר נרשם לאחרונה ועדיין לא שלח מספיק נתונים לבדיקה.',
      'כרגע אין צורך לעשות דבר. אם זה נשאר כך מעל יום, פתח את האפליקציה במכשיר ולחץ סנכרון.',
      { technicalDetails: { registeredAt: device.registeredAt } },
    )];
  }

  const faults = [];

  if (device.isDeviceOwner === false) {
    faults.push(fault(
      'DEVICE_OWNER_LOST',
      'critical',
      'ניהול המכשיר אינו פעיל',
      'המערכת מזהה שהמכשיר כבר אינו מנוהל כ-Device Owner, ולכן חסימות מרכזיות אינן מובטחות.',
      'צריך לרשום את המכשיר מחדש כ-Device Owner. צור קוד רישום חדש בפאנל ובצע Provisioning במכשיר.',
      { physicalAccessRequired: true, technicalDetails: { deviceOwnerLostAt: device.deviceOwnerLostAt } },
    ));
  }

  if (device.lastUpdateStatus === 'FAILED' && !updateFailureResolved(device)) {
    const lowSpace = Number.isFinite(device.freeStorageBytes) && device.freeStorageBytes < STORAGE_WARNING_BYTES;
    faults.push(fault(
      'UPDATE_FAILED',
      'critical',
      'עדכון יהודי כשר נכשל',
      lowSpace ? 'העדכון נכשל ולמכשיר גם נשאר מעט מקום פנוי.' : 'המכשיר ניסה לעדכן את יהודי כשר ולא הצליח.',
      lowSpace
        ? 'פנה מקום במכשיר ואז לחץ "נסה עדכון מחדש". אם שוב נכשל, פתח את המידע הטכני כדי לראות את סיבת הכשל.'
        : 'לחץ "נסה עדכון מחדש". אם שוב נכשל, פתח את המידע הטכני כדי לראות את סיבת הכשל.',
      {
        remoteFixAvailable: true,
        technicalDetails: {
          lastUpdateVersion: device.lastUpdateVersion,
          lastUpdateError: device.lastUpdateError,
          currentVersionCode: device.currentVersionCode,
          freeStorageBytes: device.freeStorageBytes,
        },
      },
    ));
  }

  if (Number.isFinite(device.freeStorageBytes) && device.freeStorageBytes < STORAGE_WARNING_BYTES) {
    const critical = device.freeStorageBytes < STORAGE_CRITICAL_BYTES;
    faults.push(fault(
      'LOW_STORAGE',
      critical ? 'critical' : 'warning',
      critical ? 'כמעט אין מקום פנוי במכשיר' : 'המקום הפנוי במכשיר נמוך',
      critical
        ? 'נשאר פחות מכ-200MB. עדכונים והתקנות עלולים להיכשל.'
        : 'נשאר פחות מכ-500MB. כדאי לפנות מקום לפני התקנות ועדכונים.',
      'מחק קבצים או אפליקציות שאינן נחוצות ופנה מקום. לאחר מכן לחץ סנכרון ורענן את האבחון.',
      { physicalAccessRequired: true, technicalDetails: { freeStorageBytes: device.freeStorageBytes } },
    ));
  }

  const { criticalAfterMs } = seenThresholds(device.syncIntervalMinutes);
  const seenAge = device.lastSeenAt != null ? now - new Date(device.lastSeenAt).getTime() : null;

  if (seenAge != null && seenAge > criticalAfterMs) {
    faults.push(fault(
      'DEVICE_OFFLINE',
      'critical',
      'המכשיר לא זמין',
      'לא התקבל קשר מהמכשיר זמן רב, ולכן אי אפשר לדעת אם פקודות והגבלות חדשות הגיעו אליו.',
      'בדוק שהמכשיר דולק ומחובר לאינטרנט. פתח את יהודי כשר ולחץ סנכרון.',
      {
        physicalAccessRequired: true,
        technicalDetails: { lastSeenAt: device.lastSeenAt, criticalAfterHours: Math.round(criticalAfterMs / HOUR_MS) },
      },
    ));
  }

  if (seenAge != null && seenAge <= DEFAULT_WARNING_AFTER_MS) {
    const syncAge = device.lastSyncAt == null ? Infinity : now - new Date(device.lastSyncAt).getTime();
    if (syncAge > LAST_SYNC_STALE_AFTER_MS) {
      faults.push(fault(
        'SYNC_STALE',
        'warning',
        'הסנכרון תקוע',
        'המכשיר כן מדבר עם השרת, אבל הסנכרון המלא לא מסתיים.',
        'לחץ "נסה סנכרון מחדש". אם התקלה חוזרת, בדוק את החיבור ואת האפליקציה במכשיר.',
        { remoteFixAvailable: true, technicalDetails: { lastSeenAt: device.lastSeenAt, lastSyncAt: device.lastSyncAt } },
      ));
    }
  }

  const dnsRequested = device.dnsFilteringRequested;
  const dnsActual = device.dnsFilteringActual;
  const networkConnected = device.currentNetworkType == null || device.currentNetworkType !== 'NONE';

  if (dnsRequested != null && dnsActual != null && Boolean(dnsRequested) !== Boolean(dnsActual)) {
    faults.push(fault(
      'DNS_FILTER_MISMATCH',
      'warning',
      'סינון האינטרנט לא במצב שביקשת',
      dnsRequested
        ? 'בפאנל הסינון אמור להיות פעיל, אבל המכשיר מדווח שהוא לא פעיל בפועל.'
        : 'בפאנל הסינון אמור להיות כבוי, אבל המכשיר עדיין מדווח שהוא פעיל.',
      'שלח שוב את פעולת ההפעלה/כיבוי ולחץ סנכרון. אם המצב לא משתנה, פתח אבחון במכשיר.',
      {
        remoteFixAvailable: true,
        technicalDetails: { dnsFilteringRequested: dnsRequested, dnsFilteringActual: dnsActual, dnsMode: device.dnsMode },
      },
    ));
  }

  if (networkConnected && device.dnsResolutionOk === false) {
    faults.push(fault(
      'DNS_RESOLUTION_FAILED',
      'critical',
      'האינטרנט לא מצליח לפתור כתובות',
      'המכשיר מחובר לרשת, אבל בדיקת ה-DNS נכשלה. גלישה עלולה לא לעבוד.',
      'נסה סנכרון ורענון סטטוס. אם זה נשאר כך, בדוק אינטרנט במכשיר. במקרה הצורך כבה זמנית את הסינון והפעל מחדש לאחר שהחיבור חוזר.',
      {
        remoteFixAvailable: true,
        technicalDetails: {
          dnsMode: device.dnsMode,
          currentNetworkType: device.currentNetworkType,
          consecutiveDnsFailures: device.consecutiveDnsFailures,
          failureReason: device.failureReason,
        },
      },
    ));
  }

  if (dnsRequested === true && device.dotProviderReachable === false) {
    faults.push(fault(
      'DNS_PROVIDER_UNREACHABLE',
      'warning',
      'שרת הסינון לא זמין מהמכשיר',
      'המכשיר לא מצליח להגיע כרגע לספק ה-DNS המסונן.',
      'נסה שוב בעוד רגע ורענן סטטוס. אם התקלה נמשכת, בדוק חיבור אינטרנט או מעבר בין Wi-Fi לסלולר.',
      {
        physicalAccessRequired: true,
        technicalDetails: { dnsActualProviderHost: device.dnsActualProviderHost, currentNetworkType: device.currentNetworkType },
      },
    ));
  }

  if (device.dnsFailSafeState && device.dnsFailSafeState !== 'NORMAL') {
    const rolledBack = device.dnsFailSafeState === 'ROLLED_BACK';
    const recovering = device.dnsFailSafeState === 'RECOVERING';
    faults.push(fault(
      'DNS_FAILSAFE_ACTIVE',
      rolledBack ? 'critical' : 'warning',
      rolledBack ? 'המערכת נסוגה מסינון כדי לשמור על אינטרנט' : (recovering ? 'סינון האינטרנט מתאושש' : 'סינון האינטרנט במצב מוגן'),
      rolledBack
        ? 'המערכת זיהתה בעיית DNS וביצעה rollback אוטומטי כדי לא להשאיר את המכשיר בלי אינטרנט.'
        : 'המערכת זיהתה תקלה זמנית ב-DNS ומפעילה מנגנון הגנה/התאוששות.',
      rolledBack
        ? 'בדוק שהאינטרנט עובד. לאחר שהחיבור יציב, הפעל שוב את הסינון ורענן סטטוס.'
        : 'אין צורך לשנות מיד. רענן בעוד כמה דקות; אם המצב לא חוזר ל"תקין", בדוק אינטרנט במכשיר.',
      {
        remoteFixAvailable: rolledBack,
        technicalDetails: {
          dnsFailSafeState: device.dnsFailSafeState,
          previousDnsMode: device.previousDnsMode,
          lastRollbackAt: device.lastRollbackAt,
          failureReason: device.failureReason,
        },
      },
    ));
  }

  return faults;
}

module.exports = { diagnose };
