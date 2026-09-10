'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true },
  max: 5,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS device_frp_state (
  device_id          TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  enabled_requested  BOOLEAN NOT NULL DEFAULT false,
  account_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  api_supported      BOOLEAN,
  device_owner       BOOLEAN,
  policy_readable    BOOLEAN,
  enabled_actual     BOOLEAN,
  account_count      INTEGER,
  matches_desired    BOOLEAN,
  last_error         TEXT,
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_at        TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (account_count IS NULL OR account_count >= 0)
);
CREATE INDEX IF NOT EXISTS device_frp_state_enabled_idx
  ON device_frp_state (enabled_requested, updated_at DESC);
`;

let schemaInitPromise = null;

async function ensureInitialized() {
  if (!schemaInitPromise) {
    schemaInitPromise = pool.query(SCHEMA).catch(error => {
      schemaInitPromise = null;
      throw error;
    });
  }
  await schemaInitPromise;
}

function normalizeAccountIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(v => String(v).trim()).filter(Boolean))].slice(0, 20);
}

/**
 * Account identifiers stay outside source control. Configure them on the
 * server as a comma-separated FRP_RECOVERY_ACCOUNTS value. Android delegates
 * interpretation of these strings to the device's FRP management agent.
 */
function configuredDefaultAccounts() {
  const raw = process.env.FRP_RECOVERY_ACCOUNTS || '';
  return normalizeAccountIds(raw.split(','));
}

async function ensureDeviceRow(deviceId) {
  await ensureInitialized();
  const defaults = configuredDefaultAccounts();
  await pool.query(
    `INSERT INTO device_frp_state (device_id, account_ids)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (device_id) DO UPDATE SET
       account_ids = CASE
         WHEN jsonb_array_length(device_frp_state.account_ids) = 0
              AND jsonb_array_length(EXCLUDED.account_ids) > 0
         THEN EXCLUDED.account_ids
         ELSE device_frp_state.account_ids
       END`,
    [deviceId, JSON.stringify(defaults)],
  );
}

async function setRequestedEnabled(deviceId, enabled) {
  await ensureDeviceRow(deviceId);

  if (enabled === true) {
    const { rows: accountRows } = await pool.query(
      `SELECT jsonb_array_length(account_ids) AS account_count
         FROM device_frp_state WHERE device_id = $1`,
      [deviceId],
    );
    if (Number(accountRows[0]?.account_count || 0) < 1) {
      const error = new Error('FRP_RECOVERY_ACCOUNT_REQUIRED');
      error.code = 'FRP_RECOVERY_ACCOUNT_REQUIRED';
      throw error;
    }
  }

  const { rows } = await pool.query(
    `UPDATE device_frp_state
        SET enabled_requested = $2,
            requested_at = now(),
            updated_at = now()
      WHERE device_id = $1
      RETURNING *`,
    [deviceId, enabled === true],
  );
  return mapRow(rows[0], false);
}

async function setAccounts(deviceId, accountIds) {
  const normalized = normalizeAccountIds(accountIds);
  await ensureDeviceRow(deviceId);
  const { rows } = await pool.query(
    `UPDATE device_frp_state
        SET account_ids = $2::jsonb,
            requested_at = now(),
            updated_at = now()
      WHERE device_id = $1
      RETURNING *`,
    [deviceId, JSON.stringify(normalized)],
  );
  return mapRow(rows[0], false);
}

async function recordDeviceStatus(deviceId, status) {
  await ensureDeviceRow(deviceId);
  const { rows } = await pool.query(
    `UPDATE device_frp_state SET
        api_supported = $2,
        device_owner = $3,
        policy_readable = $4,
        enabled_actual = $5,
        account_count = $6,
        matches_desired = $7,
        last_error = $8,
        reported_at = now(),
        updated_at = now()
      WHERE device_id = $1
      RETURNING *`,
    [
      deviceId,
      status.apiSupported ?? null,
      status.deviceOwner ?? null,
      status.policyReadable ?? null,
      status.enabled ?? null,
      status.accountCount ?? null,
      status.matchesDesired ?? null,
      status.error || null,
    ],
  );
  return mapRow(rows[0], false);
}

async function getDeviceState(deviceId, includeAccounts = false) {
  await ensureDeviceRow(deviceId);
  const { rows } = await pool.query('SELECT * FROM device_frp_state WHERE device_id = $1', [deviceId]);
  return rows[0] ? mapRow(rows[0], includeAccounts) : null;
}

async function listAdminStates() {
  await ensureInitialized();
  const { rows } = await pool.query(
    `SELECT f.*, d.customer_name, d.customer_number
       FROM device_frp_state f
       JOIN devices d ON d.device_id = f.device_id
      ORDER BY f.updated_at DESC`,
  );
  return rows.map(row => ({
    ...mapRow(row, false),
    customerName: row.customer_name || null,
    customerNumber: row.customer_number || null,
  }));
}

function mapRow(row, includeAccounts) {
  const result = {
    deviceId: row.device_id,
    enabledRequested: row.enabled_requested === true,
    configuredAccountCount: Array.isArray(row.account_ids) ? row.account_ids.length : 0,
    apiSupported: row.api_supported,
    deviceOwner: row.device_owner,
    policyReadable: row.policy_readable,
    enabledActual: row.enabled_actual,
    accountCount: row.account_count,
    matchesDesired: row.matches_desired,
    lastError: row.last_error,
    requestedAt: row.requested_at?.toISOString?.() || null,
    reportedAt: row.reported_at?.toISOString?.() || null,
    updatedAt: row.updated_at?.toISOString?.() || null,
  };
  if (includeAccounts) result.accountIds = Array.isArray(row.account_ids) ? row.account_ids : [];
  return result;
}

async function close() { await pool.end(); }

module.exports = {
  ensureInitialized,
  ensureDeviceRow,
  normalizeAccountIds,
  configuredDefaultAccounts,
  setRequestedEnabled,
  setAccounts,
  recordDeviceStatus,
  getDeviceState,
  listAdminStates,
  close,
};
