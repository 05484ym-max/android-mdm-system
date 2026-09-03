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
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS play_version TEXT;
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS play_updated_at BIGINT;
-- Bookkeeping for the refresh-play-metadata backfill only - never exposed to
-- devices. checked_at is stamped on every attempt, success or failure, so a
-- package that keeps failing still cycles to the back of the refresh queue
-- instead of being retried forever while other apps that were never even
-- attempted starve behind it.
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS play_metadata_checked_at BIGINT;
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS play_metadata_error TEXT;

-- App-store organization (categories/search/recommended/sort - see
-- docs/app-store-catalog.md). All additive, all backed by a safe default so
-- every pre-existing row keeps working with no backfill required:
--   category defaults to 'other' ("אחר") - the API/sync layer never returns
--   a null category. category_source tracks who last set it, so an admin's
--   manual choice (see updateAppCatalogMeta) is never silently overwritten
--   by a later Play metadata refresh (see addAppToCatalog's ON CONFLICT).
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS category_source TEXT NOT NULL DEFAULT 'DEFAULT'
  CHECK (category_source IN ('MANUAL', 'PLAY', 'DEFAULT'));
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Persistent APK upload. Additive defaults preserve every existing Play row.
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS apk_url TEXT;
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS apk_sha256 TEXT;
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS apk_size_bytes BIGINT;
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS apk_storage_key TEXT;
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS apk_icon_storage_key TEXT;
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS app_source TEXT NOT NULL DEFAULT 'PLAY'
  CHECK (app_source IN ('PLAY', 'APK'));
ALTER TABLE apps_catalog ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ;

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
-- DRY-RUN report only (see PolicyEnforcer.kt) - packages with no launcher
-- entry that a future policy change closing that gap would hide; nothing
-- reads this back to actually hide anything today.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS no_launcher_dry_run JSONB;

-- Private DNS filtering (see AdBlockDns.kt). dns_desired_provider_host/
-- dns_filtering_requested are written the instant an admin queues ENABLE/
-- DISABLE_DNS_FILTERING or a customer's own toggle is honored (see
-- setDnsDesiredState) - server-owned, never touched by recordDeviceHealth.
-- dns_actual_provider_host/dns_filtering_actual/dns_mode are the device's own
-- confirmed report instead, written only by recordDeviceHealth. Kept as two
-- separate pairs of columns on purpose: a single shared pair previously let a
-- device's own status report overwrite what an admin had just asked for,
-- before the device even had a chance to apply it.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS dns_mode TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS dns_desired_provider_host TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS dns_actual_provider_host TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS dns_filtering_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS dns_filtering_actual BOOLEAN;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS dns_fail_safe_state TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS dns_resolution_ok BOOLEAN;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS dot_provider_reachable BOOLEAN;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS current_network_type TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS consecutive_dns_failures INTEGER;
-- Epoch millis as reported by the device (same convention as apps_catalog's
-- play_updated_at) rather than TIMESTAMPTZ, since these three come straight
-- from the device's own System.currentTimeMillis(), not a server-side now().
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_dns_check_at BIGINT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_dns_mode_change_at BIGINT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_rollback_at BIGINT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS dns_failure_reason TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS previous_dns_mode TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS allow_customer_dns_toggle BOOLEAN NOT NULL DEFAULT false;

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

-- Customer-facing "News & Updates" feed. Brand-new, additive table - no
-- existing table or column is touched. id is backend-generated
-- (crypto.randomUUID(), same convention as commands.id/alerts.id above -
-- no pgcrypto extension dependency). published/pinned both default to the
-- safe "not visible to any device yet" state so a row can never become
-- customer-visible except through an explicit admin action.
CREATE TABLE IF NOT EXISTS customer_updates (
  id                UUID PRIMARY KEY,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  published         BOOLEAN NOT NULL DEFAULT false,
  pinned            BOOLEAN NOT NULL DEFAULT false,
  media_type        TEXT,
  media_url         TEXT,
  media_storage_key TEXT,
  media_mime_type   TEXT,
  media_size_bytes  BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at      TIMESTAMPTZ
);

-- Existing deployments created customer_updates before media support.
ALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS media_storage_key TEXT;
ALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS media_mime_type TEXT;
ALTER TABLE customer_updates ADD COLUMN IF NOT EXISTS media_size_bytes BIGINT;

-- Matches the device-facing query's own WHERE/ORDER BY exactly (see
-- listPublishedCustomerUpdatesForDevice) - a partial index over only the
-- published rows a device can ever see, pre-sorted the same way.
CREATE INDEX IF NOT EXISTS customer_updates_published_idx
  ON customer_updates (pinned DESC, published_at DESC, created_at DESC)
  WHERE published = true;
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
    // Just the server-owned desired-state slice, needed by the /sync route to
    // build the "dns" object it sends down - the device-reported half (mode,
    // actual, fail-safe state...) lives only in the health-dashboard shape
    // (see mapHealthRow), not here.
    dnsDesiredProviderHost: row.dns_desired_provider_host,
    dnsFilteringRequested: row.dns_filtering_requested,
    allowCustomerDnsToggle: row.allow_customer_dns_toggle,
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

const setAllowCustomerDnsToggle = (deviceId, allow) =>
  updateDeviceField(deviceId, 'allow_customer_dns_toggle', allow);

