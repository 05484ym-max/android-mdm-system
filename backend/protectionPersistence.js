'use strict';

const { Pool } = require('pg');
const { normalizeRequestedProfile, assessProtectionState } = require('./protectionState');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true },
  max: 5,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS device_protection_state (
  device_id                    TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  requested_profile            TEXT NOT NULL DEFAULT 'HARDENED_ADMIN',
  achieved_profile             TEXT NOT NULL DEFAULT 'BASIC',
  uninstall_protection         TEXT NOT NULL DEFAULT 'NONE',
  adapter_id                   TEXT,
  adapter_confidence           INTEGER,
  oem_skin                     TEXT,
  oem_skin_version             TEXT,
  device_codename              TEXT,
  build_display                TEXT,
  detected_capabilities        JSONB NOT NULL DEFAULT '[]'::jsonb,
  capability_detected_at       BIGINT,
  requested_updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_reported_at           TIMESTAMPTZ,
  protection_satisfied         BOOLEAN NOT NULL DEFAULT false,
  protection_gap               INTEGER NOT NULL DEFAULT 2,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requested_profile IN ('BASIC','HARDENED','HARDENED_ADMIN','DEVICE_OWNER','SYSTEM_LEVEL')),
  CHECK (achieved_profile IN ('BASIC','HARDENED','HARDENED_ADMIN','DEVICE_OWNER','SYSTEM_LEVEL')),
  CHECK (uninstall_protection IN ('NONE','BEST_EFFORT','ADMIN_GATED','DEVICE_OWNER_ENFORCED','SYSTEM_LEVEL')),
  CHECK (adapter_confidence IS NULL OR (adapter_confidence >= 0 AND adapter_confidence <= 100)),
  CHECK (protection_gap >= 0)
);

CREATE INDEX IF NOT EXISTS device_protection_state_satisfied_idx
  ON device_protection_state (protection_satisfied, updated_at DESC);
CREATE INDEX IF NOT EXISTS device_protection_state_adapter_idx
  ON device_protection_state (adapter_id);
