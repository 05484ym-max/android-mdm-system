'use strict';

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { installFrpRoutes } = require('./frpRoutes');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(baseUrl + path, options);
  let body = null;
  try { body = await response.json(); } catch {}
  return { response, body };
}

async function main() {
  const previous = {
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    JWT_SECRET: process.env.JWT_SECRET,
    ALLOW_INSECURE_ADMIN: process.env.ALLOW_INSECURE_ADMIN,
  };
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'pw';
  delete process.env.ADMIN_PASSWORD_HASH;
  process.env.JWT_SECRET = 'frp-route-test-secret';
  delete process.env.ALLOW_INSECURE_ADMIN;

  const deviceToken = 'device-secret';
  let state = {
    deviceId: 'd1',
    enabledRequested: false,
    configuredAccountCount: 0,
    accountIds: [],
  };
  const statusReports = [];
  const wakeCalls = [];

  const db = {
    async getDevice(deviceId) {
      if (deviceId === 'missing') return null;
      return { deviceId, authTokenHash: sha256(deviceToken), pushToken: 'push-1' };
    },
  };

  const frpPersistence = {
    async listAdminStates() {
      const { accountIds, ...publicState } = state;
      return [publicState];
    },
    async getDeviceState(_deviceId, includeAccounts) {
      return includeAccounts ? { ...state } : (({ accountIds, ...rest }) => rest)(state);
    },
    async setRequestedEnabled(deviceId, enabled) {
      state = { ...state, deviceId, enabledRequested: enabled };
      const { accountIds, ...publicState } = state;
      return publicState;
    },
    async setAccounts(deviceId, accountIds) {
      state = {
        ...state,
        deviceId,
        accountIds: [...accountIds],
        configuredAccountCount: accountIds.length,
      };
      const { accountIds: hidden, ...publicState } = state;
      return publicState;
    },
    async recordDeviceStatus(deviceId, report) {
      statusReports.push([deviceId, report]);
      return { deviceId, enabledRequested: state.enabledRequested };
    },
  };

  const push = {
    async wake(token) {
      wakeCalls.push(token);
      return { sent: true };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  installFrpRoutes(app, {
    db,
    frpPersistence,
    push,
    logger: { info() {}, warn() {}, error() {} },
  });

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const adminToken = jwt.sign({ username: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const adminHeaders = {
    'content-type': 'application/json',
    cookie: `session=${adminToken}`,
    origin: baseUrl,
    'sec-fetch-site': 'same-origin',
  };

  try {
    let result = await jsonRequest(baseUrl, '/api/health/frp');
    assert.strictEqual(result.response.status, 401);

    result = await jsonRequest(baseUrl, '/api/health/devices/d1/frp', {
      method: 'PUT',
      headers: { ...adminHeaders, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ enabled: true }),
    });
    assert.strictEqual(result.response.status, 403);

    result = await jsonRequest(baseUrl, '/api/health/devices/d1/frp', {
      method: 'PUT', headers: adminHeaders,
      body: JSON.stringify({ enabled: true }),
    });
    assert.strictEqual(result.response.status, 409);
    assert.strictEqual(result.body.error, 'FRP_RECOVERY_ACCOUNT_REQUIRED');

    result = await jsonRequest(baseUrl, '/api/health/devices/d1/frp/accounts', {
      method: 'PUT', headers: adminHeaders,
      body: JSON.stringify({ accountIds: ['account-a', 'account-b'] }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.frp.configuredAccountCount, 2);

    result = await jsonRequest(baseUrl, '/api/health/devices/d1/frp', {
      method: 'PUT', headers: adminHeaders,
      body: JSON.stringify({ enabled: true }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.frp.enabledRequested, true);
    assert.ok(wakeCalls.length >= 2);

    result = await jsonRequest(baseUrl, '/api/devices/d1/frp-policy', {
      headers: { authorization: 'Bearer wrong' },
    });
    assert.strictEqual(result.response.status, 401);

    result = await jsonRequest(baseUrl, '/api/devices/d1/frp-policy', {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.enabled, true);
    assert.deepStrictEqual(result.body.accountIds, ['account-a', 'account-b']);

    result = await jsonRequest(baseUrl, '/api/devices/d1/frp-status', {
      method: 'POST',
      headers: { authorization: `Bearer ${deviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        apiSupported: true,
        deviceOwner: true,
        policyReadable: true,
        enabled: true,
        accountCount: 2,
        matchesDesired: true,
        ignoredField: 'must-not-be-persisted',
      }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(statusReports.length, 1);
    assert.strictEqual(statusReports[0][1].ignoredField, undefined);
    assert.strictEqual(statusReports[0][1].matchesDesired, true);

    console.log('FRP route tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
