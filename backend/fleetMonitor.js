const diagnostics = require('./diagnostics');

const DEFAULT_MONITOR_INTERVAL_MS = 60 * 1000;
const AUTO_HEAL_COOLDOWN_MS = 30 * 60 * 1000;
const SAFE_AUTO_HEAL_CODES = new Set(['SYNC_STALE', 'DNS_CONFIG_MISMATCH', 'DNS_RECOVERING']);

function nonEmpty(value, fallback = 'לא ידוע') {
  return value == null || value === '' ? fallback : String(value);
}

function dimensionKey(device, dimension) {
  switch (dimension) {
    case 'version': return nonEmpty(device.currentVersionCode);
    case 'android': return nonEmpty(device.androidVersion);
    case 'manufacturer': return nonEmpty(device.manufacturer);
    case 'model': return nonEmpty(device.model);
    default: return 'לא ידוע';
  }
}

function groupCounts(devices, dimension) {
  const out = new Map();
  for (const device of devices) {
    const key = dimensionKey(device, dimension);
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

function concentration(affected, all, dimension) {
  const affectedCounts = groupCounts(affected, dimension);
  const fleetCounts = groupCounts(all, dimension);
  let best = null;
  for (const [key, count] of affectedCounts.entries()) {
    const total = fleetCounts.get(key) || count;
    const ratio = total > 0 ? count / total : 0;
    const candidate = { key, affected: count, total, ratio };
    if (!best || candidate.ratio > best.ratio ||
        (candidate.ratio === best.ratio && candidate.affected > best.affected)) best = candidate;
  }
  return best;
}

function classifyScope(faultCode, affected, all) {
  const total = all.length;
  const count = affected.length;
  const ratio = total > 0 ? count / total : 0;
  const byVersion = concentration(affected, all, 'version');
  const byAndroid = concentration(affected, all, 'android');
  const byManufacturer = concentration(affected, all, 'manufacturer');
  const byModel = concentration(affected, all, 'model');

  // A fleet-wide classification intentionally requires both an absolute and
  // relative threshold so a tiny lab fleet cannot look like a production outage.
  if ((count >= 10 && ratio >= 0.20) || (count >= 25 && ratio >= 0.10)) {
    return {
      scope: 'FLEET',
      label: 'תקלה כללית במערכת',
      confidence: ratio >= 0.40 ? 'HIGH' : 'MEDIUM',
      reason: `${count} מתוך ${total} מכשירים מציגים את אותה תקלה`,
      affectedCount: count,
      fleetCount: total,
      affectedPercent: Math.round(ratio * 100),
      correlations: { version: byVersion, android: byAndroid, manufacturer: byManufacturer, model: byModel },
    };
  }

  const dimensions = [
    ['גרסת אפליקציה', byVersion],
    ['גרסת Android', byAndroid],
    ['יצרן', byManufacturer],
    ['דגם', byModel],
  ];
  const cluster = dimensions
    .filter(([, item]) => item && item.affected >= 3 && item.total >= 3 && item.ratio >= 0.60)
    .sort((a, b) => (b[1].ratio - a[1].ratio) || (b[1].affected - a[1].affected))[0];

  if (cluster) {
    const [name, item] = cluster;
    return {
      scope: 'CLUSTER',
      label: `תקלה בקבוצה מסוימת`,
      confidence: item.ratio >= 0.80 ? 'HIGH' : 'MEDIUM',
      reason: `${item.affected} מתוך ${item.total} מכשירים עם ${name} ${item.key} מציגים את התקלה`,
      affectedCount: count,
      fleetCount: total,
      affectedPercent: Math.round(ratio * 100),
      correlations: { version: byVersion, android: byAndroid, manufacturer: byManufacturer, model: byModel },
    };
  }

  if (count === 1) {
    return {
      scope: 'DEVICE',
      label: 'תקלה במכשיר בודד',
      confidence: total >= 10 ? 'HIGH' : 'MEDIUM',
      reason: total > 1 ? `רק מכשיר אחד מתוך ${total} מציג את התקלה` : 'יש כרגע רק מכשיר אחד להשוואה',
      affectedCount: 1,
      fleetCount: total,
      affectedPercent: total ? Math.round(100 / total) : 100,
      correlations: { version: byVersion, android: byAndroid, manufacturer: byManufacturer, model: byModel },
    };
  }

  return {
    scope: 'LIMITED',
    label: 'תקלה מוגבלת למספר מכשירים',
    confidence: total >= 10 ? 'MEDIUM' : 'LOW',
    reason: `${count} מתוך ${total} מכשירים מציגים את התקלה, ללא דפוס מספיק חזק כרגע`,
    affectedCount: count,
    fleetCount: total,
    affectedPercent: Math.round(ratio * 100),
    correlations: { version: byVersion, android: byAndroid, manufacturer: byManufacturer, model: byModel },
  };
}

function analyzeFleet(devices, now = Date.now()) {
  const active = Array.isArray(devices) ? devices.filter(Boolean) : [];
  const byCode = new Map();
  const faultsByDevice = new Map();
  for (const device of active) {
    const faults = diagnostics.diagnose(device, now).filter(f => f.severity !== 'info');
    faultsByDevice.set(device.deviceId, faults);
    for (const fault of faults) {
      if (!byCode.has(fault.code)) byCode.set(fault.code, { fault, devices: [] });
      byCode.get(fault.code).devices.push(device);
    }
  }

  const incidents = [];
  for (const [faultCode, entry] of byCode.entries()) {
    const scope = classifyScope(faultCode, entry.devices, active);
    incidents.push({
      faultCode,
      title: entry.fault.title,
      severity: entry.fault.severity,
      ...scope,
      deviceIds: entry.devices.map(d => d.deviceId),
      firstDetectedAt: now,
      autoHealAllowed: SAFE_AUTO_HEAL_CODES.has(faultCode) && scope.scope !== 'FLEET' && scope.scope !== 'CLUSTER',
    });
  }

  incidents.sort((a, b) => {
    const rank = { critical: 2, warning: 1, info: 0 };
    return (rank[b.severity] || 0) - (rank[a.severity] || 0) || b.affectedCount - a.affectedCount;
  });

  return { generatedAt: now, fleetCount: active.length, incidents, faultsByDevice };
}

function createFleetMonitor({ db, push, logger = console, intervalMs = DEFAULT_MONITOR_INTERVAL_MS }) {
  const lastHeal = new Map();
  let running = false;
  let timer = null;
  let snapshot = { generatedAt: 0, fleetCount: 0, incidents: [], faultsByDevice: new Map() };

  async function runOnce() {
    if (running) return snapshot;
    running = true;
    try {
      const devices = await db.listDeviceHealth();
      snapshot = analyzeFleet(devices);
      for (const incident of snapshot.incidents) {
        if (!incident.autoHealAllowed) continue;
        for (const deviceId of incident.deviceIds) {
          const key = `${deviceId}:${incident.faultCode}`;
          const previous = lastHeal.get(key) || 0;
          if (Date.now() - previous < AUTO_HEAL_COOLDOWN_MS) continue;
          lastHeal.set(key, Date.now());
          try {
            const device = await db.getDevice(deviceId);
            const result = await push.wake(device ? device.pushToken : null);
            logger.log(`[fleet-auto-heal] fault=${incident.faultCode} device=${deviceId} result=${result.sent ? 'sent' : result.reason}`);
          } catch (error) {
            logger.warn(`[fleet-auto-heal] fault=${incident.faultCode} device=${deviceId} failed: ${error.message}`);
          }
        }
      }
      return snapshot;
    } catch (error) {
      logger.error('[fleet-monitor] scan failed:', error.message);
      return snapshot;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    runOnce();
    timer = setInterval(runOnce, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function getSnapshot() {
    return {
      generatedAt: snapshot.generatedAt,
      fleetCount: snapshot.fleetCount,
      incidents: snapshot.incidents,
    };
  }

  return { start, runOnce, getSnapshot };
}

module.exports = {
  DEFAULT_MONITOR_INTERVAL_MS,
  AUTO_HEAL_COOLDOWN_MS,
  SAFE_AUTO_HEAL_CODES,
  analyzeFleet,
  classifyScope,
  createFleetMonitor,
};