/**
 * Written the moment an admin queues ENABLE/DISABLE_DNS_FILTERING, or a
 * customer's own in-app toggle is honored (see index.js) - the "desired"
 * side only. dns_actual_provider_host/dns_filtering_actual are a completely
 * separate pair of columns, written only by recordDeviceHealth() from the
 * device's own confirmed report - this function never touches them, so a
 * device's status report can never clobber what was just asked of it here.
 * providerHost is left untouched on a disable (there's nothing to clear it
 * to - the next enable reuses whatever was last set).
 */
async function setDnsDesiredState(deviceId, providerHost, filteringRequested) {
  const { rows } = await pool.query(
    `UPDATE devices SET
        dns_desired_provider_host = COALESCE($2, dns_desired_provider_host),
        dns_filtering_requested = $3
      WHERE device_id = $1 RETURNING *`,
    [deviceId, providerHost || null, filteringRequested],
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
        manufacturer = COALESCE($10, manufacturer),
        no_launcher_dry_run = COALESCE($11::jsonb, no_launcher_dry_run),
        dns_mode = COALESCE($12::text, dns_mode),
        dns_actual_provider_host = COALESCE($13::text, dns_actual_provider_host),
        dns_filtering_actual = COALESCE($14::boolean, dns_filtering_actual),
        dns_fail_safe_state = COALESCE($15::text, dns_fail_safe_state),
        dns_resolution_ok = COALESCE($16::boolean, dns_resolution_ok),
        dot_provider_reachable = COALESCE($17::boolean, dot_provider_reachable),
        current_network_type = COALESCE($18::text, current_network_type),
        consecutive_dns_failures = COALESCE($19::int, consecutive_dns_failures),
        last_dns_check_at = COALESCE($20::bigint, last_dns_check_at),
        last_dns_mode_change_at = COALESCE($21::bigint, last_dns_mode_change_at),
        last_rollback_at = COALESCE($22::bigint, last_rollback_at),
        dns_failure_reason = COALESCE($23::text, dns_failure_reason),
        previous_dns_mode = COALESCE($24::text, previous_dns_mode)
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
      fields.wouldHideNoLauncherPackages != null
        ? JSON.stringify(fields.wouldHideNoLauncherPackages)
        : null,
      fields.dnsMode ?? null,
      fields.dnsActualProviderHost ?? null,
      fields.dnsFilteringActual ?? null,
      fields.dnsFailSafeState ?? null,
      fields.dnsResolutionOk ?? null,
      fields.dotProviderReachable ?? null,
      fields.currentNetworkType ?? null,
      fields.consecutiveDnsFailures ?? null,
      fields.lastDnsCheckAt ?? null,
      fields.lastDnsModeChangeAt ?? null,
      fields.lastRollbackAt ?? null,
      fields.failureReason ?? null,
      fields.previousDnsMode ?? null,
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
            last_update_error, battery_level, free_storage_bytes, manufacturer, no_launcher_dry_run,
            dns_mode, dns_desired_provider_host, dns_actual_provider_host,
            dns_filtering_requested, dns_filtering_actual,
            dns_fail_safe_state, dns_resolution_ok, dot_provider_reachable, current_network_type,
            consecutive_dns_failures, last_dns_check_at, last_dns_mode_change_at, last_rollback_at,
            dns_failure_reason, previous_dns_mode, allow_customer_dns_toggle`;

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
    wouldHideNoLauncherPackages: row.no_launcher_dry_run || null,
    dnsMode: row.dns_mode,
    dnsDesiredProviderHost: row.dns_desired_provider_host,
    dnsActualProviderHost: row.dns_actual_provider_host,
    dnsFilteringRequested: row.dns_filtering_requested,
    dnsFilteringActual: row.dns_filtering_actual,
    dnsFailSafeState: row.dns_fail_safe_state,
    dnsResolutionOk: row.dns_resolution_ok,
    dotProviderReachable: row.dot_provider_reachable,
    currentNetworkType: row.current_network_type,
    consecutiveDnsFailures: row.consecutive_dns_failures,
    // BIGINT columns come back from node-postgres as strings - same
    // Number() conversion already used for apps_catalog.play_updated_at.
    lastDnsCheckAt: row.last_dns_check_at != null ? Number(row.last_dns_check_at) : null,
    lastDnsModeChangeAt: row.last_dns_mode_change_at != null ? Number(row.last_dns_mode_change_at) : null,
    lastRollbackAt: row.last_rollback_at != null ? Number(row.last_rollback_at) : null,
    dnsFailureReason: row.dns_failure_reason,
    previousDnsMode: row.previous_dns_mode,
    allowCustomerDnsToggle: row.allow_customer_dns_toggle,
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

function mapCatalogRow(row) {
  return {
    packageName: row.package_name,
    name: row.name,
    iconUrl: row.icon_url,
    playVersion: row.play_version,
    // play_updated_at is BIGINT - node-postgres returns int8 columns as
    // strings by default (to avoid silent precision loss on values beyond
    // Number.MAX_SAFE_INTEGER), so this must be explicitly converted or the
    // JSON response would send a quoted string instead of a number. A Unix
    // millisecond timestamp is nowhere near unsafe-integer range.
    playUpdatedAt: row.play_updated_at != null ? Number(row.play_updated_at) : null,
    addedAt: row.added_at.toISOString(),
    category: row.category,
    // Admin-panel-only (never sent to devices - see the /sync route in
    // index.js, which picks specific fields off this object rather than
    // spreading it) - lets the catalog UI show "אוטומטי"/"ידני" and know
    // whether it's safe to silently refresh a category later.
    categorySource: row.category_source,
    isRecommended: row.is_recommended,
    sortOrder: row.sort_order,
    appSource: row.app_source,
    apkUrl: row.apk_url,
    apkSha256: row.apk_sha256,
    apkSizeBytes: row.apk_size_bytes != null ? Number(row.apk_size_bytes) : null,
    apkStorageKey: row.apk_storage_key,
    apkIconStorageKey: row.apk_icon_storage_key,
    uploadedAt: row.uploaded_at ? row.uploaded_at.toISOString() : null,
  };
}

async function listAppsCatalog() {
  const { rows } = await pool.query(
    `SELECT package_name, name, icon_url, play_version, play_updated_at, added_at,
            category, category_source, is_recommended, sort_order,
            app_source, apk_url, apk_sha256, apk_size_bytes, apk_storage_key, apk_icon_storage_key, uploaded_at
       FROM apps_catalog
      ORDER BY sort_order ASC, name ASC`,
  );
  return rows.map(mapCatalogRow);
}

/**
 * Pure data upsert - deliberately knows nothing about whether a Play
 * metadata *check* happened or succeeded (see recordPlayMetadataCheckSuccess/
 * Failure for that, which the refresh-play-metadata endpoint calls
 * separately). Used both for a plain manual add (playVersion/playUpdatedAt
 * left at their null defaults) and for writing down what a successful Play
 * fetch returned - COALESCE keeps whatever real metadata a package already
 * had instead of wiping it out when called with nulls.
 *
 * `category` is only ever a *suggestion* from this call site (Play's
 * genreId, mapped by appCategories.categoryFromPlayGenreId - see
 * playStoreSearch.js) - never trusted over an admin's own manual choice.
 * The CASE branches below are what make "manual override always wins, and
 * is never silently overwritten by a later Play metadata refresh" actually
 * true at the database level rather than just a convention call sites have
 * to remember: once category_source is 'MANUAL', this function can never
 * change category or category_source again for that row, regardless of
 * what `category` it's called with. A first insert with no suggestion
 * (category null) defaults to 'other'/'DEFAULT', matching "no reliable
 * category available -> אחר".
 */
async function addAppToCatalog(packageName, name, iconUrl, playVersion = null, playUpdatedAt = null, category = null) {
  await pool.query(
    `INSERT INTO apps_catalog (package_name, name, icon_url, play_version, play_updated_at, category, category_source)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'other'), CASE WHEN $6 IS NOT NULL THEN 'PLAY' ELSE 'DEFAULT' END)
     ON CONFLICT (package_name) DO UPDATE SET
       name = $2,
       icon_url = $3,
       play_version = COALESCE($4, apps_catalog.play_version),
       play_updated_at = COALESCE($5, apps_catalog.play_updated_at),
       category = CASE
         WHEN apps_catalog.category_source = 'MANUAL' THEN apps_catalog.category
         ELSE COALESCE($6, apps_catalog.category)
       END,
       category_source = CASE
         WHEN apps_catalog.category_source = 'MANUAL' THEN apps_catalog.category_source
         WHEN $6 IS NOT NULL THEN 'PLAY'
         ELSE apps_catalog.category_source
       END`,
    [packageName, name, iconUrl || null, playVersion, playUpdatedAt, category],
  );
}

async function insertUploadedApp({
  packageName, name, category, iconUrl, apkUrl, apkSha256, apkSizeBytes,
  apkStorageKey, apkIconStorageKey,
}) {
  const { rows } = await pool.query(
    `INSERT INTO apps_catalog
       (package_name, name, icon_url, category, category_source, app_source,
        apk_url, apk_sha256, apk_size_bytes, apk_storage_key, apk_icon_storage_key, uploaded_at)
     VALUES ($1, $2, $3, COALESCE($4, 'other'), CASE WHEN $4 IS NOT NULL THEN 'MANUAL' ELSE 'DEFAULT' END,
             'APK', $5, $6, $7, $8, $9, now())
     ON CONFLICT (package_name) DO UPDATE SET
       name = $2,
       icon_url = COALESCE($3, apps_catalog.icon_url),
       category = CASE WHEN $4 IS NOT NULL THEN $4 ELSE apps_catalog.category END,
       category_source = CASE WHEN $4 IS NOT NULL THEN 'MANUAL' ELSE apps_catalog.category_source END,
       app_source = 'APK',
       apk_url = $5,
       apk_sha256 = $6,
       apk_size_bytes = $7,
       apk_storage_key = $8,
       apk_icon_storage_key = COALESCE($9, apps_catalog.apk_icon_storage_key),
       uploaded_at = now()
     RETURNING *`,
    [
      packageName, name, iconUrl || null, category || null, apkUrl, apkSha256,
      apkSizeBytes, apkStorageKey, apkIconStorageKey || null,
    ],
  );
  return mapCatalogRow(rows[0]);
}

/**
 * Admin-driven catalog metadata update (category/recommended/sort_order),
 * all three optional and independent - the admin panel can flip
 * "מומלצת" without touching category, or vice versa. Setting `category`
 * here always stamps category_source = 'MANUAL', which is what makes this
 * the one write path that permanently opts a row out of ever being
 * auto-updated by a later Play metadata refresh (see addAppToCatalog).
 * Category key validity is checked by the caller (index.js, against
 * appCategories.isValidCategoryKey) - this function trusts its args, same
 * as every other db.js function that takes already-validated input.
 * Returns the updated row, or null if no such package exists.
 */
async function updateAppCatalogMeta(packageName, { category, isRecommended, sortOrder } = {}) {
  const sets = [];
  const params = [packageName];
  if (category !== undefined) {
    params.push(category);
    sets.push(`category = $${params.length}`, `category_source = 'MANUAL'`);
  }
  if (isRecommended !== undefined) {
    params.push(isRecommended);
    sets.push(`is_recommended = $${params.length}`);
  }
  if (sortOrder !== undefined) {
    params.push(sortOrder);
    sets.push(`sort_order = $${params.length}`);
  }
  if (!sets.length) {
    const { rows } = await pool.query(`SELECT * FROM apps_catalog WHERE package_name = $1`, [packageName]);
    return rows[0] ? mapCatalogRow(rows[0]) : null;
  }
  const { rows } = await pool.query(
    `UPDATE apps_catalog SET ${sets.join(', ')} WHERE package_name = $1 RETURNING *`,
    params,
  );
  return rows[0] ? mapCatalogRow(rows[0]) : null;
}

/**
 * Global removal of a catalog app (see DELETE /api/apps/:packageName) - the
 * entire PostgreSQL side of that operation (reading the row's storage
 * metadata, stripping the package from every device policy that has it
 * allowed, and deleting the catalog row) happens inside ONE transaction, so
 * a crash or error partway through can never leave the database in a mixed
 * state (e.g. removed from some devices' policies but not the catalog, or
 * vice versa).
 *
 * `SELECT ... FOR UPDATE` locks the catalog row for the duration of the
 * transaction, so a concurrent delete of the same package blocks until this
 * one commits (and then correctly finds nothing left to delete) rather than
 * racing to read stale metadata. The devices UPDATE uses jsonb operators
 * (`?` to find only devices that actually have this package allowed, `-` to
 * remove it from the array) so the affected-devices set and the write are
 * the same query - no separate read-then-write gap there either.
 *
 * Returns null if no such package existed (caller 404s, nothing at all is
 * touched). On success, returns:
 *   - deletedApp: the removed row's full metadata (appSource/apkStorageKey/
 *     apkIconStorageKey/...), needed for GitHub Release asset cleanup
 *   - affectedDevices: [{ deviceId, pushToken }] for every device whose
 *     policy had this package allowed - already stripped and committed
 *   - devicesUpdated: affectedDevices.length
 *
 * Waking those devices and any GitHub Release cleanup are deliberately NOT
 * part of this transaction (neither is something Postgres can roll back,
 * and a push failure must never undo an already-committed deletion) - see
 * the caller in index.js, which only does that work after this resolves.
 */
// Test-only injection point for deleteAppFromCatalogAtomic (see its own
// comment) - defaults to null (no-op). Only ever set by
// setDeleteAppFromCatalogAtomicTestHook, itself only ever called from test
// files, never from application code.
let deleteAppFromCatalogAtomicTestHook = null;
function setDeleteAppFromCatalogAtomicTestHook(fn) {
  deleteAppFromCatalogAtomicTestHook = fn;
}

async function deleteAppFromCatalogAtomic(packageName) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: catalogRows } = await client.query(
      `SELECT * FROM apps_catalog WHERE package_name = $1 FOR UPDATE`,
      [packageName],
    );
    if (!catalogRows.length) {
      await client.query('ROLLBACK');
      return null;
    }

    const { rows: deviceRows } = await client.query(
      `UPDATE devices
          SET policy = jsonb_set(policy, '{allowedApps}', (policy->'allowedApps') - $1::text)
        WHERE policy->'allowedApps' ? $1::text
        RETURNING device_id, push_token`,
      [packageName],
    );

    // Test-only injection point (see setDeleteAppFromCatalogAtomicTestHook
    // below) - lets the integration suite prove a genuine failure landing
    // between the devices UPDATE and the catalog DELETE really rolls back
    // the whole transaction, without mocking any of the SQL/transaction
    // logic above or below. A no-op in every real (non-test-configured)
    // call.
    if (deleteAppFromCatalogAtomicTestHook) await deleteAppFromCatalogAtomicTestHook();

    await client.query(`DELETE FROM apps_catalog WHERE package_name = $1`, [packageName]);

    await client.query('COMMIT');

    return {
      deletedApp: mapCatalogRow(catalogRows[0]),
      affectedDevices: deviceRows.map(r => ({ deviceId: r.device_id, pushToken: r.push_token })),
      devicesUpdated: deviceRows.length,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Starvation-safe candidate list for the refresh-play-metadata backfill:
 * apps that have never been checked sort first (NULLS FIRST), then whichever
 * was checked longest ago. Every attempt - success or failure, and a success
 * that got no play_updated_at from Google is still a success - stamps
 * play_metadata_checked_at (see recordPlayMetadataCheckSuccess/Failure), so
 * a package can never be reselected here indefinitely while others that
 * were never attempted wait behind it. Deliberately does NOT exclude a
 * package just because it was already checked - a package Google never
 * gives a real updated timestamp for is expected to stay in this pool
 * forever (there is no reliable signal to ever satisfy play_updated_at IS
 * NOT NULL for it), it just cycles to the back of the queue each time
 * instead of being retried immediately.
 */
async function listAppsPendingPlayMetadataRefresh(limit) {
  const { rows } = await pool.query(
    `SELECT package_name FROM apps_catalog
      WHERE play_updated_at IS NULL
      ORDER BY play_metadata_checked_at ASC NULLS FIRST
      LIMIT $1`,
    [limit],
  );
  return rows.map(row => row.package_name);
}

async function claimAppsForPlayMetadataRefresh(cutoffMs, limit) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT package_name
         FROM apps_catalog
        WHERE play_metadata_checked_at IS NULL
           OR play_metadata_checked_at < $1
        ORDER BY play_metadata_checked_at ASC NULLS FIRST, added_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2`,
      [cutoffMs, limit],
    );

    const packages = rows.map(row => row.package_name);
    if (packages.length) {
      // Lease the claimed rows immediately. Other server instances will skip
      // them until the freshness window expires, preventing a fleet-wide sync
      // burst from causing duplicate Google Play lookups.
      await client.query(
        `UPDATE apps_catalog
            SET play_metadata_checked_at = $2
          WHERE package_name = ANY($1::text[])`,
        [packages, Date.now()],
      );
    }

    await client.query('COMMIT');
    return packages;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Records that a Play metadata fetch *succeeded*, independent of whether
 * Google actually returned a usable play_updated_at for this package -
 * "the check ran and returned real data" and "Google gave us a timestamp"
 * are two different facts, and only this function's own call (not the
 * presence of a timestamp) is allowed to mean the former. Never touches
 * name/icon/version/updated - addAppToCatalog already wrote those from the
 * same fetch; this only clears a stale error and stamps checked_at so the
 * starvation-safe ordering above sees this package as freshly checked.
 */
