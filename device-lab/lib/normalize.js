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
  const familyMaterial = [lower(normalized.device),lower(normalized.board),lower(normalized.hardware),
    lower(normalized.platform),lower(normalized.fastbootProduct)].filter(Boolean).join('|');
  const exactMaterial = [familyMaterial,lower(normalized.buildFingerprint),lower(normalized.bootloader),
    lower(normalized.product)].filter(Boolean).join('|');
  normalized.familyFingerprint = familyMaterial ? crypto.createHash('sha256').update(familyMaterial).digest('hex') : null;
  normalized.exactFingerprint = exactMaterial ? crypto.createHash('sha256').update(exactMaterial).digest('hex') : null;
  return normalized;
}
module.exports = { normalizeScan };
