const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true },
  max: 5,
});

// Without this, an idle pooled client that the database drops (a restart,
// a network blip, an admin killing the connection) fires an 'error' event
// with no listener - Node's default behavior for that is to crash the
// entire process (see the 'pg' library's own docs: "you should always add
// an error listener"). That takes down every endpoint, not just whichever
// query was unlucky enough to be running - verified for real in Phase 2.3
// by stopping Postgres under a live server and watching it exit. A brief
// query-level failure (each call site already handles/propagates its own
// error into a 500 - see wrap() in index.js) is the fail-closed outcome
// this is supposed to produce; the process itself must stay up.
pool.on('error', err => {
  console.error('Unexpected error on an idle PostgreSQL client:', err.message);
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

-- ---------- Filtered Browser: Browser Policy foundation (Phase 1) ----------
-- See /docs/server-api-contract.md for the full contract with the Android
-- client. decision/resolution values are frozen to ALLOW/BLOCK/REVIEW across
-- the whole cross-team protocol - never add a fourth value here without
-- updating that doc and the client's requirements doc first.
--
-- browser_domains is the GLOBAL, admin-owned policy: a domain with no row
-- here has no decision at all (evaluates to REVIEW at request time, see
-- browserPolicy.js) - there is deliberately no "unset = allowed" path.
-- allow_subdomains is opt-in per row, never implied by an exact-match
-- approval (a domain approved for evil.example.com must not also cover
-- shared-hosting subdomains an admin never reviewed).
CREATE TABLE IF NOT EXISTS browser_domains (
  domain            TEXT PRIMARY KEY,
  decision          TEXT NOT NULL DEFAULT 'REVIEW'
                      CHECK (decision IN ('ALLOW', 'BLOCK', 'REVIEW')),
  allow_subdomains  BOOLEAN NOT NULL DEFAULT false,
  category          TEXT,
  risk_score        NUMERIC,
  confidence        NUMERIC,
  source            TEXT NOT NULL DEFAULT 'admin_manual',
  approval_method   TEXT,
  reason            TEXT,
  last_checked_at   BIGINT,
  approved_at       BIGINT,
  decision_version  INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-device overrides ("approve just for this customer"). Exact-domain
-- match only in Phase 1 - a per-device approval is almost always for one
-- site a specific customer asked about, not a wildcard grant. Checked
-- before the global table (see browserPolicy.js), so a device override can
-- both loosen and tighten relative to the global decision.
CREATE TABLE IF NOT EXISTS browser_device_overrides (
  device_id   TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  domain      TEXT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('ALLOW', 'BLOCK')),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, domain)
);

-- One open (PENDING) request per domain at a time - the partial unique
-- index is what gives "one analyzer/admin job per domain" even if hundreds
-- of devices hit an unknown domain at once (thundering-herd protection):
-- concurrent first-seen requests collapse into the same row via
-- ON CONFLICT DO NOTHING (see recordBrowserRequest), instead of creating a
-- duplicate row per requester.
CREATE TABLE IF NOT EXISTS browser_requests (
  id                  UUID PRIMARY KEY,
  domain              TEXT NOT NULL,
  first_url           TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'RESOLVED')),
  resolution_scope    TEXT CHECK (resolution_scope IN ('GLOBAL', 'DEVICE')),
  resolution_decision TEXT CHECK (resolution_decision IN ('ALLOW', 'BLOCK')),
  category            TEXT,
  risk_score          NUMERIC,
  confidence          NUMERIC,
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS browser_requests_pending_domain_idx
  ON browser_requests (domain) WHERE status = 'PENDING';

