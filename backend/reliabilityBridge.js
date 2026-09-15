'use strict';

const { Pool } = require('pg');

const COMMAND_LEASE_MS = 2 * 60 * 1000;
const ENROLL_PENDING_TTL_MS = 2 * 60 * 1000;

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true },
    max: 2,
  });
}

/**
 * Additive reliability layer loaded before legacy index.js.
 *
 * Keeping these changes in a bridge avoids a risky rewrite of the large legacy
 * entrypoint/db module while still replacing the exported operations index.js
 * calls. Once the old files are split into smaller modules this bridge can be
 * folded into the normal persistence layer.
 */
function installReliabilityBridge(db, push) {
  const pool = createPool();
  const pendingEnrollments = new Map();

  const ready = pool.query(`
    ALTER TABLE commands ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
    ALTER TABLE commands ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

    -- Commands delivered by an older build had no lease semantics. Do not
    -- suddenly replay those potentially destructive historical commands on
    -- deployment. Only commands leased by this build receive a finite lease.
    UPDATE commands
       SET lease_expires_at = 'infinity'::timestamptz
     WHERE delivered_at IS NOT NULL
       AND completed_at IS NULL
       AND lease_expires_at IS NULL;

    CREATE INDEX IF NOT EXISTS commands_lease_due_idx
      ON commands (device_id, queued_at)
      WHERE completed_at IS NULL;
  `);

  function toCommand(row) {
    const command = {
      id: row.id,
      command: row.command,
      params: row.params,
      queuedAt: row.queued_at.toISOString(),
    };
    if (row.delivered_at) command.deliveredAt = row.delivered_at.toISOString();
    return command;
  }

  function protectPushCredential(device) {
    if (!device || typeof device !== 'object') return device;
    if (!Object.prototype.hasOwnProperty.call(device, 'pushToken')) return device;
    const token = device.pushToken;
    delete device.pushToken;
    // Internal server code can still read device.pushToken, but object spread,
    // JSON.stringify and publicDevice() cannot serialize this credential.
    Object.defineProperty(device, 'pushToken', {
      value: token,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    return device;
  }

  // Protect every common DB operation that returns a device object. This
  // closes response paths that call publicDevice(updated) after a mutation,
  // not only the main device-list endpoint.
  [
    'getDevice',
    'createDevice',
    'setSubscription',
    'setSubscriptionUnblock',
    'setFullOpenMode',
    'setPolicy',
    'setPushToken',
    'setStatus',
    'setCustomerInfo',
    'setAllowCustomerDnsToggle',
    'setDnsDesiredState',
  ].forEach(name => {
    if (typeof db[name] !== 'function') return;
    const original = db[name].bind(db);
    db[name] = async (...args) => protectPushCredential(await original(...args));
  });

  // Lease instead of permanently consuming before the HTTP response reaches
  // the device. If sync/HTTP dies, the same command becomes eligible again;
  // the DPC's durable CommandJournal makes that redelivery idempotent.
  db.takePendingCommands = async function takeLeasedCommands(deviceId) {
    await ready;
    const { rows } = await pool.query(
      `WITH due AS (
         SELECT id
           FROM commands
          WHERE device_id = $1
            AND completed_at IS NULL
            AND (delivered_at IS NULL OR lease_expires_at <= now())
          ORDER BY queued_at
          FOR UPDATE SKIP LOCKED
          LIMIT 50
       )
       UPDATE commands c
          SET delivered_at = COALESCE(c.delivered_at, now()),
              lease_expires_at = now() + ($2 * interval '1 millisecond'),
              attempt_count = COALESCE(c.attempt_count, 0) + 1
         FROM due
        WHERE c.id = due.id
       RETURNING c.id, c.command, c.params, c.queued_at, c.delivered_at`,
      [deviceId, COMMAND_LEASE_MS],
    );
    return rows.map(toCommand);
  };

  // A terminal result closes the lease permanently. Repeated reports are
  // intentionally idempotent so a device can safely retry an ACK.
  db.completeCommand = async function completeLeasedCommand(deviceId, commandId, status, message) {
    await ready;
    const { rowCount } = await pool.query(
      `UPDATE commands
          SET result_status = $3,
              result_message = $4,
              completed_at = COALESCE(completed_at, now()),
              lease_expires_at = NULL
        WHERE id = $1
          AND device_id = $2
          AND delivered_at IS NOT NULL`,
      [commandId, deviceId, status, message || null],
    );
    return rowCount > 0;
  };

  // Existing index.js calls consumeEnrollment() and createDevice() separately.
  // Convert that pair into one DB transaction without rewriting the entrypoint:
  // consumeEnrollment validates/reserves only in this process; createDevice
  // atomically consumes the token and inserts the device. A crash between the
  // two calls therefore leaves the enrollment token usable instead of burned.
  const originalCreateDevice = db.createDevice.bind(db);

  db.consumeEnrollment = async function validateEnrollment(tokenHash, deviceId) {
    await ready;
    const { rowCount } = await pool.query(
      `SELECT 1
         FROM enrollments
        WHERE token_hash = $1
          AND purpose = 'ENROLL'
          AND used_at IS NULL
          AND expires_at > now()`,
      [tokenHash],
    );
    if (!rowCount) return false;
    pendingEnrollments.set(deviceId, { tokenHash, createdAt: Date.now() });
    for (const [id, pending] of pendingEnrollments) {
      if (Date.now() - pending.createdAt > ENROLL_PENDING_TTL_MS) pendingEnrollments.delete(id);
    }
    return true;
  };

  db.createDevice = async function createDeviceAtomically(deviceId, authTokenHash) {
    const pending = pendingEnrollments.get(deviceId);
    if (!pending) return originalCreateDevice(deviceId, authTokenHash);

    await ready;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const consumed = await client.query(
        `UPDATE enrollments
            SET used_at = now(), device_id = $2
          WHERE token_hash = $1
            AND purpose = 'ENROLL'
            AND used_at IS NULL
            AND expires_at > now()
        RETURNING id`,
        [pending.tokenHash, deviceId],
      );
      if (!consumed.rowCount) {
        throw new Error('enrollment token was already consumed or expired');
      }
      await client.query(
        `INSERT INTO devices (device_id, auth_token_hash)
         VALUES ($1, $2)`,
        [deviceId, authTokenHash],
      );
      await client.query('COMMIT');
      pendingEnrollments.delete(deviceId);
      return protectPushCredential(await db.getDevice(deviceId));
    } catch (error) {
      await client.query('ROLLBACK');
      pendingEnrollments.delete(deviceId);
      throw error;
    } finally {
      client.release();
    }
  };

  // Never expose the FCM credential itself to the admin UI. Expose only a
  // boolean capability used by diagnostics.
  const originalListDevices = db.listDevices.bind(db);
  db.listDevices = async function listDevicesWithPushState() {
    await ready;
    const [devices, tokenRows] = await Promise.all([
      originalListDevices(),
      pool.query('SELECT device_id, (push_token IS NOT NULL) AS has_push_token FROM devices'),
    ]);
    const pushState = new Map(tokenRows.rows.map(row => [row.device_id, row.has_push_token === true]));
    return devices.map(device => {
      const clean = { ...device, hasPushToken: pushState.get(device.deviceId) === true };
      delete clean.pushToken;
      return clean;
    });
  };

  if (typeof db.listDeviceHealth === 'function') {
    const originalListDeviceHealth = db.listDeviceHealth.bind(db);
    db.listDeviceHealth = async function listHealthWithPushState() {
      await ready;
      const [devices, tokenRows] = await Promise.all([
        originalListDeviceHealth(),
        pool.query('SELECT device_id, (push_token IS NOT NULL) AS has_push_token FROM devices'),
      ]);
      const pushState = new Map(tokenRows.rows.map(row => [row.device_id, row.has_push_token === true]));
      return devices.map(device => ({
        ...device,
        hasPushToken: pushState.get(device.deviceId) === true,
      }));
    };
  }

  // Firebase can explicitly tell us a registration token is permanently dead.
  // Clear it by value so future admin actions stop wasting push attempts; normal
  // polling remains the fallback and a new FCM token will register itself.
  if (push && typeof push.wake === 'function') {
    const originalWake = push.wake.bind(push);
    push.wake = async function wakeAndPrune(pushToken, data) {
      const result = await originalWake(pushToken, data);
      if (result && result.reason === 'token_unregistered' && pushToken) {
        await ready;
        await pool.query('UPDATE devices SET push_token = NULL WHERE push_token = $1', [pushToken]);
      }
      return result;
    };
  }
}

module.exports = { installReliabilityBridge };