`;

let schemaInitPromise = null;

async function ensureInitialized() {
  if (!schemaInitPromise) {
    schemaInitPromise = pool.query(SCHEMA).catch(error => {
      // A startup race (for example the parent devices table still being
      // created by db.init) must be retryable on the next call.
      schemaInitPromise = null;
      throw error;
    });
  }
  await schemaInitPromise;
}

async function init() {
  await ensureInitialized();
}

async function ensureDeviceRow(deviceId) {
  await ensureInitialized();
  await pool.query(
    `INSERT INTO device_protection_state (device_id)
     VALUES ($1)
     ON CONFLICT (device_id) DO NOTHING`,
    [deviceId],
  );
}

async function setRequestedProfile(deviceId, requestedProfile) {
  const requested = normalizeRequestedProfile(requestedProfile);
  await ensureDeviceRow(deviceId);

  const { rows } = await pool.query(
    `UPDATE device_protection_state
        SET requested_profile = $2,
            requested_updated_at = now(),
            protection_satisfied = CASE
              WHEN CASE achieved_profile
                WHEN 'BASIC' THEN 0 WHEN 'HARDENED' THEN 1 WHEN 'HARDENED_ADMIN' THEN 2
                WHEN 'DEVICE_OWNER' THEN 3 WHEN 'SYSTEM_LEVEL' THEN 4 END
                >=
                CASE $2
                WHEN 'BASIC' THEN 0 WHEN 'HARDENED' THEN 1 WHEN 'HARDENED_ADMIN' THEN 2
                WHEN 'DEVICE_OWNER' THEN 3 WHEN 'SYSTEM_LEVEL' THEN 4 END
              THEN true ELSE false END,
            protection_gap = GREATEST(0,
              CASE $2
                WHEN 'BASIC' THEN 0 WHEN 'HARDENED' THEN 1 WHEN 'HARDENED_ADMIN' THEN 2
                WHEN 'DEVICE_OWNER' THEN 3 WHEN 'SYSTEM_LEVEL' THEN 4 END
              - CASE achieved_profile
                WHEN 'BASIC' THEN 0 WHEN 'HARDENED' THEN 1 WHEN 'HARDENED_ADMIN' THEN 2
                WHEN 'DEVICE_OWNER' THEN 3 WHEN 'SYSTEM_LEVEL' THEN 4 END
            ),
            updated_at = now()
      WHERE device_id = $1
      RETURNING *`,
    [deviceId, requested],
  );
  return mapRow(rows[0]);
}

async function recordDeviceProtection(deviceId, report) {
  await ensureDeviceRow(deviceId);

  const { rows: currentRows } = await pool.query(
    `SELECT requested_profile FROM device_protection_state WHERE device_id = $1`,
    [deviceId],
  );
  const requested = normalizeRequestedProfile(currentRows[0]?.requested_profile);
  const assessed = assessProtectionState(requested, report.achievedProtectionProfile);

  const capabilities = Array.isArray(report.detectedCapabilities)
    ? [...new Set(report.detectedCapabilities)].slice(0, 32)
    : [];

  const { rows } = await pool.query(
    `UPDATE device_protection_state SET
        achieved_profile = $2,
        uninstall_protection = $3,
        adapter_id = $4,
        adapter_confidence = $5,
        oem_skin = $6,
        oem_skin_version = $7,
        device_codename = $8,
        build_display = $9,
        detected_capabilities = $10::jsonb,
        capability_detected_at = $11,
        device_reported_at = now(),
        protection_satisfied = $12,
        protection_gap = $13,
        updated_at = now()
      WHERE device_id = $1
      RETURNING *`,
    [
      deviceId,
      assessed.achievedProfile,
      report.uninstallProtection || 'NONE',
      report.adapterId || null,
      report.adapterConfidence ?? null,
      report.oemSkin || null,
      report.oemSkinVersion || null,
      report.deviceCodename || null,
      report.buildDisplay || null,
      JSON.stringify(capabilities),
      report.capabilityDetectedAt ?? null,
      assessed.satisfied,
      assessed.gap,
    ],
  );
  return mapRow(rows[0]);
}

async function getDeviceProtection(deviceId) {
  await ensureInitialized();
  const { rows } = await pool.query(
    `SELECT * FROM device_protection_state WHERE device_id = $1`,
    [deviceId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

async function listDeviceProtection() {
  await ensureInitialized();
  const { rows } = await pool.query(
    `SELECT p.*, d.customer_name, d.customer_number, d.status
       FROM device_protection_state p
       JOIN devices d ON d.device_id = p.device_id
      ORDER BY p.protection_satisfied ASC, p.updated_at DESC`,
  );
  return rows.map(mapRow);
}

function mapRow(row) {
  if (!row) return null;
  return {
    deviceId: row.device_id,
    customerName: row.customer_name || null,
    customerNumber: row.customer_number || null,
    model: row.status?.model || null,
    requestedProfile: row.requested_profile,
    achievedProfile: row.achieved_profile,
    uninstallProtection: row.uninstall_protection,
    adapterId: row.adapter_id,
    adapterConfidence: row.adapter_confidence,
    oemSkin: row.oem_skin,
    oemSkinVersion: row.oem_skin_version,
    deviceCodename: row.device_codename,
    buildDisplay: row.build_display,
    detectedCapabilities: row.detected_capabilities || [],
    capabilityDetectedAt: row.capability_detected_at == null ? null : Number(row.capability_detected_at),
    requestedUpdatedAt: row.requested_updated_at?.toISOString?.() || null,
    deviceReportedAt: row.device_reported_at?.toISOString?.() || null,
    protectionSatisfied: row.protection_satisfied === true,
    protectionGap: row.protection_gap,
    updatedAt: row.updated_at?.toISOString?.() || null,
  };
}

async function close() {
  await pool.end();
}

module.exports = {
  init,
  ensureInitialized,
  ensureDeviceRow,
  setRequestedProfile,
  recordDeviceProtection,
  getDeviceProtection,
  listDeviceProtection,
  close,
};