async function recordPlayMetadataCheckSuccess(packageName) {
  await pool.query(
    `UPDATE apps_catalog SET play_metadata_checked_at = $2, play_metadata_error = NULL
      WHERE package_name = $1`,
    [packageName, Date.now()],
  );
}

/** Records a failed Play metadata fetch attempt - never touches existing
 * name/icon/version/updated, only marks that a check happened just now and
 * why, so the starvation-safe ordering above sees this package as
 * "recently checked" on the next call. errorMessage is assumed already
 * truncated to a reasonable length by the caller (a scraper failure message,
 * never a full stack trace). */
async function recordPlayMetadataCheckFailure(packageName, errorMessage) {
  await pool.query(
    `UPDATE apps_catalog SET play_metadata_checked_at = $2, play_metadata_error = $3
      WHERE package_name = $1`,
    [packageName, Date.now(), errorMessage || null],
  );
}

/** Reliable "how many still need a refresh" count, computed fresh from the
 * DB rather than derived from one batch's results - a batch that had
 * failures must not be miscounted as if those apps were resolved. Cast to
 * ::int (not the bare bigint count(*) result) so node-postgres returns a
 * real JS number, not a string. */
async function countAppsPendingPlayMetadataRefresh() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM apps_catalog WHERE play_updated_at IS NULL`,
  );
  return rows[0].count;
}

/** How many catalog apps still lack play_updated_at AND have never had a
 * Play metadata check attempted at all (success or failure) - a strict
 * subset of countAppsPendingPlayMetadataRefresh's count. Requiring both
 * conditions (not just play_metadata_checked_at IS NULL alone) excludes an
 * app that already has real metadata from some other path (a manual add
 * with real values, say) but was never itself run through this refresh
 * mechanism - that app isn't missing anything, so it must not count as
 * "still needs its first check". */
async function countAppsNeverCheckedPlayMetadata() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM apps_catalog
      WHERE play_updated_at IS NULL AND play_metadata_checked_at IS NULL`,
  );
  return rows[0].count;
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

