'use strict';

const assert = require('assert');
const express = require('express');
const { installProtectionDeviceRoutes, sha256 } = require('./protectionDeviceRoutes');

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  const token = 'device-secret-token';
  const db = {
    async getDevice(deviceId) {
      if (deviceId === 'missing') return null;
      return { deviceId, authTokenHash: sha256(token) };
    },
  };
  const persistence = {
    async getDeviceProtection(deviceId) {
      if (deviceId === 'new') return null;
      return {
        deviceId,
        requestedProfile: 'HARDENED_ADMIN',
        achievedProfile: 'HARDENED',
        detectedCapabilities: ['DEFAULT_HOME', 'ACCESSIBILITY'],
      };
    },
  };

  const app = express();
  installProtectionDeviceRoutes(app, { db, protectionPersistence: persistence, logger: { warn() {} } });

  await withServer(app, async base => {
    let response = await fetch(`${base}/api/devices/d1/protection-target`);
    assert.strictEqual(response.status, 401);

    response = await fetch(`${base}/api/devices/d1/protection-target`, {
      headers: { Authorization: 'Bearer wrong' },
    });
    assert.strictEqual(response.status, 401);

    response = await fetch(`${base}/api/devices/missing/protection-target`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(response.status, 404);

    response = await fetch(`${base}/api/devices/d1/protection-target`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(response.status, 200);
    let body = await response.json();
    assert.strictEqual(body.requestedProfile, 'HARDENED_ADMIN');
    assert.deepStrictEqual(body.missingCapabilities, ['DEVICE_ADMIN']);
    assert.deepStrictEqual(body.nextActions, ['ACTIVATE_DEVICE_ADMIN']);
    assert.strictEqual(body.requiresReprovisioning, false);

    response = await fetch(`${base}/api/devices/new/protection-target`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(response.status, 200);
    body = await response.json();
    assert.strictEqual(body.requestedProfile, 'HARDENED_ADMIN');
    assert.strictEqual(body.achievedProfile, 'BASIC');
    assert.deepStrictEqual(body.missingCapabilities, ['DEVICE_ADMIN']);
  });

  console.log('protection device route tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
