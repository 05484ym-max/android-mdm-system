'use strict';

const assert = require('assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { installProtectionAdminRoutes } = require('./protectionAdminRoutes');

async function request(baseUrl, path, options = {}) {
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
  process.env.JWT_SECRET = 'route-test-secret';
  delete process.env.ALLOW_INSECURE_ADMIN;

  const calls = [];
  const db = {
    async getDevice(deviceId) {
      return deviceId === 'missing' ? null : { deviceId };
    },
  };
  const protectionPersistence = {
    async setRequestedProfile(deviceId, requestedProfile) {
      calls.push([deviceId, requestedProfile]);
      return {
        deviceId,
        requestedProfile,
        achievedProfile: 'HARDENED',
        protectionSatisfied: requestedProfile === 'HARDENED',
        protectionGap: requestedProfile === 'HARDENED' ? 0 : 1,
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  installProtectionAdminRoutes(app, {
    db,
    protectionPersistence,
    logger: { info() {} },
  });
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const token = jwt.sign({ username: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const headers = {
    'content-type': 'application/json',
    cookie: `session=${token}`,
    origin: baseUrl,
    'sec-fetch-site': 'same-origin',
  };

  try {
    let result = await request(baseUrl, '/api/health/devices/d1/protection/requested', {
      method: 'PUT', headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ requestedProfile: 'HARDENED' }),
    });
    assert.strictEqual(result.response.status, 401);

    result = await request(baseUrl, '/api/health/devices/d1/protection/requested', {
      method: 'PUT',
      headers: { ...headers, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ requestedProfile: 'HARDENED' }),
    });
    assert.strictEqual(result.response.status, 403);

    result = await request(baseUrl, '/api/health/devices/d1/protection/requested', {
      method: 'PUT', headers,
      body: JSON.stringify({ requestedProfile: 'NOT_REAL' }),
    });
    assert.strictEqual(result.response.status, 400);

    result = await request(baseUrl, '/api/health/devices/missing/protection/requested', {
      method: 'PUT', headers,
      body: JSON.stringify({ requestedProfile: 'HARDENED' }),
    });
    assert.strictEqual(result.response.status, 404);

    result = await request(baseUrl, '/api/health/devices/d1/protection/requested', {
      method: 'PUT', headers,
      body: JSON.stringify({ requestedProfile: 'HARDENED_ADMIN' }),
    });
    assert.strictEqual(result.response.status, 200);
    assert.strictEqual(result.body.status, 'ok');
    assert.strictEqual(result.body.protection.requestedProfile, 'HARDENED_ADMIN');
    assert.deepStrictEqual(calls, [['d1', 'HARDENED_ADMIN']]);

    console.log('protection admin route tests passed');
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
