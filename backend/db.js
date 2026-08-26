const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true },
  max: 5,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  device_id       TEXT PRIMARY KEY,
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  auth_token_hash TEXT NOT NULL,
  subscription    JSONB,
  policy          JSONB NOT NULL DEFAULT '{"allowedApps":[],"kioskEnabled":false}'::jsonb,
  status          JSONB
);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS push_token TEXT;

CREATE TABLE IF NOT EXISTS commands (
  id           UUID PRIMARY KEY,
  device_id    TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  command      TEXT NOT NULL,
  params       JSONB NOT NULL DEFAULT '{}'::jsonb,
  queued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS commands_pending_idx
  ON commands (device_id) WHERE delivered_at IS NULL;

ALTER TABLE commands ADD COLUMN IF NOT EXISTS result_status TEXT;
ALTER TABLE commands ADD COLUMN IF NOT EXISTS result_message TEXT;
ALTER TABLE commands ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;


CREATE TABLE IF NOT EXISTS enrollments (
  id         UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  device_id  TEXT
);
`;

async function init() {
  await pool.query(SCHEMA);
}

function toCommand(row) {
  const entry = {
    id: row.id,
    command: row.command,
    params: row.params,
    queuedAt: row.queued_at.toISOString(),
  };
  if (row.delivered_at) {
    entry.deliveredAt = row.delivered_at.toISOString();
  }
  return entry;
}

function toDevice(row, pendingCommands = [], commandHistory = []) {
  return {
    deviceId: row.device_id,
    registeredAt: row.registered_at.toISOString(),
    authTokenHash: row.auth_token_hash,
    subscription: row.subscription,
    policy: row.policy,
    status: row.status,
    pushToken: row.push_token,
    pendingCommands,
    commandHistory,
  };
}

// ---------- devices ----------

async function getDevice(deviceId) {
  const { rows } = await pool.query(
    'SELECT * FROM devices WHERE device_id = $1',
    [deviceId],
  );
  return rows[0] ? toDevice(rows[0]) : null;
}

async function listDevices() {
  const { rows } = await pool.query(
    `SELECT device_id, registered_at, subscription, policy, status
       FROM devices
      ORDER BY registered_at`,
  );

  // Every pending command, plus the five most recent delivered ones per device.
  const { rows: commandRows } = await pool.query(
    `SELECT device_id, id, command, params, queued_at, delivered_at
       FROM (
         SELECT *, row_number() OVER (
                     PARTITION BY device_id, (delivered_at IS NULL)
                     ORDER BY queued_at DESC
                   ) AS rn
           FROM commands
       ) ranked
      WHERE delivered_at IS NULL OR rn <= 5
      ORDER BY queued_at`,
  );

  const pending = new Map();
  const history = new Map();
  for (const row of commandRows) {
    const target = row.delivered_at ? history : pending;
    if (!target.has(row.device_id)) target.set(row.device_id, []);
    target.get(row.device_id).push(toCommand(row));
  }

  return rows.map(row => toDevice(
    row,
    pending.get(row.device_id) || [],
    history.get(row.device_id) || [],
  ));
}

async function createDevice(deviceId, authTokenHash) {
  const { rows } = await pool.query(
    `INSERT INTO devices (device_id, auth_token_hash)
     VALUES ($1, $2)
     RETURNING *`,
    [deviceId, authTokenHash],
  );
  return toDevice(rows[0]);
}

async function updateDeviceField(deviceId, column, value) {
  const { rows } = await pool.query(
    `UPDATE devices SET ${column} = $2 WHERE device_id = $1 RETURNING *`,
    [deviceId, value],
  );
  return rows[0] ? toDevice(rows[0]) : null;
}

const setSubscription = (deviceId, value) =>
  updateDeviceField(deviceId, 'subscription', value);

const setPolicy = (deviceId, value) =>
  updateDeviceField(deviceId, 'policy', value);

const setPushToken = (deviceId, value) =>
  updateDeviceField(deviceId, 'push_token', value);

const setStatus = (deviceId, value) =>
  updateDeviceField(deviceId, 'status', value);

// ---------- commands ----------

async function queueCommand(deviceId, id, command, params) {
  await pool.query(
    `INSERT INTO commands (id, device_id, command, params)
     VALUES ($1, $2, $3, $4)`,
    [id, deviceId, command, params],
  );
}

/** Atomically hands the pending commands to the device and marks them delivered. */
async function takePendingCommands(deviceId) {
  const { rows } = await pool.query(
    `UPDATE commands
        SET delivered_at = now()
      WHERE device_id = $1 AND delivered_at IS NULL
      RETURNING id, command, params, queued_at, delivered_at`,
    [deviceId],
  );
  return rows.map(toCommand);
}

async function completeCommand(deviceId, commandId, status, message) {
  const { rowCount } = await pool.query(
    `UPDATE commands
        SET result_status = $3,
            result_message = $4,
            completed_at = now()
      WHERE id = $1
        AND device_id = $2
        AND delivered_at IS NOT NULL`,
    [commandId, deviceId, status, message || null],
  );

  return rowCount > 0;
}

// ---------- enrollments ----------

async function createEnrollment(id, tokenHash, expiresAt) {
  await pool.query(
    `INSERT INTO enrollments (id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [id, tokenHash, expiresAt],
  );
}

/** Marks the code used only if it is still valid. Returns false otherwise. */
async function consumeEnrollment(tokenHash, deviceId) {
  const { rowCount } = await pool.query(
    `UPDATE enrollments
        SET used_at = now(), device_id = $2
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()`,
    [tokenHash, deviceId],
  );
  return rowCount > 0;
}

async function listEnrollments() {
  const { rows } = await pool.query(
    `SELECT id, created_at, expires_at, used_at, device_id
       FROM enrollments
      ORDER BY created_at DESC
      LIMIT 50`,
  );
  return rows.map(row => ({
    id: row.id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    usedAt: row.used_at ? row.used_at.toISOString() : null,
    deviceId: row.device_id,
  }));
}

module.exports = {
  init,
  getDevice,
  listDevices,
  createDevice,
  setSubscription,
  setPolicy,
  setStatus,
  setPushToken,
  queueCommand,
  takePendingCommands,
  completeCommand,
  createEnrollment,
  consumeEnrollment,
  listEnrollments,
};
