'use strict';

const assert = require('assert');
const { Pool } = require('pg');
const db = require('./db');
const protection = require('./protectionPersistence');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true },
  });

  try {
    await db.init();
    await protection.init();

    const deviceId = 'cap-test-' + Date.now();
    await pool.query(
      `INSERT INTO devices (device_id, auth_token_hash, customer_name, customer_number, status)
       VALUES ($1, 'testhash', 'לקוח בדיקה', '001', $2::jsonb)`,
      [deviceId, JSON.stringify({ model: 'Qin F21 Pro' })],
    );

    const initial = await protection.setRequestedProfile(deviceId, 'HARDENED_ADMIN');
    assert.strictEqual(initial.requestedProfile, 'HARDENED_ADMIN');
    assert.strictEqual(initial.achievedProfile, 'BASIC');
    assert.strictEqual(initial.protectionSatisfied, false);
    assert.strictEqual(initial.protectionGap, 2);

    const reported = await protection.recordDeviceProtection(deviceId, {
      achievedProtectionProfile: 'HARDENED_ADMIN',
      uninstallProtection: 'ADMIN_GATED',
      adapterId: 'qin.f21pro',
      adapterConfidence: 99,
      oemSkin: 'qin_f21pro',
      oemSkinVersion: 'test',
      deviceCodename: 'f21pro',
      buildDisplay: 'test-build',
      detectedCapabilities: ['LAUNCHER', 'ACCESSIBILITY', 'DEVICE_ADMIN', 'DEVICE_ADMIN'],
      capabilityDetectedAt: Date.now(),
    });

    assert.strictEqual(reported.protectionSatisfied, true);
    assert.strictEqual(reported.protectionGap, 0);
    assert.deepStrictEqual(reported.detectedCapabilities, ['LAUNCHER', 'ACCESSIBILITY', 'DEVICE_ADMIN']);

    const strongerRequest = await protection.setRequestedProfile(deviceId, 'DEVICE_OWNER');
    assert.strictEqual(strongerRequest.protectionSatisfied, false);
    assert.strictEqual(strongerRequest.protectionGap, 1);

    const rows = await protection.listDeviceProtection();
    const row = rows.find(item => item.deviceId === deviceId);
    assert.ok(row);
    assert.strictEqual(row.customerName, 'לקוח בדיקה');
    assert.strictEqual(row.model, 'Qin F21 Pro');
    assert.strictEqual(row.adapterId, 'qin.f21pro');

    await pool.query('DELETE FROM devices WHERE device_id = $1', [deviceId]);
    const afterDelete = await protection.getDeviceProtection(deviceId);
    assert.strictEqual(afterDelete, null, 'protection row must cascade-delete with device');

    console.log('protection persistence integration tests passed');
  } finally {
    await protection.close();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
