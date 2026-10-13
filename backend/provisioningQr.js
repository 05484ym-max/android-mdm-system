'use strict';

const fs = require('fs');
const path = require('path');

const COMPONENT_KEY = 'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME';
const CHECKSUM_KEY = 'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM';
const DOWNLOAD_KEY = 'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION';
const EXTRAS_KEY = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE';
const EXPECTED_COMPONENT = 'org.mdmopen.dpc/org.mdmopen.dpc.DpcDeviceAdminReceiver';

/**
 * The deployed APK, version.json and provisioning.json must come from the
 * same CI publication. Never build a QR from hard-coded/stale client data.
 */
function readLiveProvisioning(downloadsDir = path.join(__dirname, '../admin-panel/downloads')) {
  const raw = JSON.parse(fs.readFileSync(path.join(downloadsDir, 'provisioning.json'), 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(downloadsDir, 'version.json'), 'utf8'));

  if (raw[COMPONENT_KEY] !== EXPECTED_COMPONENT) {
    throw new Error('Unexpected DPC component in provisioning.json');
  }
  if (typeof raw[CHECKSUM_KEY] !== 'string' ||
      !/^[A-Za-z0-9_-]{43}=?$/.test(raw[CHECKSUM_KEY])) {
    throw new Error('Invalid signing-certificate checksum in provisioning.json');
  }
  if (!Number.isSafeInteger(version.versionCode) || version.versionCode <= 0 ||
      raw[DOWNLOAD_KEY] !== version.apkUrl) {
    throw new Error('APK URL does not match deployed version.json');
  }

  const apkUrl = new URL(raw[DOWNLOAD_KEY]);
  if (apkUrl.protocol !== 'https:' ||
      apkUrl.pathname !== '/downloads/mdm.apk' ||
      apkUrl.searchParams.get('v') !== String(version.versionCode)) {
    throw new Error('Invalid HTTPS APK download URL or version');
  }
  fs.accessSync(path.join(downloadsDir, 'mdm.apk'), fs.constants.R_OK);

  return {
    componentName: raw[COMPONENT_KEY],
    signatureChecksum: raw[CHECKSUM_KEY],
    apkUrl: apkUrl.toString(),
    serverUrl: apkUrl.origin,
    versionCode: version.versionCode,
  };
}

function buildProvisioningPayload(template, enrollmentToken) {
  if (!/^[A-Z2-9]{10}$/.test(enrollmentToken)) {
    throw new Error('Invalid enrollment token');
  }
  return {
    [COMPONENT_KEY]: template.componentName,
    [CHECKSUM_KEY]: template.signatureChecksum,
    [DOWNLOAD_KEY]: template.apkUrl,
    [EXTRAS_KEY]: {
      serverUrl: template.serverUrl,
      enrollmentToken,
    },
  };
}

module.exports = { readLiveProvisioning, buildProvisioningPayload };