async function deleteDevice(deviceId) {
  const { rowCount } = await pool.query(
    'DELETE FROM devices WHERE device_id = $1',
    [deviceId]
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

// ---------- customer updates ("news") ----------

function mapCustomerUpdateRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    published: row.published,
    pinned: row.pinned,
    mediaType: row.media_type || null,
    mediaUrl: row.media_url || null,
    mediaStorageKey: row.media_storage_key || null,
    mediaMimeType: row.media_mime_type || null,
    mediaSizeBytes: row.media_size_bytes == null ? null : Number(row.media_size_bytes),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
  };
}

/** Admin management list - every row (published or not), most recently
 * created first. Unlike the device-facing list below, this is not capped:
 * an admin managing the feed needs to see everything, including old
 * unpublished drafts. */
async function listCustomerUpdatesForAdmin() {
  const { rows } = await pool.query(
    `SELECT * FROM customer_updates ORDER BY created_at DESC`,
  );
  return rows.map(mapCustomerUpdateRow);
}

async function getCustomerUpdateById(id) {
  const { rows } = await pool.query(
    `SELECT * FROM customer_updates WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

/** `id` is generated by the caller (crypto.randomUUID(), see index.js) -
 * same convention as createAlert/createEnrollment above. published_at is
 * stamped immediately if the admin chooses to publish at creation time;
 * otherwise it stays null until a later explicit publish action. */
async function createCustomerUpdate(id, {
  title, body, pinned, published,
  mediaType = null, mediaUrl = null, mediaStorageKey = null,
  mediaMimeType = null, mediaSizeBytes = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO customer_updates (
       id, title, body, pinned, published, published_at,
       media_type, media_url, media_storage_key, media_mime_type, media_size_bytes
     )
     VALUES (
       $1, $2, $3, $4, $5, CASE WHEN $5 THEN now() ELSE NULL END,
       $6, $7, $8, $9, $10
     )
     RETURNING *`,
    [
      id, title, body, pinned, published,
      mediaType, mediaUrl, mediaStorageKey, mediaMimeType, mediaSizeBytes,
    ],
  );
  return mapCustomerUpdateRow(rows[0]);
}

