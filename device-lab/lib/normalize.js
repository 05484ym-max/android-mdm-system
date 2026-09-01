const crypto = require('crypto');

const clean = value => value == null ? null : String(value).trim() || null;
const lower = value => clean(value)?.toLowerCase() || null;
const intOrNull = value => {
  const cleaned = clean(value);
  if (cleaned == null) return null;
  const n = Number(cleaned);
  return Number.isInteger(n) ? n : null;
};

function normalizeScan(raw = {}) {
  const p = raw.properties || {};
  const usb = raw.usb || {};
  const fastboot = raw.fastboot || {};
  const normalized = {
    manufacturer: clean(p.manufacturer), brand: clean(p.brand), model: clean(p.model),
    product: clean(p.product), device: clean(p.device), board: clean(p.board),
    hardware: clean(p.hardware), platform: clean(p.platform), cpuAbi: clean(p.cpuAbi),
    androidVersion: clean(p.androidVersion),
    apiLevel: intOrNull(p.apiLevel),
    buildFingerprint: clean(p.buildFingerprint), buildId: clean(p.buildId),
    buildIncremental: clean(p.buildIncremental), securityPatch: clean(p.securityPatch),
    bootloader: clean(p.bootloader), verifiedBootState: clean(p.verifiedBootState),
    flashLocked: clean(p.flashLocked), slotSuffix: clean(p.slotSuffix),
    dynamicPartitions: clean(p.dynamicPartitions), setupWizardPackage: clean(raw.setupWizardPackage),
    deviceOwner: clean(raw.deviceOwner), provisioningAllowed:
      raw.provisioningAllowed === true ? true : raw.provisioningAllowed === false ? false : null,
    adbSerial: clean(raw.adbSerial), adbState: clean(raw.adbState),
    fastbootProduct: clean(fastboot.product), fastbootUnlocked: clean(fastboot.unlocked),
    fastbootSecure: clean(fastboot.secure), fastbootCurrentSlot: clean(fastboot.currentSlot),
    usbVid: clean(usb.vid), usbPid: clean(usb.pid), usbMode: clean(usb.mode),
    hostType: clean(raw.hostType)
  };
  const familyMaterial = familyFingerprintMaterial(normalized);
  const exactMaterial = normalized.buildFingerprint
    ? [familyMaterial,lower(normalized.buildFingerprint),lower(normalized.bootloader),
        lower(normalized.product)].filter(Boolean).join('|')
    : null;
  normalized.familyFingerprint = familyMaterial ? crypto.createHash('sha256').update(familyMaterial).digest('hex') : null;
  // "Exact" means exact ROM/build identity. Never manufacture an exact
  // fingerprint from hardware-only evidence when buildFingerprint is absent.
  normalized.exactFingerprint = exactMaterial ? crypto.createHash('sha256').update(exactMaterial).digest('hex') : null;
  return normalized;
}

// device/board/hardware/platform identify the hardware family itself; fastbootProduct is
// connection-modal (only present while the device happens to be in fastboot mode at scan
// time) and must be excluded here, or the same physical hardware can hash to a different
// family fingerprint across scans depending on which mode it was scanned in.
function familyFingerprintMaterial(fields) {
  return [lower(fields.device),lower(fields.board),lower(fields.hardware),lower(fields.platform)]
    .filter(Boolean).join('|');
}

function computeFamilyFingerprint(fields = {}) {
  const material = familyFingerprintMaterial(fields);
  return material ? crypto.createHash('sha256').update(material).digest('hex') : null;
}

module.exports = { normalizeScan, computeFamilyFingerprint };