-- Distinct requesting devices per request, for the admin panel's "how many
-- users asked for this" count - a plain counter column would double-count
-- the same device re-triggering a request (e.g. retrying after "site under
-- review").
-- decision/resolved_at are per-DEVICE resolution state (Phase 2) - a
-- request shared by several devices must let an admin resolve it for ONE
-- device (DEVICE scope) without silently closing it out for the others
-- still waiting. NULL decision = this device is still pending. The parent
-- browser_requests row only flips to RESOLVED via DEVICE scope once every
-- sibling row here has a non-null decision (see resolveBrowserRequest);
-- a GLOBAL resolution sets decision on every row here directly, since a
-- global rule genuinely does answer every device's request at once.
CREATE TABLE IF NOT EXISTS browser_request_devices (
  request_id  UUID NOT NULL REFERENCES browser_requests(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, device_id)
);

-- Added in Phase 2 - CREATE TABLE IF NOT EXISTS above is a no-op against a
-- database that already ran it in Phase 1, so these columns need their own
-- explicit migration (same convention as every other table in this file).
ALTER TABLE browser_request_devices
  ADD COLUMN IF NOT EXISTS decision TEXT CHECK (decision IN ('ALLOW', 'BLOCK'));
ALTER TABLE browser_request_devices ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Every /browser/check outcome, for audit and for building real reputation
-- signal later (Phase 3+) - append-only, never updated.
CREATE TABLE IF NOT EXISTS browser_decision_log (
  id          UUID PRIMARY KEY,
  device_id   TEXT,
  domain      TEXT NOT NULL,
  url         TEXT,
  decision    TEXT NOT NULL CHECK (decision IN ('ALLOW', 'BLOCK', 'REVIEW')),
  source      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS browser_decision_log_domain_idx
  ON browser_decision_log (domain, created_at DESC);

-- Single global monotonic counter the Android client can use to detect a
-- stale/rolled-back local policy cache (policyVersion in the contract).
-- Bumped on every admin browser-policy write (see upsertBrowserDomain and
-- resolveBrowserRequest below).
CREATE TABLE IF NOT EXISTS browser_policy_meta (
  key   TEXT PRIMARY KEY,
  value BIGINT NOT NULL
);
INSERT INTO browser_policy_meta (key, value) VALUES ('policy_version', 1)
  ON CONFLICT (key) DO NOTHING;

-- ---------- Filtered Browser: Admin workflow + audit (Phase 2) ----------
-- Policy-CHANGE audit, not browsing history: one row per admin write
-- (domain upsert/delete, request resolve). Never logs a device's browsing
-- activity - that's browser_decision_log's job (Phase 1), a separate,
-- append-only table this one has nothing to do with. actor is best-effort:
-- Phase 2 has a single shared admin login (see AUTH_ENABLED/ADMIN_USERNAME
-- in index.js), not distinct per-admin accounts, so this records the
-- configured admin username from the session JWT, not a real user id.
CREATE TABLE IF NOT EXISTS browser_policy_audit (
  id                   UUID PRIMARY KEY,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor                TEXT,
  action               TEXT NOT NULL,
  domain               TEXT NOT NULL,
  scope                TEXT NOT NULL CHECK (scope IN ('GLOBAL', 'DEVICE')),
  device_id            TEXT,
  old_decision         TEXT,
  new_decision         TEXT,
  reason               TEXT,
  policy_version_after BIGINT
);

CREATE INDEX IF NOT EXISTS browser_policy_audit_domain_idx
  ON browser_policy_audit (domain, created_at DESC);
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
  };
}