/**
 * Partial update of title/body/pinned only - publish state changes go
 * through setCustomerUpdatePublished instead (a deliberately separate,
 * narrower write path, same "one write path per kind of change" pattern
 * already used for the app catalog's category-meta vs. Play-refresh
 * endpoints). Only the fields actually present in `patch` are touched.
 * Returns the updated row, or null if no such id exists.
 */
async function updateCustomerUpdate(id, patch) {
  const sets = ['updated_at = now()'];
  const params = [id];
  if (patch.title !== undefined) {
    params.push(patch.title);
    sets.push(`title = $${params.length}`);
  }
  if (patch.body !== undefined) {
    params.push(patch.body);
    sets.push(`body = $${params.length}`);
  }
  if (patch.pinned !== undefined) {
    params.push(patch.pinned);
    sets.push('pinned = 
  }
  for (const [field, column] of [
    ['mediaType', 'media_type'],
    ['mediaUrl', 'media_url'],
    ['mediaStorageKey', 'media_storage_key'],
    ['mediaMimeType', 'media_mime_type'],
    ['mediaSizeBytes', 'media_size_bytes'],
  ]) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      params.push(patch[field]);
      sets.push(column + ' = 
    }
  }
  const { rows } = await pool.query(
    `UPDATE customer_updates SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

/**
 * Sets published true/false. published_at is only ever advanced forward -
 * bumped to now() the moment a row transitions from unpublished to
 * published (first publish, or a republish after being hidden), and left
 * untouched by every other transition (publishing an already-published
 * row is a no-op for the timestamp; unpublishing preserves it rather than
 * erasing history). This is what "pinned first, then published_at/
 * created_at newest first" (see listPublishedCustomerUpdatesForDevice)
 * actually orders by. Returns the updated row, or null if no such id
 * exists.
 */
async function setCustomerUpdatePublished(id, published) {
  const { rows } = await pool.query(
    `UPDATE customer_updates
        SET published = $2,
            updated_at = now(),
            published_at = CASE
              WHEN $2 = true AND published = false THEN now()
              ELSE published_at
            END
      WHERE id = $1
      RETURNING *`,
    [id, published],
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

async function deleteCustomerUpdate(id) {
  const { rows } = await pool.query(
    `DELETE FROM customer_updates WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

/**
 * Device-facing feed: published only, pinned first then newest-published/
 * newest-created, capped at `limit` rows - deliberately NOT folded into
 * the main /sync payload (which every device fetches on every check-in),
 * so a growing news history never bloats that hot path. See the matching
 * partial index (customer_updates_published_idx) in SCHEMA above - this
 * query's WHERE/ORDER BY was written to match it exactly.
 */
async function listPublishedCustomerUpdatesForDevice(limit) {
  const { rows } = await pool.query(
    `SELECT id, title, body, pinned, media_type, media_url,
            media_mime_type, media_size_bytes, published_at, created_at
       FROM customer_updates
      WHERE published = true
      ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    mediaType: row.media_type || null,
    mediaUrl: row.media_url || null,
    mediaMimeType: row.media_mime_type || null,
    mediaSizeBytes: row.media_size_bytes == null ? null : Number(row.media_size_bytes),
    // Guaranteed non-null for a published row - see createCustomerUpdate/
    // setCustomerUpdatePublished, both of which always stamp published_at
    // the moment published becomes true. COALESCE above is defense in
    // depth for the ORDER BY only, not evidence this can actually be null.
    publishedAt: row.published_at ? row.published_at.toISOString() : row.created_at.toISOString(),
  }));
}

module.exports = {
  init,
  getDevice,
  listDevices,
  deleteDevice,
  generateUniqueDeviceId,
  createDevice,
  setSubscription,
  setPolicy,
  setStatus,
  setAllowCustomerDnsToggle,
  setDnsDesiredState,
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
  insertUploadedApp,
  updateAppCatalogMeta,
  deleteAppFromCatalogAtomic,
  setDeleteAppFromCatalogAtomicTestHook,
  listAppsPendingPlayMetadataRefresh,
  claimAppsForPlayMetadataRefresh,
  recordPlayMetadataCheckSuccess,
  recordPlayMetadataCheckFailure,
  countAppsPendingPlayMetadataRefresh,
  countAppsNeverCheckedPlayMetadata,
  listOpenAlertsForDevice,
  createAlert,
  resolveAlert,
  listActiveAlerts,
  listCustomerUpdatesForAdmin,
  getCustomerUpdateById,
  createCustomerUpdate,
  updateCustomerUpdate,
  setCustomerUpdatePublished,
  deleteCustomerUpdate,
  listPublishedCustomerUpdatesForDevice,
};
 + params.length);
  }
  for (const [field, column] of [
    ['mediaType', 'media_type'],
    ['mediaUrl', 'media_url'],
    ['mediaStorageKey', 'media_storage_key'],
    ['mediaMimeType', 'media_mime_type'],
    ['mediaSizeBytes', 'media_size_bytes'],
  ]) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      params.push(patch[field]);
      sets.push(`${column} = ${params.length}`);
    }
  }
  const { rows } = await pool.query(
    `UPDATE customer_updates SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

/**
 * Sets published true/false. published_at is only ever advanced forward -
 * bumped to now() the moment a row transitions from unpublished to
 * published (first publish, or a republish after being hidden), and left
 * untouched by every other transition (publishing an already-published
 * row is a no-op for the timestamp; unpublishing preserves it rather than
 * erasing history). This is what "pinned first, then published_at/
 * created_at newest first" (see listPublishedCustomerUpdatesForDevice)
 * actually orders by. Returns the updated row, or null if no such id
 * exists.
 */
async function setCustomerUpdatePublished(id, published) {
  const { rows } = await pool.query(
    `UPDATE customer_updates
        SET published = $2,
            updated_at = now(),
            published_at = CASE
              WHEN $2 = true AND published = false THEN now()
              ELSE published_at
            END
      WHERE id = $1
      RETURNING *`,
    [id, published],
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

async function deleteCustomerUpdate(id) {
  const { rows } = await pool.query(
    `DELETE FROM customer_updates WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

/**
 * Device-facing feed: published only, pinned first then newest-published/
 * newest-created, capped at `limit` rows - deliberately NOT folded into
 * the main /sync payload (which every device fetches on every check-in),
 * so a growing news history never bloats that hot path. See the matching
 * partial index (customer_updates_published_idx) in SCHEMA above - this
 * query's WHERE/ORDER BY was written to match it exactly.
 */
async function listPublishedCustomerUpdatesForDevice(limit) {
  const { rows } = await pool.query(
    `SELECT id, title, body, pinned, media_type, media_url,
            media_mime_type, media_size_bytes, published_at, created_at
       FROM customer_updates
      WHERE published = true
      ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    mediaType: row.media_type || null,
    mediaUrl: row.media_url || null,
    mediaMimeType: row.media_mime_type || null,
    mediaSizeBytes: row.media_size_bytes == null ? null : Number(row.media_size_bytes),
    // Guaranteed non-null for a published row - see createCustomerUpdate/
    // setCustomerUpdatePublished, both of which always stamp published_at
    // the moment published becomes true. COALESCE above is defense in
    // depth for the ORDER BY only, not evidence this can actually be null.
    publishedAt: row.published_at ? row.published_at.toISOString() : row.created_at.toISOString(),
  }));
}

module.exports = {
  init,
  getDevice,
  listDevices,
  deleteDevice,
  generateUniqueDeviceId,
  createDevice,
  setSubscription,
  setPolicy,
  setStatus,
  setAllowCustomerDnsToggle,
  setDnsDesiredState,
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
  insertUploadedApp,
  updateAppCatalogMeta,
  deleteAppFromCatalogAtomic,
  setDeleteAppFromCatalogAtomicTestHook,
  listAppsPendingPlayMetadataRefresh,
  claimAppsForPlayMetadataRefresh,
  recordPlayMetadataCheckSuccess,
  recordPlayMetadataCheckFailure,
  countAppsPendingPlayMetadataRefresh,
  countAppsNeverCheckedPlayMetadata,
  listOpenAlertsForDevice,
  createAlert,
  resolveAlert,
  listActiveAlerts,
  listCustomerUpdatesForAdmin,
  getCustomerUpdateById,
  createCustomerUpdate,
  updateCustomerUpdate,
  setCustomerUpdatePublished,
  deleteCustomerUpdate,
  listPublishedCustomerUpdatesForDevice,
};
 + params.length);
    }
  }
  const { rows } = await pool.query(
    `UPDATE customer_updates SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

/**
 * Sets published true/false. published_at is only ever advanced forward -
 * bumped to now() the moment a row transitions from unpublished to
 * published (first publish, or a republish after being hidden), and left
 * untouched by every other transition (publishing an already-published
 * row is a no-op for the timestamp; unpublishing preserves it rather than
 * erasing history). This is what "pinned first, then published_at/
 * created_at newest first" (see listPublishedCustomerUpdatesForDevice)
 * actually orders by. Returns the updated row, or null if no such id
 * exists.
 */
async function setCustomerUpdatePublished(id, published) {
  const { rows } = await pool.query(
    `UPDATE customer_updates
        SET published = $2,
            updated_at = now(),
            published_at = CASE
              WHEN $2 = true AND published = false THEN now()
              ELSE published_at
            END
      WHERE id = $1
      RETURNING *`,
    [id, published],
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

async function deleteCustomerUpdate(id) {
  const { rows } = await pool.query(
    `DELETE FROM customer_updates WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

/**
 * Device-facing feed: published only, pinned first then newest-published/
 * newest-created, capped at `limit` rows - deliberately NOT folded into
 * the main /sync payload (which every device fetches on every check-in),
 * so a growing news history never bloats that hot path. See the matching
 * partial index (customer_updates_published_idx) in SCHEMA above - this
 * query's WHERE/ORDER BY was written to match it exactly.
 */
async function listPublishedCustomerUpdatesForDevice(limit) {
  const { rows } = await pool.query(
    `SELECT id, title, body, pinned, media_type, media_url,
            media_mime_type, media_size_bytes, published_at, created_at
       FROM customer_updates
      WHERE published = true
      ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    mediaType: row.media_type || null,
    mediaUrl: row.media_url || null,
    mediaMimeType: row.media_mime_type || null,
    mediaSizeBytes: row.media_size_bytes == null ? null : Number(row.media_size_bytes),
    // Guaranteed non-null for a published row - see createCustomerUpdate/
    // setCustomerUpdatePublished, both of which always stamp published_at
    // the moment published becomes true. COALESCE above is defense in
    // depth for the ORDER BY only, not evidence this can actually be null.
    publishedAt: row.published_at ? row.published_at.toISOString() : row.created_at.toISOString(),
  }));
}

module.exports = {
  init,
  getDevice,
  listDevices,
  deleteDevice,
  generateUniqueDeviceId,
  createDevice,
  setSubscription,
  setPolicy,
  setStatus,
  setAllowCustomerDnsToggle,
  setDnsDesiredState,
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
  insertUploadedApp,
  updateAppCatalogMeta,
  deleteAppFromCatalogAtomic,
  setDeleteAppFromCatalogAtomicTestHook,
  listAppsPendingPlayMetadataRefresh,
  claimAppsForPlayMetadataRefresh,
  recordPlayMetadataCheckSuccess,
  recordPlayMetadataCheckFailure,
  countAppsPendingPlayMetadataRefresh,
  countAppsNeverCheckedPlayMetadata,
  listOpenAlertsForDevice,
  createAlert,
  resolveAlert,
  listActiveAlerts,
  listCustomerUpdatesForAdmin,
  getCustomerUpdateById,
  createCustomerUpdate,
  updateCustomerUpdate,
  setCustomerUpdatePublished,
  deleteCustomerUpdate,
  listPublishedCustomerUpdatesForDevice,
};
 + params.length);
  }
  for (const [field, column] of [
    ['mediaType', 'media_type'],
    ['mediaUrl', 'media_url'],
    ['mediaStorageKey', 'media_storage_key'],
    ['mediaMimeType', 'media_mime_type'],
    ['mediaSizeBytes', 'media_size_bytes'],
  ]) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      params.push(patch[field]);
      sets.push(`${column} = ${params.length}`);
    }
  }
  const { rows } = await pool.query(
    `UPDATE customer_updates SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

/**
 * Sets published true/false. published_at is only ever advanced forward -
 * bumped to now() the moment a row transitions from unpublished to
 * published (first publish, or a republish after being hidden), and left
 * untouched by every other transition (publishing an already-published
 * row is a no-op for the timestamp; unpublishing preserves it rather than
 * erasing history). This is what "pinned first, then published_at/
 * created_at newest first" (see listPublishedCustomerUpdatesForDevice)
 * actually orders by. Returns the updated row, or null if no such id
 * exists.
 */
async function setCustomerUpdatePublished(id, published) {
  const { rows } = await pool.query(
    `UPDATE customer_updates
        SET published = $2,
            updated_at = now(),
            published_at = CASE
              WHEN $2 = true AND published = false THEN now()
              ELSE published_at
            END
      WHERE id = $1
      RETURNING *`,
    [id, published],
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

async function deleteCustomerUpdate(id) {
  const { rows } = await pool.query(
    `DELETE FROM customer_updates WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? mapCustomerUpdateRow(rows[0]) : null;
}

/**
 * Device-facing feed: published only, pinned first then newest-published/
 * newest-created, capped at `limit` rows - deliberately NOT folded into
 * the main /sync payload (which every device fetches on every check-in),
 * so a growing news history never bloats that hot path. See the matching
 * partial index (customer_updates_published_idx) in SCHEMA above - this
 * query's WHERE/ORDER BY was written to match it exactly.
 */
async function listPublishedCustomerUpdatesForDevice(limit) {
  const { rows } = await pool.query(
    `SELECT id, title, body, pinned, media_type, media_url,
            media_mime_type, media_size_bytes, published_at, created_at
       FROM customer_updates
      WHERE published = true
      ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    mediaType: row.media_type || null,
    mediaUrl: row.media_url || null,
    mediaMimeType: row.media_mime_type || null,
    mediaSizeBytes: row.media_size_bytes == null ? null : Number(row.media_size_bytes),
    // Guaranteed non-null for a published row - see createCustomerUpdate/
    // setCustomerUpdatePublished, both of which always stamp published_at
    // the moment published becomes true. COALESCE above is defense in
    // depth for the ORDER BY only, not evidence this can actually be null.
    publishedAt: row.published_at ? row.published_at.toISOString() : row.created_at.toISOString(),
  }));
}

module.exports = {
  init,
  getDevice,
  listDevices,
  deleteDevice,
  generateUniqueDeviceId,
  createDevice,
  setSubscription,
  setPolicy,
  setStatus,
  setAllowCustomerDnsToggle,
  setDnsDesiredState,
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
  insertUploadedApp,
  updateAppCatalogMeta,
  deleteAppFromCatalogAtomic,
  setDeleteAppFromCatalogAtomicTestHook,
  listAppsPendingPlayMetadataRefresh,
  claimAppsForPlayMetadataRefresh,
  recordPlayMetadataCheckSuccess,
  recordPlayMetadataCheckFailure,
  countAppsPendingPlayMetadataRefresh,
  countAppsNeverCheckedPlayMetadata,
  listOpenAlertsForDevice,
  createAlert,
  resolveAlert,
  listActiveAlerts,
  listCustomerUpdatesForAdmin,
  getCustomerUpdateById,
  createCustomerUpdate,
  updateCustomerUpdate,
  setCustomerUpdatePublished,
  deleteCustomerUpdate,
  listPublishedCustomerUpdatesForDevice,
};
