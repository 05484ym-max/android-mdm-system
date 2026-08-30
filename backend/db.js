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
ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_number TEXT;

CREATE TABLE IF NOT EXISTS apps_catalog (
  package_name TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS icon_url TEXT;

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

-- Device health / version reporting. Additive only - the existing "status"
-- JSONB column is untouched, these are parallel first-class columns so the
-- new health dashboard can query/sort/index without unpacking JSONB.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS current_version_code INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS current_version_name TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_device_owner BOOLEAN;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_owner_lost_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_update_status TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_update_version INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_update_error TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS battery_level INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS free_storage_bytes BIGINT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS manufacturer TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_test_device BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS devices_last_seen_idx ON devices (last_seen_at);

-- Versioned release metadata for staged rollout. Rollout/rollback logic
-- itself is not implemented yet - this step only adds the table shape.
CREATE TABLE IF NOT EXISTS app_releases (
  version_code       INTEGER PRIMARY KEY,
  version_name       TEXT,
  apk_url            TEXT NOT NULL,
  sha256             TEXT NOT NULL,
  release_status     TEXT NOT NULL DEFAULT 'TEST',
  rollout_percentage INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes              TEXT
);

CREATE INDEX IF NOT EXISTS app_releases_status_idx ON app_releases (release_status);

-- id is supplied by the backend (crypto.randomUUID()), same convention
-- already used for commands.id and enrollments.id above - no gen_random_uuid()/
-- pgcrypto extension dependency needed.
CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity    TEXT NOT NULL,
  category    TEXT NOT NULL,
  message     TEXT NOT NULL,
  device_id   TEXT REFERENCES devices(device_id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS alerts_unresolved_idx ON alerts (created_at) WHERE resolved_at IS NULL;

-- The alerts table has had zero readers/writers until now (schema-only from
-- an earlier migration) - "category" is repurposed here to hold the stable
-- fault code (e.g. "DEVICE_OWNER_LOST"), not a column rename, so this needs
-- no new column. This unique index is the only schema change: it guarantees
-- at the database level that a device can never have two OPEN alerts for
-- the same fault code (one open alert per deviceId+faultCode), closing the
-- check-then-insert race a purely application-level dedupe check would
-- leave open between concurrent /sync requests for the same device.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_unique_idx
  ON alerts (device_id, category) WHERE resolved_at IS NULL;
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
    customerName: row.customer_name,
    customerNumber: row.customer_number,
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
    `SELECT device_id, registered_at, subscription, policy, status,
            customer_name, customer_number
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

/** A short numeric ID the admin can read off a device and type into the panel. */
async function generateUniqueDeviceId() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = String(Math.floor(1000000000 + Math.random() * 9000000000));
    if (!(await getDevice(id))) return id;
  }
  throw new Error('could not generate a unique device id');
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

async function setCustomerInfo(deviceId, name, number) {
  const { rows } = await pool.query(
    `UPDATE devices SET customer_name = $2, customer_number = $3
      WHERE device_id = $1 RETURNING *`,
    [deviceId, name || null, number || null],
  );
  return rows[0] ? toDevice(rows[0]) : null;
}

/**
 * Records device-health fields reported on a sync. last_seen_at always
 * advances; every other column keeps its previous value (via COALESCE)
 * when the device didn't report that field, so an older app build that
 * sends none of this still syncs without wiping anything out.
 *
 * device_owner_lost_at is set exactly once, atomically within this same
 * UPDATE against the row's pre-update is_device_owner value (never a
 * separate read-then-write), the first time a device reports
 * isDeviceOwner=false after having been true - and is never cleared here
 * if the device later reports true again, so that history isn't silently
 * lost without an explicit admin decision.
 */
async function recordDeviceHealth(deviceId, fields) {
  await pool.query(
    `UPDATE devices SET
        last_seen_at = now(),
        current_version_code = COALESCE($2, current_version_code),
        current_version_name = COALESCE($3, current_version_name),
        is_device_owner = COALESCE($4, is_device_owner),
        device_owner_lost_at = CASE
          WHEN $4 = false AND is_device_owner = true AND device_owner_lost_at IS NULL
            THEN now()
          ELSE device_owner_lost_at
        END,
        last_update_status = COALESCE($5, last_update_status),
        last_update_version = COALESCE($6, last_update_version),
        last_update_error = COALESCE($7, last_update_error),
        battery_level = COALESCE($8, battery_level),
        free_storage_bytes = COALESCE($9, free_storage_bytes),
        manufacturer = COALESCE($10, manufacturer)
      WHERE device_id = $1`,
    [
      deviceId,
      fields.currentVersionCode ?? null,
      fields.currentVersionName ?? null,
      fields.isDeviceOwner ?? null,
      fields.lastUpdateStatus ?? null,
      fields.lastUpdateVersion ?? null,
      fields.lastUpdateError ?? null,
      fields.batteryLevel ?? null,
      fields.freeStorageBytes ?? null,
      fields.manufacturer ?? null,
    ],
  );
}

/** Marks a sync as fully completed - called only once the whole /sync
 * response (policy, catalog, commands) was built without error. */
async function markSyncSuccessful(deviceId) {
  await pool.query(`UPDATE devices SET last_sync_at = now() WHERE device_id = $1`, [deviceId]);
}

const HEALTH_ROW_COLUMNS = `device_id, registered_at, customer_name, customer_number, policy, status,
            current_version_code, current_version_name, last_seen_at, last_sync_at,
            is_device_owner, device_owner_lost_at, last_update_status, last_update_version,
            last_update_error, battery_level, free_storage_bytes, manufacturer`;

function mapHealthRow(row) {
  const status = row.status || {};
  return {
    deviceId: row.device_id,
    registeredAt: row.registered_at.toISOString(),
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    model: status.model || null,
    androidVersion: status.androidVersion || null,
    manufacturer: row.manufacturer,
    currentVersionCode: row.current_version_code,
    currentVersionName: row.current_version_name,
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    lastSyncAt: row.last_sync_at ? row.last_sync_at.toISOString() : null,
    isDeviceOwner: row.is_device_owner,
    deviceOwnerLostAt: row.device_owner_lost_at ? row.device_owner_lost_at.toISOString() : null,
    lastUpdateStatus: row.last_update_status,
    lastUpdateVersion: row.last_update_version,
    lastUpdateError: row.last_update_error,
    batteryLevel: row.battery_level,
    freeStorageBytes: row.free_storage_bytes,
    syncIntervalMinutes: (row.policy && row.policy.syncIntervalMinutes) || null,
  };
}

/**
 * Everything the admin-panel health dashboard needs, one row per device.
 * model/androidVersion still live inside the status JSONB (unchanged, set by
 * the existing /sync route) - every other field is a first-class column from
 * the device-health migration. Classification (ok/warning/critical) is not
 * done here; this is just a flat read, kept separate from healthPanel.js's
 * pure logic so that module stays testable without a database.
 */
async function listDeviceHealth() {
  const { rows } = await pool.query(
    `SELECT ${HEALTH_ROW_COLUMNS} FROM devices ORDER BY registered_at`,
  );
  return rows.map(mapHealthRow);
}

/** Same row shape as listDeviceHealth(), for exactly one device - used on
 * the /sync hot path (alerts reconciliation) so every device check-in
 * doesn't have to fetch the whole fleet just to diagnose itself. */
async function getDeviceHealth(deviceId) {
  const { rows } = await pool.query(
    `SELECT ${HEALTH_ROW_COLUMNS} FROM devices WHERE device_id = $1`,
    [deviceId],
  );
  return rows[0] ? mapHealthRow(rows[0]) : null;
}

// ---------- apps catalog ----------

async function listAppsCatalog() {
  const { rows } = await pool.query(
    `SELECT package_name, name, icon_url, added_at FROM apps_catalog ORDER BY added_at DESC`,
  );
  return rows.map(row => ({
    packageName: row.package_name,
    name: row.name,
    iconUrl: row.icon_url,
    addedAt: row.added_at.toISOString(),
  }));
}

async function addAppToCatalog(packageName, name, iconUrl) {
  await pool.query(
    `INSERT INTO apps_catalog (package_name, name, icon_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (package_name) DO UPDATE SET name = $2, icon_url = $3`,
    [packageName, name, iconUrl || null],
  );
}

// ---------- alerts ----------
// Plain CRUD only - which fault codes are alert-worthy, when to open/resolve
// one, and de-duplication policy all live in alerts.js. `category` holds the
// stable fault code (e.g. "DEVICE_OWNER_LOST"); `message` holds the fault's
// Hebrew title captured at open time, so the panel never has to re-derive it.

/** Currently-open alerts for one device, for alerts.js to diff against the
 * device's current fault list. */
async function listOpenAlertsForDevice(deviceId) {
  const { rows } = await pool.query(
    `SELECT id, category FROM alerts WHERE device_id = $1 AND resolved_at IS NULL`,
    [deviceId],
  );
  return rows;
}

/** No-ops (via the partial unique index in SCHEMA) if an open alert for this
 * device+fault code already exists - callers don't need their own locking. */
async function createAlert(id, deviceId, category, severity, message) {
  await pool.query(
    `INSERT INTO alerts (id, device_id, category, severity, message)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (device_id, category) WHERE resolved_at IS NULL DO NOTHING`,
    [id, deviceId, category, severity, message],
  );
}

async function resolveAlert(id) {
  await pool.query(
    `UPDATE alerts SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL`,
    [id],
  );
}

/** Active alerts for the admin panel, most severe and most recent first. */
async function listActiveAlerts() {
  const { rows } = await pool.query(
    `SELECT alerts.id, alerts.device_id, alerts.category, alerts.severity, alerts.message,
            alerts.created_at, alerts.resolved_at,
            devices.customer_name, devices.status->>'model' AS model
       FROM alerts
       LEFT JOIN devices ON devices.device_id = alerts.device_id
      WHERE alerts.resolved_at IS NULL
      ORDER BY CASE WHEN alerts.severity = 'critical' THEN 0 ELSE 1 END, alerts.created_at DESC`,
  );
  return rows.map(row => ({
    id: row.id,
    deviceId: row.device_id,
    customerName: row.customer_name,
    model: row.model,
    faultCode: row.category,
    severity: row.severity,
    message: row.message,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  }));
}

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
  generateUniqueDeviceId,
  createDevice,
  setSubscription,
  setPolicy,
  setStatus,
  setPushToken,
  setCustomerInfo,
  recordDeviceHealth,
  markSyncSuccessful,
  listDeviceHealth,
  getDeviceHealth,
  queueCommand,
  takePendingCommands,
  completeCommand,
  createEnrollment,
  consumeEnrollment,
  listEnrollments,
  listAppsCatalog,
  addAppToCatalog,
  listOpenAlertsForDevice,
  createAlert,
  resolveAlert,
  listActiveAlerts,
};