async function listAppsCatalog() {
  const { rows } = await pool.query(
    `SELECT package_name, name, icon_url, play_version, play_updated_at, added_at,
            category, category_source, is_recommended, sort_order
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

// ---------- Filtered Browser: Browser Policy foundation (Phase 1) ----------

function mapBrowserDomainRow(row) {
  return {
    domain: row.domain,
    decision: row.decision,
    allowSubdomains: row.allow_subdomains,
    category: row.category,
    riskScore: row.risk_score != null ? Number(row.risk_score) : null,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    source: row.source,
    approvalMethod: row.approval_method,
    reason: row.reason,
    lastCheckedAt: row.last_checked_at != null ? Number(row.last_checked_at) : null,
    approvedAt: row.approved_at != null ? Number(row.approved_at) : null,
    decisionVersion: row.decision_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Most-specific policy row covering `host`: an exact match always wins;
 * an ancestor domain only matches when it opted into allow_subdomains
 * (see the CHECK/comment on the table). Single query, no per-label
 * round-trips - the table is small and admin-curated in Phase 1.
 */
async function getBrowserDomainForHost(host) {
  const { rows } = await pool.query(
    `SELECT * FROM browser_domains
      WHERE domain = $1 OR (allow_subdomains AND $1 LIKE '%.' || domain)
      ORDER BY length(domain) DESC
      LIMIT 1`,
    [host],
  );
  return rows[0] ? mapBrowserDomainRow(rows[0]) : null;
}

async function getBrowserDeviceOverride(deviceId, host) {
  const { rows } = await pool.query(
    `SELECT decision, reason FROM browser_device_overrides
      WHERE device_id = $1 AND domain = $2`,
    [deviceId, host],
  );
  return rows[0] || null;
}

/** search: case-insensitive substring match on the domain. decision:
 * exact filter (ALLOW/BLOCK/REVIEW). Both optional - admin panel's search
 * box and status filter (Phase 2). */
async function listBrowserDomains({ search, decision } = {}) {
  const clauses = [];
  const params = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    clauses.push(`domain LIKE $${params.length}`);
  }
  if (decision) {
    params.push(decision);
    clauses.push(`decision = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM browser_domains ${where} ORDER BY updated_at DESC LIMIT 500`,
    params,
  );
  return rows.map(mapBrowserDomainRow);
}

/** Policy-change audit row, inside the caller's existing transaction -
 * every write to browser_domains/browser_device_overrides in this file
 * writes exactly one of these in the same transaction as the write it
 * describes, so an audit entry can never exist without the change it
 * documents actually having been committed (or vice versa). This is a
 * log of POLICY changes only, never of device browsing activity - that
 * stays in browser_decision_log, a separate table this never touches. */
async function insertAuditRow(client, {
  actor, action, domain, scope, deviceId, oldDecision, newDecision, reason, policyVersionAfter,
}) {
  await client.query(
    `INSERT INTO browser_policy_audit
       (id, actor, action, domain, scope, device_id, old_decision, new_decision, reason, policy_version_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      crypto.randomUUID(), actor || null, action, domain, scope, deviceId || null,
      oldDecision || null, newDecision || null, reason || null, policyVersionAfter,
    ],
  );
}

