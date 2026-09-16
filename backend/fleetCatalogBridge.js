'use strict';

const CATALOG_SEED_MARKER = 'fleetCatalogSeededV1';

/**
 * Keeps the shared app catalog and per-device allowlists aligned without
 * changing the established per-device policy APIs.
 *
 * Semantics:
 * - A brand-new catalog app is approved for every currently enrolled device.
 * - A newly enrolled device starts with every app currently in the catalog.
 * - A device created during a transient/older backend deployment self-heals on
 *   its next authenticated lookup: an empty, never-seeded allowlist is filled
 *   once from the global catalog. A non-empty legacy allowlist is only marked
 *   seeded, so existing per-device choices are not broadened unexpectedly.
 * - Existing per-device removal remains possible afterwards; a durable marker
 *   inside policy prevents later lookups/syncs from re-adding removed apps.
 * - All later setPolicy calls preserve that internal marker even when callers
 *   normalize policy down to the public fields.
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
  const originalGetDevice = db.getDevice.bind(db);
  const originalSetPolicy = db.setPolicy.bind(db);

  // Policy writers elsewhere intentionally normalize to the public policy
  // shape. Keep the bridge's internal one-time marker from being dropped by
  // those writes, otherwise an intentionally emptied allowlist could later be
  // mistaken for an unseeded fresh device and get repopulated.
  db.setPolicy = async function setPolicyPreservingCatalogSeed(deviceId, policy) {
    const current = await originalGetDevice(deviceId);
    const currentPolicy = current && current.policy && typeof current.policy === 'object'
      ? current.policy
      : {};
    const nextPolicy = policy && typeof policy === 'object' ? { ...policy } : {};
    if (currentPolicy[CATALOG_SEED_MARKER] === true && nextPolicy[CATALOG_SEED_MARKER] !== true) {
      nextPolicy[CATALOG_SEED_MARKER] = true;
    }
    return originalSetPolicy(deviceId, nextPolicy);
  };

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

  async function seedDeviceOnce(device) {
    if (!device) return device;
    const current = device.policy && typeof device.policy === 'object' ? device.policy : {};
    if (current[CATALOG_SEED_MARKER] === true) return device;

    const allowed = Array.isArray(current.allowedApps) ? current.allowedApps : [];
    let merged = allowed;

    // Only an empty legacy/fresh allowlist is self-healed. A non-empty device
    // may have deliberate per-device removals from before this marker existed;
    // preserve those choices and simply mark migration complete.
    if (allowed.length === 0) {
      const catalog = await db.listAppsCatalog();
      const packages = [...new Set(catalog.map(app => app.packageName).filter(Boolean))];
      merged = [...new Set([...allowed, ...packages])];
    }

    const updated = await db.setPolicy(device.deviceId, {
      ...current,
      allowedApps: merged,
      [CATALOG_SEED_MARKER]: true,
    });

    logger.info?.(
      `[fleet-catalog] seeded device=${device.deviceId} apps=${merged.length} previous=${allowed.length}`,
    );
    return updated;
  }

  // requireDevice performs getDevice() before every device-facing sync. This
  // makes the repair happen before the same request builds the store response,
  // so a freshly enrolled device does not need a reboot/re-enrollment or an
  // extra manual sync just because its create-time seed was missed.
  db.getDevice = async function getDeviceWithCatalogSelfHeal(deviceId) {
    const device = await originalGetDevice(deviceId);
    return seedDeviceOnce(device);
  };

  db.createDevice = async function createDeviceWithGlobalCatalog(...args) {
    const device = await originalCreateDevice(...args);
    return seedDeviceOnce(device);
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

  return { approveForFleet, seedDeviceOnce, wakeFleet };
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
  CATALOG_SEED_MARKER,
  installFleetCatalogBridge,
  playMetadataChanged,
  apkReleaseChanged,
};
