'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');

const COMMAND_LEASE_MS = 10 * 60 * 1000;
const ENROLL_PENDING_TTL_MS = 2 * 60 * 1000;
const ENROLL_RETRY_TTL_MS = 60 * 60 * 1000;
const IMAGE_CACHE_RETENTION_DAYS = 90;
const IMAGE_CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true },
    max: 2,
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function enrollmentSecret() {
  return process.env.ENROLLMENT_IDEMPOTENCY_SECRET || process.env.JWT_SECRET || null;
}

function deriveEnrollmentToken(tokenHash) {
  const secret = enrollmentSecret();
  if (!secret) throw new Error('enrollment idempotency secret is not configured');
  return crypto.createHmac('sha256', secret)
    .update(`device-enrollment:${tokenHash}`)
    .digest('hex');
}

function installReliabilityBridge(db, push) {
  const pool = createPool();
  const pendingEnrollments = new Map();
  let lastImageCacheCleanupAt = 0;

  const ready = pool.query(`
    ALTER TABLE commands ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
    ALTER TABLE commands ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

    UPDATE commands
       SET lease_expires_at = 'infinity'::timestamptz
     WHERE delivered_at IS NOT NULL
       AND completed_at IS NULL
       AND lease_expires_at IS NULL;

    CREATE INDEX IF NOT EXISTS commands_lease_due_idx
      ON commands (device_id, queued_at)
      WHERE completed_at IS NULL;

    CREATE TABLE IF NOT EXISTS enrollment_attempts (
      token_hash TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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
    Object.defineProperty(device, 'pushToken', {
      value: token,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    return device;
  }

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

  db.completeCommand = async function completeLeasedCommand(deviceId, commandId, status, message) {
    await ready;
    const { rowCount } = await pool.query(
      `UPDATE commands
          SET result_status = $3,
              result_message = $4,
              completed_at = now(),
              lease_expires_at = NULL
        WHERE id = $1
          AND device_id = $2
          AND delivered_at IS NOT NULL
          AND completed_at IS NULL`,
      [commandId, deviceId, status, message || null],
    );
    return rowCount > 0;
  };

  /**
   * Atomic and response-loss-safe enrollment. The one-time enrollment token
   * itself is the idempotency key. For one hour after a successful commit, a
   * retry of that same secret receives the same device identity and the same
   * deterministic auth token. After that window a consumed code cannot be used
   * to recover/rotate credentials; the normal recovery-code flow remains the
   * only recovery mechanism.
   */
  db.registerDeviceIdempotent = async function registerDeviceIdempotent(tokenHash, candidateDeviceId) {
    await ready;
    const deviceToken = deriveEnrollmentToken(tokenHash);
    const authTokenHash = sha256(deviceToken);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const prior = await client.query(
        `SELECT device_id, created_at
           FROM enrollment_attempts
          WHERE token_hash = $1
          FOR UPDATE`,
        [tokenHash],
      );
      if (prior.rowCount) {
        const row = prior.rows[0];
        if (Date.now() - new Date(row.created_at).getTime() > ENROLL_RETRY_TTL_MS) {
          await client.query('ROLLBACK');
          return null;
        }
        const device = await client.query(
          'SELECT 1 FROM devices WHERE device_id = $1 AND auth_token_hash = $2',
          [row.device_id, authTokenHash],
        );
        if (!device.rowCount) {
          throw new Error('enrollment retry state no longer matches device credential');
        }
        await client.query('COMMIT');
        return { deviceId: row.device_id, deviceToken, replayed: true };
      }

      const consumed = await client.query(
        `UPDATE enrollments
            SET used_at = now(), device_id = $2
          WHERE token_hash = $1
            AND purpose = 'ENROLL'
            AND used_at IS NULL
            AND expires_at > now()
        RETURNING id`,
        [tokenHash, candidateDeviceId],
      );
      if (!consumed.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `INSERT INTO devices (device_id, auth_token_hash)
         VALUES ($1, $2)`,
        [candidateDeviceId, authTokenHash],
      );
      await client.query(
        `INSERT INTO enrollment_attempts (token_hash, device_id)
         VALUES ($1, $2)`,
        [tokenHash, candidateDeviceId],
      );
      await client.query('COMMIT');
      return { deviceId: candidateDeviceId, deviceToken, replayed: false };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  };

  // Compatibility for legacy code paths that still call consume/create
  // separately. New /register uses registerDeviceIdempotent directly.
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

  // Bound the persistent public-image moderation cache. Cleanup is at most once
  // per hour and piggybacks on real writes, so there is no wakeup/timer when the
  // service is idle.
  if (typeof db.saveBrowserImageModeration === 'function') {
    const originalSaveBrowserImageModeration = db.saveBrowserImageModeration.bind(db);
    db.saveBrowserImageModeration = async function saveModerationWithRetention(...args) {
      const now = Date.now();
      if (now - lastImageCacheCleanupAt >= IMAGE_CACHE_CLEANUP_INTERVAL_MS) {
        lastImageCacheCleanupAt = now;
        await ready;
        await pool.query(
          `DELETE FROM browser_image_moderation_cache
            WHERE checked_at < now() - ($1 * interval '1 day')`,
          [IMAGE_CACHE_RETENTION_DAYS],
        );
      }
      return originalSaveBrowserImageModeration(...args);
    };
  }

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
