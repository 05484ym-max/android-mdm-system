'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readLiveProvisioning, buildProvisioningPayload } = require('./provisioningQr');
const qrcode = require('../admin-panel/vendor/qrcode.js');

const downloads = path.join(__dirname, '../admin-panel/downloads');
const current = readLiveProvisioning(downloads);
const token = 'ABCDEF2345';
const payload = buildProvisioningPayload(current, token);

assert.equal(payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME'], current.componentName);
assert.equal(payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'], current.signatureChecksum);
assert.equal(payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'], current.apkUrl);
assert.deepEqual(payload['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'], {
  serverUrl: current.serverUrl,
  enrollmentToken: token,
});
assert.equal(current.versionCode, Number(new URL(current.apkUrl).searchParams.get('v')));
assert.throws(() => buildProvisioningPayload(current, 'bad token'));

const code = qrcode(0, 'M');
code.addData(JSON.stringify(payload), 'Byte');
code.make();
assert.ok(code.getModuleCount() > 20, 'QR matrix should contain modules');
assert.ok(code.isDark(0, 0), 'QR finder pattern top-left');

// Simulate inconsistent Render deployment; reject before creating a token.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-qr-'));
try {
  const original = JSON.parse(fs.readFileSync(path.join(downloads, 'provisioning.json'), 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(downloads, 'version.json'), 'utf8'));
  const write = () => {
    fs.writeFileSync(path.join(temp, 'provisioning.json'), JSON.stringify(original));
    fs.writeFileSync(path.join(temp, 'version.json'), JSON.stringify(version));
  };
  fs.writeFileSync(path.join(temp, 'mdm.apk'), 'fixture');
  write();
  assert.equal(readLiveProvisioning(temp).versionCode, current.versionCode);

  version.versionCode += 1;
  write();
  assert.throws(() => readLiveProvisioning(temp), /version/);

  version.versionCode -= 1;
  original['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'] = 'BAD';
  write();
  assert.throws(() => readLiveProvisioning(temp), /checksum/);

  original['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'] = current.signatureChecksum;
  original['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'] =
    current.apkUrl.replace('https:', 'http:');
  version.apkUrl = original['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'];
  write();
  assert.throws(() => readLiveProvisioning(temp), /HTTPS/);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Live provisioning QR integration checks passed');