async function listBrowserPolicyAudit({ domain, limit } = {}) {
  const clauses = [];
  const params = [];
  if (domain) {
    params.push(domain);
    clauses.push(`domain = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM browser_policy_audit ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(row => ({
    id: row.id,
    createdAt: row.created_at.toISOString(),
    actor: row.actor,
    action: row.action,
    domain: row.domain,
    scope: row.scope,
    deviceId: row.device_id,
    oldDecision: row.old_decision,
    newDecision: row.new_decision,
    reason: row.reason,
    policyVersionAfter: row.policy_version_after != null ? Number(row.policy_version_after) : null,
  }));
}

/** Direct admin decision on a domain (bypasses the request queue entirely -
 * e.g. pre-seeding a known-good/known-bad list). Bumps both the domain's own
 * decisionVersion and the global policyVersion, and writes an audit row,
 * all in the same transaction. */
async function upsertBrowserDomain({
  domain, decision, allowSubdomains, category, riskScore, confidence, reason, approvalMethod, actor,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT decision FROM browser_domains WHERE domain = $1 FOR UPDATE`,
      [domain],
    );
    const oldDecision = existing.rows[0] ? existing.rows[0].decision : null;
    const { rows } = await client.query(
      `INSERT INTO browser_domains
         (domain, decision, allow_subdomains, category, risk_score, confidence,
          source, approval_method, reason, approved_at, decision_version)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin_manual', $7, $8, $9, 1)
       ON CONFLICT (domain) DO UPDATE SET
         decision = EXCLUDED.decision,
         allow_subdomains = EXCLUDED.allow_subdomains,
         category = EXCLUDED.category,
         risk_score = EXCLUDED.risk_score,
         confidence = EXCLUDED.confidence,
         approval_method = EXCLUDED.approval_method,
         reason = EXCLUDED.reason,
         approved_at = EXCLUDED.approved_at,
         decision_version = browser_domains.decision_version + 1,
         updated_at = now()
       RETURNING *`,
      [
        domain, decision, Boolean(allowSubdomains), category || null,
        riskScore ?? null, confidence ?? null, approvalMethod || 'admin_manual',
        reason || null, Date.now(),
      ],
    );
    const { rows: metaRows } = await client.query(
      `UPDATE browser_policy_meta SET value = value + 1 WHERE key = 'policy_version' RETURNING value`,
    );
    await insertAuditRow(client, {
      actor, action: 'domain_upsert', domain, scope: 'GLOBAL',
      oldDecision, newDecision: decision, reason,
      policyVersionAfter: Number(metaRows[0].value),
    });
    await client.query('COMMIT');
    return mapBrowserDomainRow(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Deletes a global domain rule - reverts the domain to "no decision"
 * (evaluates to REVIEW again, same as if it had never been ruled on).
 * A clear, safe semantic: unlike an edit, there's no ambiguity about what
 * "delete" means here. Returns false if no such rule existed. Never
 * touches browser_device_overrides or browser_requests - deleting a
 * global rule doesn't retroactively change per-device overrides or
 * request history. */
async function deleteBrowserDomain(domain, { actor, reason } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `DELETE FROM browser_domains WHERE domain = $1 RETURNING decision`,
      [domain],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    const { rows: metaRows } = await client.query(
      `UPDATE browser_policy_meta SET value = value + 1 WHERE key = 'policy_version' RETURNING value`,
    );
    await insertAuditRow(client, {
      actor, action: 'domain_delete', domain, scope: 'GLOBAL',
      oldDecision: rows[0].decision, newDecision: null, reason,
      policyVersionAfter: Number(metaRows[0].value),
    });
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Records that some device hit an unknown domain. Collapses concurrent
 * first-seen requests for the same domain into one PENDING row (thundering-
 * herd protection - see the partial unique index on browser_requests) and
 * tracks this device as one of its distinct requesters. Returns the
 * request id, or null in the rare race where the request got resolved
 * between the failed insert and the follow-up read (the next /browser/check
 * for that domain will simply open a fresh request if it's still unknown).
 */
async function recordBrowserRequest(id, { domain, url, deviceId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO browser_requests (id, domain, first_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (domain) WHERE status = 'PENDING' DO NOTHING
       RETURNING id`,
      [id, domain, url || null],
    );
    let requestId = inserted.rows[0] ? inserted.rows[0].id : null;
    if (!requestId) {
      const existing = await client.query(
        `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`,
        [domain],
      );
      requestId = existing.rows[0] ? existing.rows[0].id : null;
    }
    if (requestId) {
      await client.query(
        `INSERT INTO browser_request_devices (request_id, device_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [requestId, deviceId],
      );
    }
    await client.query('COMMIT');
    return requestId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * requesterCount is the number of devices STILL WAITING on a decision
 * (decision IS NULL) - the operationally meaningful count for an admin
 * deciding what to do next. totalRequesterCount is everyone who ever asked
 * about this domain under this request, including any already resolved
 * individually via a prior DEVICE-scope resolution.
 */
async function listPendingBrowserRequests() {
  const { rows } = await pool.query(
    `SELECT r.*,
            COUNT(rd.device_id) FILTER (WHERE rd.decision IS NULL)::int AS pending_device_count,
            COUNT(rd.device_id)::int AS total_device_count,
            MAX(rd.created_at) AS last_requested_at
       FROM browser_requests r
       LEFT JOIN browser_request_devices rd ON rd.request_id = r.id
      WHERE r.status = 'PENDING'
      GROUP BY r.id
      ORDER BY r.created_at ASC
      LIMIT 200`,
  );
  return rows.map(row => ({
    id: row.id,
    domain: row.domain,
    exampleUrl: row.first_url,
    requesterCount: row.pending_device_count,
    totalRequesterCount: row.total_device_count,
    lastRequestedAt: row.last_requested_at ? row.last_requested_at.toISOString() : null,
    category: row.category,
    riskScore: row.risk_score != null ? Number(row.risk_score) : null,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  }));
}

/** Per-device breakdown for one request - powers the admin "open details"
 * view where a specific device is picked for a DEVICE-scope resolution.
 * decision is null for a device still waiting. */
async function listBrowserRequestDevices(requestId) {
  const { rows } = await pool.query(
    `SELECT device_id, decision, resolved_at, created_at
       FROM browser_request_devices
      WHERE request_id = $1
      ORDER BY created_at ASC`,
    [requestId],
  );
  return rows.map(row => ({
    deviceId: row.device_id,
    decision: row.decision,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  }));
}

/** Peeks at a pending request's domain without resolving it - lets the
 * caller (index.js) run Public Suffix / rule validation BEFORE committing
 * to resolve it as GLOBAL, so an invalid target rejects cleanly with the
 * request left PENDING instead of silently writing an unsafe global rule. */
async function getPendingBrowserRequestDomain(id) {
  const { rows } = await pool.query(
    `SELECT domain FROM browser_requests WHERE id = $1 AND status = 'PENDING'`,
    [id],
  );
  return rows[0] ? rows[0].domain : null;
}

/**
 * Resolves a request either globally or for one device - see db.js's
 * comment on browser_request_devices for the full model. The critical
 * property: a request shared by several devices is NEVER silently closed
 * out for devices still waiting just because one of them got a DEVICE-
 * scope decision.
 *
 * GLOBAL: writes/updates browser_domains, stamps every still-pending
 * sibling device row with the same decision (a global rule genuinely does
 * answer everyone who was waiting), closes the request, bumps
 * policyVersion, writes an audit row - all one transaction.
 *
 * DEVICE: resolves ONLY this device's row in browser_request_devices and
 * writes browser_device_overrides. The parent request only flips to
 * RESOLVED once every sibling row has a non-null decision (checked here,
 * every call) - if other devices are still waiting, the request stays
 * PENDING and keeps showing up in listPendingBrowserRequests() for them.
 *
 * Returns null if there's nothing to resolve:
 *   - GLOBAL: the request isn't PENDING or doesn't exist.
 *   - DEVICE: this device has no still-pending row on this request
 *     (already resolved for them, or they never actually requested it).
 * On success: { domain, scope: 'GLOBAL' } or
 * { domain, scope: 'DEVICE', deviceId, requestFullyResolved }.
 */
async function resolveBrowserRequest(id, { scope, decision, deviceId, reason, actor }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (scope === 'GLOBAL') {
      const { rows } = await client.query(
        `UPDATE browser_requests
            SET status = 'RESOLVED', resolution_scope = 'GLOBAL', resolution_decision = $2,
                resolved_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'PENDING'
          RETURNING domain`,
        [id, decision],
      );
      const domain = rows[0] ? rows[0].domain : null;
      if (!domain) {
        await client.query('ROLLBACK');
        return null;
      }
      // A global rule answers every device still waiting on this request -
      // stamp them so listBrowserRequestDevices() doesn't keep showing
      // them as pending on a request that is, in fact, resolved.
      await client.query(
        `UPDATE browser_request_devices SET decision = $2, resolved_at = now()
          WHERE request_id = $1 AND decision IS NULL`,
        [id, decision],
      );
      const existingDomain = await client.query(
        `SELECT decision FROM browser_domains WHERE domain = $1 FOR UPDATE`,
        [domain],
      );
      const oldDecision = existingDomain.rows[0] ? existingDomain.rows[0].decision : null;
      await client.query(
        `INSERT INTO browser_domains (domain, decision, source, approval_method, reason, approved_at, decision_version)
         VALUES ($1, $2, 'admin_request', 'admin_manual', $3, $4, 1)
         ON CONFLICT (domain) DO UPDATE SET
           decision = EXCLUDED.decision,
           source = 'admin_request',
           approval_method = 'admin_manual',
           reason = EXCLUDED.reason,
           approved_at = EXCLUDED.approved_at,
           decision_version = browser_domains.decision_version + 1,
           updated_at = now()`,
        [domain, decision, reason || null, Date.now()],
      );
      const { rows: metaRows } = await client.query(
        `UPDATE browser_policy_meta SET value = value + 1 WHERE key = 'policy_version' RETURNING value`,
      );
      await insertAuditRow(client, {
        actor, action: 'request_resolve_global', domain, scope: 'GLOBAL',
        oldDecision, newDecision: decision, reason,
        policyVersionAfter: Number(metaRows[0].value),
      });
      await client.query('COMMIT');
      return { domain, scope: 'GLOBAL' };
    }

    // DEVICE scope: only this device's row, only if it's still pending -
    // the WHERE clause is what prevents double-resolving the same device
    // twice (see "duplicate resolution" in the test list).
    const { rows: deviceRows } = await client.query(
      `UPDATE browser_request_devices
          SET decision = $3, resolved_at = now()
        WHERE request_id = $1 AND device_id = $2 AND decision IS NULL
        RETURNING request_id`,
      [id, deviceId, decision],
    );
    if (!deviceRows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const { rows: reqRows } = await client.query(
      `SELECT domain FROM browser_requests WHERE id = $1`,
      [id],
    );
    const domain = reqRows[0] ? reqRows[0].domain : null;
    if (!domain) {
      // FK guarantees the parent row exists, so this should be
      // unreachable - fail closed rather than writing an override with
      // no known domain if it somehow ever happened.
      await client.query('ROLLBACK');
      return null;
    }
    const existingOverride = await client.query(
      `SELECT decision FROM browser_device_overrides WHERE device_id = $1 AND domain = $2`,
      [deviceId, domain],
    );
    const oldDecision = existingOverride.rows[0] ? existingOverride.rows[0].decision : null;
    await client.query(
      `INSERT INTO browser_device_overrides (device_id, domain, decision, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (device_id, domain) DO UPDATE SET
         decision = EXCLUDED.decision, reason = EXCLUDED.reason, created_at = now()`,
      [deviceId, domain, decision, reason || null],
    );
    const { rows: remaining } = await client.query(
      `SELECT COUNT(*)::int AS n FROM browser_request_devices WHERE request_id = $1 AND decision IS NULL`,
      [id],
    );
    const requestFullyResolved = remaining[0].n === 0;
    if (requestFullyResolved) {
      // Only flips PENDING -> RESOLVED when every device that ever asked
      // has now individually been answered - a request with even one
      // sibling still at decision IS NULL stays PENDING and keeps
      // appearing in listPendingBrowserRequests() for that device.
      await client.query(
        `UPDATE browser_requests
            SET status = 'RESOLVED', resolution_scope = 'DEVICE', resolved_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'PENDING'`,
        [id],
      );
    }
    const { rows: metaRows } = await client.query(
      `UPDATE browser_policy_meta SET value = value + 1 WHERE key = 'policy_version' RETURNING value`,
    );
    await insertAuditRow(client, {
      actor, action: 'request_resolve_device', domain, scope: 'DEVICE', deviceId,
      oldDecision, newDecision: decision, reason,
      policyVersionAfter: Number(metaRows[0].value),
    });
    await client.query('COMMIT');
    return { domain, scope: 'DEVICE', deviceId, requestFullyResolved };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getBrowserPolicyVersion() {
  const { rows } = await pool.query(
    `SELECT value FROM browser_policy_meta WHERE key = 'policy_version'`,
  );
  return rows[0] ? Number(rows[0].value) : 1;
}

/**
 * Phase 2.4 - the exact global rules needed to reproduce browserPolicy.js's
 * offline domain matching (domainCovers: exact match, or an ancestor domain
 * with allow_subdomains set) inside a signed snapshot. A REVIEW-decision
 * row is deliberately excluded: browserPolicy.evaluateDomain already
 * treats an explicit REVIEW row identically to "no rule at all" for
 * matching purposes (see its `globalRule.decision !== DECISIONS.REVIEW`
 * check), so including it here would only bloat the snapshot with rows
 * that can never change an offline decision. ORDER BY domain makes the
 * result already deterministic before it ever reaches
 * policySigning.buildBrowserPolicySnapshot (which re-sorts defensively
 * anyway - see that function's own doc for why relying on this ORDER BY
 * alone would still be safe, since `domain` is the primary key and can't
 * tie).
 */
async function listBrowserDomainsForSnapshot() {
  const { rows } = await pool.query(
    `SELECT domain, decision, allow_subdomains
       FROM browser_domains
      WHERE decision != 'REVIEW'
      ORDER BY domain ASC`,
  );
  return rows.map(row => ({
    domain: row.domain,
    decision: row.decision,
    allowSubdomains: row.allow_subdomains,
  }));
}

/** Append-only audit trail of every /browser/check outcome. Best-effort from
 * the caller's point of view (see index.js) - a logging failure must never
 * fail the decision the device is waiting on. */
async function logBrowserDecision(id, { deviceId, domain, url, decision, source }) {
  await pool.query(
    `INSERT INTO browser_decision_log (id, device_id, domain, url, decision, source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, deviceId || null, domain, url || null, decision, source],
  );
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
  updateAppCatalogMeta,
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
  getBrowserDomainForHost,
  getBrowserDeviceOverride,
  listBrowserDomains,
  upsertBrowserDomain,
  recordBrowserRequest,
  listPendingBrowserRequests,
  resolveBrowserRequest,
  getBrowserPolicyVersion,
  listBrowserDomainsForSnapshot,
  logBrowserDecision,
  getPendingBrowserRequestDomain,
  listBrowserRequestDevices,
  deleteBrowserDomain,
  listBrowserPolicyAudit,
};
