'use strict';

/**
 * Keeps the shared app catalog and per-device allowlists aligned without
 * changing the established per-device policy APIs.
 *
 * Semantics:
 * - A brand-new catalog app is approved for every currently enrolled device.
 * - A newly enrolled device starts with every app currently in the catalog.
 * - Existing per-device removal remains possible afterwards; we do not
 *   continuously re-add a package on every sync.
 * - When cached Play metadata or an uploaded APK release changes, devices are
 *   woken so the store can refresh update status quickly, but policy is not
 *   rewritten unless the package is newly global.
 * - Global removal remains owned by deleteAppFromCatalogAtomic in index/db,
 *   which already strips the package from every device in one transaction.
 */
function installFleetCatalogBridge(db, push, logger = console) {
  if (!db || typeof db.listDevices !== 'function' || typeof db.listAppsCatalog !== 'function' ||
      typeof db.setPolicy !== 'function' || typeof db.getDevice !== 'function') {
    throw new Error('fleet catalog bridge requires device/catalog DB functions');
  }
  if (!push || typeof push.wake !== 'function') {
    throw new Error('fleet catalog bridge requires push.wake');
  }

  const originalAddAppToCatalog = db.addAppToCatalog.bind(db);
  const originalInsertUploadedApp = db.insertUploadedApp.bind(db);
  const originalCreateDevice = db.createDevice.bind(db);

  async function wakeDevice(deviceId) {
    const full = await db.getDevice(deviceId);
    const result = await push.wake(full ? full.pushToken : null);
    if (!result.sent && result.reason !== 'no_push_token') {
      logger.warn?.(`[fleet-catalog] wake failed device=${deviceId} reason=${result.reason}`);
    }
    return result;
  }

  async function wakeFleet() {
    const devices = await db.listDevices();
    let sent = 0;
    for (const device of devices) {
      const result = await wakeDevice(device.deviceId);
      if (result.sent) sent += 1;
    }
    return { devices: devices.length, sent };
  }

  async function approveForFleet(packageName) {
    const devices = await db.listDevices();
    let policiesChanged = 0;
    let wakesSent = 0;

    for (const device of devices) {
      const current = device.policy && typeof device.policy === 'object' ? device.policy : {};
      const allowed = Array.isArray(current.allowedApps) ? current.allowedApps : [];
      if (!allowed.includes(packageName)) {
        const policy = { ...current, allowedApps: [...allowed, packageName] };
        await db.setPolicy(device.deviceId, policy);
        policiesChanged += 1;
      }
      const result = await wakeDevice(device.deviceId);
      if (result.sent) wakesSent += 1;
    }

    logger.info?.(
      `[fleet-catalog] approved ${packageName} for fleet devices=${devices.length} changed=${policiesChanged} wakes=${wakesSent}`,
    );
    return { devices: devices.length, policiesChanged, wakesSent };
  }

  async function seedNewDevice(device) {
    const catalog = await db.listAppsCatalog();
    const packages = [...new Set(catalog.map(app => app.packageName).filter(Boolean))];
    if (packages.length === 0) return device;

    const current = device.policy && typeof device.policy === 'object' ? device.policy : {};
    const allowed = Array.isArray(current.allowedApps) ? current.allowedApps : [];
    const merged = [...new Set([...allowed, ...packages])];
    if (merged.length === allowed.length && merged.every((value, i) => value === allowed[i])) return device;

    return db.setPolicy(device.deviceId, { ...current, allowedApps: merged });
  }

  db.createDevice = async function createDeviceWithGlobalCatalog(...args) {
    const device = await originalCreateDevice(...args);
    return seedNewDevice(device);
  };

  db.addAppToCatalog = async function addAppToCatalogGlobally(packageName, ...args) {
    const before = (await db.listAppsCatalog()).find(app => app.packageName === packageName) || null;
    const result = await originalAddAppToCatalog(packageName, ...args);
    const after = (await db.listAppsCatalog()).find(app => app.packageName === packageName) || null;

    if (!before && after) {
      await approveForFleet(packageName);
    } else if (before && after && playMetadataChanged(before, after)) {
      await wakeFleet();
    }
    return result;
  };

  db.insertUploadedApp = async function insertUploadedAppGlobally(payload) {
    const packageName = payload && payload.packageName;
    const before = packageName
      ? (await db.listAppsCatalog()).find(app => app.packageName === packageName) || null
      : null;
    const result = await originalInsertUploadedApp(payload);
    const after = packageName
      ? (await db.listAppsCatalog()).find(app => app.packageName === packageName) || null
      : null;

    if (!before && after) {
      await approveForFleet(packageName);
    } else if (before && after && apkReleaseChanged(before, after)) {
      await wakeFleet();
    }
    return result;
  };

  return { approveForFleet, seedNewDevice, wakeFleet };
}

function playMetadataChanged(before, after) {
  return String(before.playVersion || '') !== String(after.playVersion || '') ||
    Number(before.playUpdatedAt || 0) !== Number(after.playUpdatedAt || 0);
}

function apkReleaseChanged(before, after) {
  return String(before.apkSha256 || '') !== String(after.apkSha256 || '') ||
    String(before.apkUrl || '') !== String(after.apkUrl || '');
}

module.exports = {
  installFleetCatalogBridge,
  playMetadataChanged,
  apkReleaseChanged,
};
