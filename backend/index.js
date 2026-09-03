require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const dns = require('dns');
const net = require('net');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const push = require('./push');
const deviceHealth = require('./deviceHealth');
const healthPanel = require('./healthPanel');
const diagnostics = require('./diagnostics');
const alerts = require('./alerts');
const playStoreSearch = require('./playStoreSearch');
const browserPolicy = require('./browserPolicy');
const policySigning = require('./policySigning');
const appCategories = require('./appCategories');

const app = express();
app.use(express.json());
app.use(cookieParser());

// Behind a reverse proxy (Render, Caddy) req.ip and secure cookies need this.
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}
const SECURE_COOKIES = process.env.SECURE_COOKIES === '1';

app.use(express.static(path.join(__dirname, '../admin-panel')));

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
// Accept either a pre-computed hash or a plain password (easier to set on a host).
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ||
  (process.env.ADMIN_PASSWORD ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10) : null);
const JWT_SECRET = process.env.JWT_SECRET;
const AUTH_ENABLED = Boolean(ADMIN_USERNAME && ADMIN_PASSWORD_HASH && JWT_SECRET);

// Booting with AUTH_ENABLED false makes requireAdmin a no-op, which opens
// every admin endpoint (device list, commands including WIPE, apps catalog)
// to anyone with no authentication at all. That must never happen silently
// from a missing/misconfigured environment variable - refuse to start
// unless an operator explicitly opts into it for local development.
const ALLOW_INSECURE_ADMIN = process.env.ALLOW_INSECURE_ADMIN === '1';
if (!AUTH_ENABLED && !ALLOW_INSECURE_ADMIN) {
  console.error(
    'FATAL: admin credentials are not fully configured - need ADMIN_USERNAME, ' +
    'JWT_SECRET, and either ADMIN_PASSWORD_HASH or ADMIN_PASSWORD. Refusing to ' +
    'start with the admin panel unprotected. Set the missing environment ' +
    'variable(s), or set ALLOW_INSECURE_ADMIN=1 to run without admin auth for ' +
    'local development only.'
  );
  process.exit(1);
}

const PACKAGE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const ALLOWED_COMMANDS =
  ['LOCK', 'SYNC_POLICY', 'REBOOT', 'WIPE', 'INSTALL_APP', 'UNINSTALL_APP',
   'OPEN_PLAY_STORE_INSTALL', 'OPEN_PLAY_STORE_SYSTEM_COMPONENT', 'OPEN_DEBUGGING_TEMP',
   'RELEASE_DEVICE_OWNER', 'ENABLE_DNS_FILTERING', 'DISABLE_DNS_FILTERING'];
// Pre-installed system components OPEN_PLAY_STORE_SYSTEM_COMPONENT is allowed
// to target - deliberately separate from the customer app catalog, since
// these are never something a customer "installs" or an admin assigns via
// policy/apps. The display name is always taken from here server-side, never
// from client input, so the admin panel can't inject an arbitrary label.
const SYSTEM_COMPONENT_DISPLAY_NAMES = {
  'com.google.android.gms': 'Google Play Services',
};
// Default DNS-over-TLS provider for fleet filtering. AdGuard's public
// default resolver blocks ads and trackers and supports Android Private DNS.
// Never trust ENABLE_DNS_FILTERING's target host from client input; this is
// the sole source of truth for it, same principle as SYSTEM_COMPONENT_DISPLAY_NAMES.
const DEFAULT_DNS_PROVIDER_HOST = 'dns.adguard-dns.com';
const DNS_PROVIDER_HOST = process.env.DNS_PROVIDER_HOST || DEFAULT_DNS_PROVIDER_HOST;
// Allow an explicit environment override. When no override is supplied, the
// built-in AdGuard default is truthfully marked as a filtering resolver.
const DNS_PROVIDER_FILTERS_CONTENT = process.env.DNS_PROVIDER_FILTERS_CONTENT == null
  ? DNS_PROVIDER_HOST === DEFAULT_DNS_PROVIDER_HOST
  : process.env.DNS_PROVIDER_FILTERS_CONTENT === '1';
const ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000;

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

/** Constant-time comparison of two hex digests of equal length. */
function digestsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

/** Lets async handlers reject into the Express error handler. */
const wrap = handler => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const DEFAULT_SYNC_INTERVAL_MINUTES = 60;

/** Fills in policy defaults so older records keep working. */
function normalizePolicy(policy) {
  return {
    allowedApps: (policy && policy.allowedApps) || [],
    kioskEnabled: Boolean(policy && policy.kioskEnabled),
    syncIntervalMinutes:
      (policy && policy.syncIntervalMinutes) || DEFAULT_SYNC_INTERVAL_MINUTES,
  };
}

/** Saves the policy and nudges the device to pick it up immediately. */
async function savePolicyAndWake(device, policy) {
  const updated = await db.setPolicy(device.deviceId, policy);
  await push.wake(device.pushToken);
  return publicDevice(updated);
}

/** Reads the app's icon straight off its public Play Store listing page. */
function fetchPlayStoreIcon(packageName) {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}&hl=en&gl=US`;
  return fetchIconFromUrl(url, 3);
}

function fetchIconFromUrl(url, redirectsLeft) {
  const MAX_BYTES = 300000; // og:image sits in <head>, well within this.
  return new Promise(resolve => {
    let settled = false;
    const done = value => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000,
    }, res => {
      // Play Store sometimes redirects to a locale/consent variant of the page.
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        return fetchIconFromUrl(nextUrl, redirectsLeft - 1).then(done);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return done(null);
      }
      let body = '';
      res.on('data', chunk => {
        if (body.length < MAX_BYTES) body += chunk;
      });
      res.on('end', () => {
        // Attribute order/quote style aren't guaranteed, so match either way.
        const match =
          body.match(/<meta[^>]*\bproperty=["']og:image["'][^>]*\bcontent=["']([^"']+)["']/) ||
          body.match(/<meta[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']og:image["']/);
        done(match ? match[1] : null);
      });
      res.on('error', () => done(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => done(null));
  });
}

function publicDevice(device) {
  const { authTokenHash, ...rest } = device;
  let subscriptionStatus = 'none';
  if (device.subscription) {
    subscriptionStatus =
      new Date(device.subscription.expiryDate) > new Date() ? 'active' : 'expired';
  }
  return {
    ...rest,
    subscriptionStatus,
    policy: normalizePolicy(device.policy),
    pendingCommands: device.pendingCommands || [],
    commandHistory: device.commandHistory || [],
  };
}

// ---------- authentication ----------

/** Guards the admin endpoints. Open when no credentials are configured. */
function requireAdmin(req, res, next) {
  if (!AUTH_ENABLED) return next();
  const token = req.cookies.session;
  if (!token) {
    return res.status(401).json({ error: 'not authenticated' });
  }
  try {
    // Exposed as req.admin so routes that write an audit trail (see the
    // Browser Policy admin endpoints) can record who made the change.
    // There is only one shared admin login today (ADMIN_USERNAME), not
    // per-admin accounts, so this identifies "the admin panel", not a
    // specific real person - documented as a known limitation.
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid session' });
  }
}

/** Guards the endpoints a managed device calls: the token must match that device. */
const requireDevice = wrap(async (req, res, next) => {
  const device = await db.getDevice(req.params.deviceId);
  if (!device || !device.authTokenHash) {
    return res.status(404).json({ error: 'device not found' });
  }
  const token = bearerToken(req);
  if (!token || !digestsMatch(sha256(token), device.authTokenHash)) {
    return res.status(401).json({ error: 'invalid device token' });
  }
  req.device = device;
  next();
});

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

/** Slows down password guessing against the panel. */
function loginRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { first: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

app.post('/api/login', (req, res) => {
  if (loginRateLimited(req.ip)) {
    return res.status(429).json({ error: 'too many attempts, try again later' });
  }
  if (!AUTH_ENABLED) {
    return res.status(400).json({ error: 'authentication is not configured' });
  }
  const { username, password } = req.body;
  if (username !== ADMIN_USERNAME ||
      !bcrypt.compareSync(String(password || ''), ADMIN_PASSWORD_HASH)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('session', token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ status: 'ok' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ status: 'ok' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------- enrollment (admin) ----------

app.post('/api/enrollments', requireAdmin, wrap(async (req, res) => {
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);
  await db.createEnrollment(crypto.randomUUID(), sha256(token), expiresAt);
  res.json({ token, expiresAt: expiresAt.toISOString() });
}));

app.get('/api/enrollments', requireAdmin, wrap(async (req, res) => {
  res.json(await db.listEnrollments());
}));

// ---------- device endpoints ----------

app.post('/api/devices/register', wrap(async (req, res) => {
  const { enrollmentToken } = req.body;
  if (typeof enrollmentToken !== 'string' || !enrollmentToken) {
    return res.status(400).json({ error: 'enrollmentToken is required' });
  }

  // The server assigns the ID (a short number, not a UUID) so the admin has
  // something they can read off the device and type into the panel.
  const deviceId = await db.generateUniqueDeviceId();
  const consumed = await db.consumeEnrollment(
    sha256(enrollmentToken.trim().toUpperCase()),
    deviceId,
  );
  if (!consumed) {
    return res.status(401).json({ error: 'invalid or expired enrollment token' });
  }

  const deviceToken = crypto.randomBytes(32).toString('hex');
  await db.createDevice(deviceId, sha256(deviceToken));
  res.json({ status: 'enrolled', deviceId, deviceToken });
}));

app.get('/api/devices/:deviceId/policy', requireDevice, (req, res) => {
  const policy = req.device.policy || {};
  res.json({
    allowedApps: policy.allowedApps || [],
    kioskEnabled: policy.kioskEnabled === true,
  });
});

app.get('/api/devices/:deviceId/commands', requireDevice, wrap(async (req, res) => {
  res.json({ commands: await db.takePendingCommands(req.params.deviceId) });
}));

app.post('/api/devices/:deviceId/heartbeat', requireDevice, wrap(async (req, res) => {
  const { model, androidVersion, isDeviceOwner } = req.body;
  const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);
  await db.setStatus(req.params.deviceId, {
    model: str(model, 100),
    androidVersion: str(androidVersion, 20),
    isDeviceOwner: isDeviceOwner === true,
    lastSeen: new Date().toISOString(),
  });
  res.json({ status: 'ok' });
}));

// ---------- admin endpoints ----------

app.get('/api/devices', requireAdmin, wrap(async (req, res) => {
  const devices = await db.listDevices();
  res.json(devices.map(publicDevice));
}));

// ---------- alerts (admin, read-only) ----------
// Alerts are opened/resolved as a side effect of /sync (see alerts.js) - this
// route only reads the current active list, no logic of its own.

app.get('/api/alerts', requireAdmin, wrap(async (req, res) => {
  // DEVICE_OFFLINE/NEVER_CONTACTED can only ever be caught here - see
  // alerts.reconcileAllDevices() for why sync-time reconciliation alone
  // can't reach them.
  await alerts.reconcileAllDevices();
  res.json(await alerts.listActiveAlerts());
}));

// ---------- device health dashboard (admin, read-only) ----------
// All classification logic lives in healthPanel.js - these routes only wire
// requireAdmin to a DB read and hand the result to that module.

app.get('/api/health/devices', requireAdmin, wrap(async (req, res) => {
  const devices = await db.listDeviceHealth();
  res.json(devices.map(device => ({ ...device, ...healthPanel.classify(device) })));
}));

app.get('/api/health/summary', requireAdmin, wrap(async (req, res) => {
  const devices = await db.listDeviceHealth();
  res.json(healthPanel.summarize(devices.map(device => healthPanel.classify(device))));
}));

// Read-only diagnosis for one device - no command is ever queued here.
app.get('/api/health/devices/:deviceId/diagnostics', requireAdmin, wrap(async (req, res) => {
  const devices = await db.listDeviceHealth();
  const device = devices.find(d => d.deviceId === req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }
  res.json({
    deviceId: device.deviceId,
    health: { ...device, ...healthPanel.classify(device) },
    faults: diagnostics.diagnose(device),
    // Global, not per-device (same provider for the whole fleet today) - see
    // DNS_PROVIDER_FILTERS_CONTENT. The panel must not label this as ad/
    // content blocking while it's false.
    dnsProviderFilters: DNS_PROVIDER_FILTERS_CONTENT,
  });
}));

const retrySyncAttempts = new Map();
const RETRY_SYNC_COOLDOWN_MS = 15 * 1000;

/** "Retry sync" for one device only. This deliberately queues nothing in
 * `commands` and touches no policy - it just re-sends the exact same
 * wake-on-push nudge every policy/command change already sends (see
 * savePolicyAndWake and the /commands route below). MdmMessagingService on
 * the device treats any push as "sync now" and runs the normal PolicySync
 * cycle, so this reuses that existing path instead of inventing a new
 * command type. A short per-device cooldown absorbs an accidental double
 * click without needing new persisted state. */
app.post('/api/health/devices/:deviceId/actions/retry-sync', requireAdmin, wrap(async (req, res) => {
  const devices = await db.listDeviceHealth();
  const device = devices.find(d => d.deviceId === req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }

  // Never trust the UI's own gating on which fault codes it shows a button
  // for - re-derive the same diagnosis server-side, from the same device
  // row diagnose() already uses elsewhere, and require SYNC_STALE to
  // actually be present right now. The client sends no fault/command type
  // at all (req.body is never read here), so there is nothing for a direct
  // call to this endpoint to override.
  const faults = diagnostics.diagnose(device);
  if (!faults.some(f => f.code === 'SYNC_STALE')) {
    return res.status(409).json({ error: 'המכשיר אינו דורש כרגע סנכרון מחדש' });
  }

  const now = Date.now();
  const last = retrySyncAttempts.get(req.params.deviceId);
  if (last && now - last < RETRY_SYNC_COOLDOWN_MS) {
    return res.status(429).json({ error: 'בקשת סנכרון כבר נשלחה למכשיר זה - יש להמתין מספר שניות לפני ניסיון נוסף' });
  }
  retrySyncAttempts.set(req.params.deviceId, now);

  // pushToken deliberately isn't part of the health-row shape listDeviceHealth()
  // returns (that shape is also what /api/health/devices sends to the panel,
  // and a push token has no business leaving the server) - so it's looked up
  // separately here, only once SYNC_STALE is confirmed and we're actually
  // about to wake the device.
  const fullDevice = await db.getDevice(req.params.deviceId);
  const result = await push.wake(fullDevice ? fullDevice.pushToken : null);
  console.log(
    `[retry-sync] device=${req.params.deviceId} result=${result.sent ? 'sent' : 'not_sent:' + result.reason}`,
  );

  if (!result.sent) {
    const messages = {
      no_push_token: 'למכשיר זה אין push token רשום - הוא יסתנכרן במחזור הסנכרון הרגיל הבא שלו',
      push_not_configured: 'שירות ה-push אינו מוגדר בשרת - המכשיר יסתנכרן במחזור הסנכרון הרגיל הבא שלו',
      send_failed: 'שליחת בקשת הסנכרון למכשיר נכשלה - נסה שוב בעוד רגע',
    };
    return res.json({
      status: 'not_sent',
      reason: result.reason,
      message: messages[result.reason] || 'לא ניתן היה לשלוח בקשת סנכרון',
    });
  }

  res.json({ status: 'sent', message: 'בקשת סנכרון נשלחה למכשיר' });
}));

const retryUpdateAttempts = new Map();
const RETRY_UPDATE_COOLDOWN_MS = 15 * 1000;

/** "Retry update" for one device only. Sends a push carrying a distinct
 * action value ({action:'retry_update'}) that MdmMessagingService uses to
 * also run AutoUpdater.check() after its normal sync - see push.js and
 * MdmMessagingService.kt. The device decides the version and APK URL itself
 * by re-fetching version.json from the server's existing downloads path;
 * this endpoint never sends (and req.body is never read for) any command
 * type, version, or APK URL - there is nothing here for a client to inject. */
app.post('/api/health/devices/:deviceId/actions/retry-update', requireAdmin, wrap(async (req, res) => {
  const devices = await db.listDeviceHealth();
  const device = devices.find(d => d.deviceId === req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }

  const faults = diagnostics.diagnose(device);
  if (!faults.some(f => f.code === 'UPDATE_FAILED')) {
    return res.status(409).json({ error: 'המכשיר אינו במצב של עדכון שנכשל כרגע' });
  }

  const now = Date.now();
  const last = retryUpdateAttempts.get(req.params.deviceId);
  if (last && now - last < RETRY_UPDATE_COOLDOWN_MS) {
    return res.status(429).json({ error: 'בקשת עדכון כבר נשלחה למכשיר זה - יש להמתין מספר שניות לפני ניסיון נוסף' });
  }
  retryUpdateAttempts.set(req.params.deviceId, now);

  const fullDevice = await db.getDevice(req.params.deviceId);
  const result = await push.wake(fullDevice ? fullDevice.pushToken : null, { action: 'retry_update' });
  console.log(
    `[retry-update] device=${req.params.deviceId} result=${result.sent ? 'sent' : 'not_sent:' + result.reason}`,
  );

  if (!result.sent) {
    const messages = {
      no_push_token: 'לא ניתן ליזום כרגע ניסיון עדכון מרחוק כי אין למכשיר Push Token פעיל',
      push_not_configured: 'לא ניתן ליזום כרגע ניסיון עדכון מרחוק כי שירות ה-Push אינו מוגדר בשרת',
      send_failed: 'שליחת בקשת העדכון למכשיר נכשלה - נסה שוב בעוד רגע',
    };
    return res.json({
      status: 'not_sent',
      reason: result.reason,
      message: messages[result.reason] || 'לא ניתן היה לשלוח בקשת עדכון',
    });
  }

  res.json({ status: 'sent', message: 'בקשת ניסיון עדכון נשלחה למכשיר' });
}));

app.delete('/api/devices/:deviceId', requireAdmin, wrap(async (req, res) => {
  const deleted = await db.deleteDevice(req.params.deviceId);

  if (!deleted) {
    return res.status(404).json({ error: 'device not found' });
  }

  res.json({ status: 'ok' });
}));

app.post('/api/devices/:deviceId/subscription', requireAdmin, wrap(async (req, res) => {
  const { price } = req.body;
  if (typeof price !== 'number' || price < 0) {
    return res.status(400).json({ error: 'price must be a non-negative number' });
  }
  const device = await db.getDevice(req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }

  const startDate = new Date();
  const expiryDate = new Date(startDate);
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);

  const updated = await db.setSubscription(req.params.deviceId, {
    price,
    startDate: startDate.toISOString(),
    expiryDate: expiryDate.toISOString(),
  });
  res.json(publicDevice(updated));
}));

app.post('/api/devices/:deviceId/customer', requireAdmin, wrap(async (req, res) => {
  const { name, number } = req.body;
  if (name != null && typeof name !== 'string') {
    return res.status(400).json({ error: 'name must be a string' });
  }
  if (number != null && typeof number !== 'string') {
    return res.status(400).json({ error: 'number must be a string' });
  }
  const device = await db.getDevice(req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }
  const updated = await db.setCustomerInfo(
    req.params.deviceId,
    name ? name.slice(0, 100) : null,
    number ? number.slice(0, 50) : null,
  );
  res.json(publicDevice(updated));
}));

// ---------- DNS filtering (admin) ----------
// ENABLE_DNS_FILTERING/DISABLE_DNS_FILTERING reuse the existing generic
// /commands route above for actually controlling a device - this route only
// covers the one thing that isn't a device command: whether the customer's
// own in-app switch is allowed to act at all.

app.post('/api/devices/:deviceId/dns/allow-customer-toggle', requireAdmin, wrap(async (req, res) => {
  const { allow } = req.body;
  if (typeof allow !== 'boolean') {
    return res.status(400).json({ error: 'allow must be a boolean' });
  }
  const device = await db.getDevice(req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }
  const updated = await db.setAllowCustomerDnsToggle(req.params.deviceId, allow);
  res.json(publicDevice(updated));
}));

// ---------- apps catalog (admin) ----------

app.get('/api/apps', requireAdmin, wrap(async (req, res) => {
  res.json(await db.listAppsCatalog());
}));

app.post('/api/apps', requireAdmin, wrap(async (req, res) => {
  const { packageName, name } = req.body;
  if (typeof packageName !== 'string' || !PACKAGE_NAME_REGEX.test(packageName)) {
    return res.status(400).json({ error: 'invalid packageName format' });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const iconUrl = await fetchPlayStoreIcon(packageName);
  await db.addAppToCatalog(packageName, name.trim().slice(0, 100), iconUrl);
  res.json(await db.listAppsCatalog());
}));

app.get('/api/apps/categories', requireAdmin, wrap(async (req, res) => {
  res.json(appCategories.CATEGORIES);
}));

const MAX_SORT_ORDER = 100000;

// Admin-only catalog organization write path (category/recommended/sort) -
// deliberately separate from POST /api/apps (which only ever touches
// name/icon/version, see addAppToCatalog): a category/recommended/sort
// change is never allowed to accidentally trigger a Play re-fetch or touch
// unrelated fields, and vice versa. All three fields are optional and
// independent so the admin panel can fire one small request per control
// (a dropdown change, a toggle click) without resending the others.
// Category values are validated against the fixed server-side list -
// never trust an arbitrary string from the browser (see appCategories.js).
app.post('/api/apps/:packageName/catalog-meta', requireAdmin, wrap(async (req, res) => {
  const { packageName } = req.params;
  if (!PACKAGE_NAME_REGEX.test(packageName)) {
    return res.status(400).json({ error: 'invalid packageName format' });
  }
  const patch = {};
  if (req.body.category !== undefined) {
    if (!appCategories.isValidCategoryKey(req.body.category)) {
      return res.status(400).json({ error: 'invalid category' });
    }
    patch.category = req.body.category;
  }
  if (req.body.isRecommended !== undefined) {
    if (typeof req.body.isRecommended !== 'boolean') {
      return res.status(400).json({ error: 'isRecommended must be a boolean' });
    }
    patch.isRecommended = req.body.isRecommended;
  }
  if (req.body.sortOrder !== undefined) {
    if (!Number.isInteger(req.body.sortOrder) || req.body.sortOrder < 0 || req.body.sortOrder > MAX_SORT_ORDER) {
      return res.status(400).json({ error: `sortOrder must be an integer between 0 and ${MAX_SORT_ORDER}` });
    }
    patch.sortOrder = req.body.sortOrder;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'at least one of category, isRecommended, sortOrder is required' });
  }
  const updated = await db.updateAppCatalogMeta(packageName, patch);
  if (!updated) {
    return res.status(404).json({ error: 'app not found in catalog' });
  }
  res.json(updated);
}));

app.get('/api/apps/play-search', requireAdmin, wrap(async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 80) {
    return res.status(400).json({ error: 'search query must be 2-80 characters' });
  }
  try {
    res.json(await playStoreSearch.searchPlayStore(query));
  } catch (e) {
    console.warn('[play-search] failed:', e.message);
    res.status(502).json({ error: 'לא ניתן לחפש כרגע ב-Google Play. נסה שוב בעוד רגע.' });
  }
}));

app.post('/api/apps/from-play', requireAdmin, wrap(async (req, res) => {
  const { packageName } = req.body || {};
  if (typeof packageName !== 'string' || !PACKAGE_NAME_REGEX.test(packageName)) {
    return res.status(400).json({ error: 'invalid packageName format' });
  }
  try {
    const appInfo = await playStoreSearch.getPlayStoreApp(packageName);
    await db.addAppToCatalog(
      appInfo.packageName, appInfo.name, appInfo.iconUrl, appInfo.version, appInfo.updated,
      appInfo.category,
    );
    res.json({ status: 'ok', app: appInfo, catalog: await db.listAppsCatalog() });
  } catch (e) {
    console.warn(`[play-add] ${packageName} failed:`, e.message);
    res.status(502).json({ error: 'לא ניתן לאמת כרגע את האפליקציה מול Google Play.' });
  }
}));

const REFRESH_PLAY_METADATA_BATCH_SIZE = 5;
const PLAY_METADATA_ERROR_MAX_LENGTH = 300;

// Fleet-wide automatic Play metadata cache. The freshness window is per
// package, not per device: 1,000 devices using Waze still cause at most one
// Google Play lookup for Waze per window. Claims are persisted/locked in
// Postgres (db.claimAppsForPlayMetadataRefresh), so multiple server instances
// also avoid refreshing the same package at the same time.
const PLAY_METADATA_FRESH_MS = 30 * 60 * 1000;
const AUTO_PLAY_REFRESH_BATCH_SIZE = 3;
const AUTO_PLAY_REFRESH_MIN_KICK_MS = 60 * 1000;
const AUTO_PLAY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
let autoPlayRefreshRunning = false;
let lastAutoPlayRefreshKickAt = 0;

async function refreshOnePlayPackage(packageName) {
  try {
    const appInfo = await playStoreSearch.getPlayStoreApp(packageName);
    await db.addAppToCatalog(
      appInfo.packageName, appInfo.name, appInfo.iconUrl, appInfo.version, appInfo.updated,
      appInfo.category,
    );
    await db.recordPlayMetadataCheckSuccess(appInfo.packageName);
    return true;
  } catch (e) {
    const message = String(e.message || 'unknown error').slice(0, PLAY_METADATA_ERROR_MAX_LENGTH);
    console.warn(`[auto-play-metadata] ${packageName} failed:`, e.message);
    await db.recordPlayMetadataCheckFailure(packageName, message);
    return false;
  }
}

async function runAutoPlayMetadataRefresh() {
  if (autoPlayRefreshRunning) return;
  autoPlayRefreshRunning = true;
  try {
    const cutoff = Date.now() - PLAY_METADATA_FRESH_MS;
    const packages = await db.claimAppsForPlayMetadataRefresh(
      cutoff,
      AUTO_PLAY_REFRESH_BATCH_SIZE,
    );
    for (const packageName of packages) {
      // Deliberately sequential: a catalog refresh must never become a burst
      // against Google Play just because thousands of devices synced together.
      await refreshOnePlayPackage(packageName);
    }
  } finally {
    autoPlayRefreshRunning = false;
  }
}

function kickAutoPlayMetadataRefresh() {
  const now = Date.now();
  if (autoPlayRefreshRunning || now - lastAutoPlayRefreshKickAt < AUTO_PLAY_REFRESH_MIN_KICK_MS) {
    return;
  }
  lastAutoPlayRefreshKickAt = now;
  setImmediate(() => {
    runAutoPlayMetadataRefresh().catch(e => {
      console.warn('[auto-play-metadata] refresh pass failed:', e.message);
    });
  });
}

/**
 * Backfills play_version/play_updated_at for existing catalog apps that
 * never got it (added before this feature existed, or where an earlier
 * fetch failed) - deliberately admin-triggered, not run on server startup or
 * on any device sync. Processes a small fixed batch sequentially (not
 * Promise.all) so this never fires a burst of simultaneous requests at
 * Google Play.
 *
 * "The fetch succeeded" and "Google gave us a usable play_updated_at" are
 * two different facts - some packages' Play metadata simply never includes
 * an updated timestamp. Success is recorded via its own explicit call
 * (recordPlayMetadataCheckSuccess), never inferred from appInfo.updated
 * being non-null - a successful fetch with no timestamp is still a real
 * check that happened, not an unresolved one, and must not be re-attempted
 * on every single call the way a genuinely never-checked or failed package
 * is.
 *
 * Starvation-safe by construction: db.listAppsPendingPlayMetadataRefresh()
 * orders never-checked apps first, then oldest-checked - and every attempt
 * in this batch, whichever of the three outcomes below it hits, stamps
 * play_metadata_checked_at. A package that keeps failing (or keeps
 * succeeding with no timestamp) still cycles to the back of that ordering,
 * so it can never permanently block apps further down the catalog from ever
 * being attempted. remaining/neverChecked are fresh COUNT(*)s from the DB,
 * not derived from this batch's results, so they stay correct regardless of
 * this batch's mix of outcomes.
 */
app.post('/api/apps/refresh-play-metadata', requireAdmin, wrap(async (req, res) => {
  const pending = await db.listAppsPendingPlayMetadataRefresh(REFRESH_PLAY_METADATA_BATCH_SIZE);

  const results = [];
  for (const packageName of pending) {
    try {
      const appInfo = await playStoreSearch.getPlayStoreApp(packageName);
      await db.addAppToCatalog(
        appInfo.packageName, appInfo.name, appInfo.iconUrl, appInfo.version, appInfo.updated,
        appInfo.category,
      );
      await db.recordPlayMetadataCheckSuccess(appInfo.packageName);
      const status = appInfo.updated != null ? 'updated' : 'checked_no_update_timestamp';
      results.push({ packageName, status });
    } catch (e) {
      // Only the message, never e.stack - this is stored in the DB, not
      // just logged, so it must stay a short human-readable reason.
      const message = String(e.message || 'unknown error').slice(0, PLAY_METADATA_ERROR_MAX_LENGTH);
      console.warn(`[refresh-play-metadata] ${packageName} failed:`, e.message);
      await db.recordPlayMetadataCheckFailure(packageName, message);
      results.push({ packageName, status: 'failed', error: message });
    }
  }

  res.json({
    processed: results.length,
    updated: results.filter(r => r.status === 'updated').length,
    checkedWithoutTimestamp: results.filter(r => r.status === 'checked_no_update_timestamp').length,
    failed: results.filter(r => r.status === 'failed').length,
    remaining: await db.countAppsPendingPlayMetadataRefresh(),
    neverChecked: await db.countAppsNeverCheckedPlayMetadata(),
    results,
  });
}));

app.post('/api/apps/:packageName/assign-all', requireAdmin, wrap(async (req, res) => {
  const { packageName } = req.params;
  if (!PACKAGE_NAME_REGEX.test(packageName)) {
    return res.status(400).json({ error: 'invalid packageName format' });
  }
  const devices = await db.listDevices();
  for (const device of devices) {
    const policy = normalizePolicy(device.policy);
    if (!policy.allowedApps.includes(packageName)) {
      policy.allowedApps = [...policy.allowedApps, packageName];
      await savePolicyAndWake(device, policy);
    }
  }
  res.json({ status: 'ok', updated: devices.length });
}));

app.post('/api/devices/:deviceId/policy/apps', requireAdmin, wrap(async (req, res) => {
  const { packageName } = req.body;
  if (typeof packageName !== 'string' || !PACKAGE_NAME_REGEX.test(packageName)) {
    return res.status(400).json({ error: 'invalid packageName format' });
  }
  const device = await db.getDevice(req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }

  const policy = normalizePolicy(device.policy);
  if (policy.allowedApps.includes(packageName)) {
    return res.json(publicDevice(device));
  }
  policy.allowedApps = [...policy.allowedApps, packageName];
  res.json(await savePolicyAndWake(device, policy));
}));

app.delete('/api/devices/:deviceId/policy/apps/:packageName', requireAdmin,
  wrap(async (req, res) => {
    const device = await db.getDevice(req.params.deviceId);
    if (!device) {
      return res.status(404).json({ error: 'device not found' });
    }
    const policy = normalizePolicy(device.policy);
    policy.allowedApps = policy.allowedApps.filter(p => p !== req.params.packageName);
    res.json(await savePolicyAndWake(device, policy));
  }));

app.post('/api/devices/:deviceId/policy/kiosk', requireAdmin, wrap(async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const device = await db.getDevice(req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }
  const policy = normalizePolicy(device.policy);
  policy.kioskEnabled = enabled;
  res.json(await savePolicyAndWake(device, policy));
}));

function validateCommandParams(command, params) {
  if (command === 'INSTALL_APP') {
    return /^https:\/\//.test(params.apkUrl || '')
      ? null
      : 'apkUrl must be an https URL';
  }
  if (command === 'UNINSTALL_APP' || command === 'OPEN_PLAY_STORE_INSTALL' ||
      command === 'OPEN_PLAY_STORE_SYSTEM_COMPONENT') {
    return PACKAGE_NAME_REGEX.test(params.packageName || '')
      ? null
      : 'packageName is invalid';
  }
  return null;
}

// ---------- INSTALL_APP: server-side download + SHA-256, with SSRF guards ----------
//
// The admin panel only ever supplies apkUrl - the backend is the sole source of
// expectedSha256, computed here by actually downloading the bytes and hashing
// them, so the device always has something real to verify against regardless
// of what the panel sends. Any client-supplied expectedSha256 is ignored.

const APK_DOWNLOAD_TIMEOUT_MS = 30_000;
const APK_MAX_BYTES = 300 * 1024 * 1024;
const APK_MAX_REDIRECTS = 5;
const BLOCKED_HOSTNAMES = new Set(['localhost']);

const BLOCKED_IPV4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '127.0.0.0/8',
  '169.254.0.0/16', // includes the 169.254.169.254 cloud metadata address
  '172.16.0.0/12',
  '192.168.0.0/16',
];

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function isBlockedIpv4(ip) {
  return BLOCKED_IPV4_CIDRS.some(cidr => ipv4InCidr(ip, cidr));
}

/** Expands any valid textual IPv6 address to its 8 groups (each 0-65535),
 * resolving "::" compression and a trailing IPv4 dotted-quad tail (e.g. the
 * "127.0.0.1" in "::ffff:127.0.0.1"). Returns null for anything that can't
 * be confidently parsed, so the caller can fail closed. */
function expandIpv6Groups(address) {
  let addr = address;
  const ipv4TailMatch = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4TailMatch) {
    const ipInt = ipv4ToInt(ipv4TailMatch[1]);
    if (ipInt === null) return null;
    const hi = ((ipInt >>> 16) & 0xffff).toString(16);
    const lo = (ipInt & 0xffff).toString(16);
    addr = addr.slice(0, addr.length - ipv4TailMatch[1].length) + hi + ':' + lo;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];

  let groups;
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = addr.split(':');
  }
  if (groups.length !== 8) return null;

  const values = groups.map(g => parseInt(g || '0', 16));
  if (values.some(v => Number.isNaN(v) || v < 0 || v > 0xffff)) return null;
  return values;
}

/** Only the specific ranges named in the audit - exact loopback, the two
 * fixed-length prefixes for link-local and unique-local, and any IPv4-mapped
 * (::ffff:0:0/96) or the deprecated IPv4-compatible (::/96) address reduced
 * to the IPv4 check above - structurally, so a hex-group form like
 * "::ffff:7f00:1" is caught the same as the equivalent dotted-quad form
 * "::ffff:127.0.0.1" instead of relying on one specific textual pattern.
 * Not full generic IPv6 CIDR math beyond that. */
function isBlockedIpv6(address) {
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') return true;

  const groups = expandIpv6Groups(lower);
  if (!groups) return true; // couldn't confidently parse it - fail closed

  const first5Zero = groups.slice(0, 5).every(g => g === 0);
  if (first5Zero && (groups[5] === 0xffff || groups[5] === 0)) {
    const ipInt = (groups[6] << 16) | groups[7];
    const ipv4 = [24, 16, 8, 0].map(shift => (ipInt >>> shift) & 0xff).join('.');
    return isBlockedIpv4(ipv4);
  }

  if (groups[0] >= 0xfe80 && groups[0] <= 0xfebf) return true; // fe80::/10
  if (groups[0] >= 0xfc00 && groups[0] <= 0xfdff) return true; // fc00::/7
  return false;
}

function isBlockedAddress(address, family) {
  return family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address);
}

/** Resolves the hostname once, rejects the whole hostname if any resolved
 * address is blocked, and hands the actual TCP connection the exact address
 * it just validated - so a later re-resolution (DNS rebinding) can never
 * land the connection somewhere different from what was checked. */
function createPinnedLookup(hostname) {
  return function pinnedLookup(_host, options, callback) {
    // Node's http/https client calls this with (hostname, options, callback),
    // but dns.lookup()'s own documented contract also allows (hostname,
    // callback) - support both. It may also ask for every resolved address
    // at once (options.all, used for Happy Eyeballs dual-stack racing) rather
    // than a single address/family pair - both response shapes are handled.
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      if (addresses.length === 0) return callback(new Error('no addresses resolved'));
      const blocked = addresses.find(a => isBlockedAddress(a.address, a.family));
      if (blocked) {
        return callback(new Error(`resolved to a blocked address (${blocked.address})`));
      }
      if (options && options.all) {
        return callback(null, addresses);
      }
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/** Downloads apkUrl and returns its SHA-256 hex digest, hashing as a stream
 * so the full file never sits in memory. Rejects (without ever having
 * queued anything) on: non-https URLs or redirects, a blocked/private/
 * loopback/link-local/metadata address, a response over APK_MAX_BYTES, or
 * no response within APK_DOWNLOAD_TIMEOUT_MS. */
function fetchApkSha256(apkUrl, redirectsLeft = APK_MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(apkUrl);
    } catch {
      return reject(new Error('invalid apkUrl'));
    }
    if (parsedUrl.protocol !== 'https:') {
      return reject(new Error('apkUrl must use https'));
    }
    // URL.hostname keeps the brackets for an IPv6 literal (e.g. "[::1]") -
    // strip them so both the literal-IP check below and dns.lookup() get a
    // plain address/hostname either way.
    const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
      return reject(new Error('apkUrl host is not allowed'));
    }
    // When the URL's host is already a literal IP address, Node connects to
    // it directly and never invokes the custom `lookup` option below at all -
    // that hook only fires for an actual hostname needing DNS resolution.
    // Without this separate check, https://127.0.0.1/... or a private/
    // metadata IP given directly (no hostname involved) would bypass every
    // check that follows.
    const literalIpFamily = net.isIP(hostname);
    if (literalIpFamily && isBlockedAddress(hostname, literalIpFamily)) {
      return reject(new Error('apkUrl host is not allowed'));
    }

    const hash = crypto.createHash('sha256');
    let totalBytes = 0;
    let settled = false;
    const overallTimer = setTimeout(() => {
      req.destroy(new Error('APK download timed out'));
    }, APK_DOWNLOAD_TIMEOUT_MS);
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      fn(value);
    };

    const req = https.get(apkUrl, {
      lookup: createPinnedLookup(hostname),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          return settle(reject, new Error('too many redirects while downloading apkUrl'));
        }
        let nextUrl;
        try {
          nextUrl = new URL(res.headers.location, apkUrl);
        } catch {
          return settle(reject, new Error('invalid redirect location'));
        }
        if (nextUrl.protocol !== 'https:') {
          return settle(reject, new Error('redirect to a non-https URL is not allowed'));
        }
        fetchApkSha256(nextUrl.toString(), redirectsLeft - 1)
          .then(sha => settle(resolve, sha))
          .catch(err => settle(reject, err));
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        return settle(reject, new Error(`APK download failed: HTTP ${res.statusCode}`));
      }

      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      if (contentLength > APK_MAX_BYTES) {
        res.destroy();
        return settle(reject, new Error('APK exceeds the maximum allowed size'));
      }

      res.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > APK_MAX_BYTES) {
          res.destroy();
          settle(reject, new Error('APK exceeds the maximum allowed size'));
          return;
        }
        hash.update(chunk);
      });
      res.on('end', () => settle(resolve, hash.digest('hex')));
      res.on('error', err => settle(reject, err));
    });

    req.on('error', err => settle(reject, err));
  });
}

app.post('/api/devices/:deviceId/commands', requireAdmin, wrap(async (req, res) => {
  const { command } = req.body;
  const params =
    req.body.params && typeof req.body.params === 'object' ? req.body.params : {};
  if (!ALLOWED_COMMANDS.includes(command)) {
    return res.status(400).json({ error: 'invalid command' });
  }
  const paramError = validateCommandParams(command, params);
  if (paramError) {
    return res.status(400).json({ error: paramError });
  }
  if (command === 'INSTALL_APP') {
    try {
      params.expectedSha256 = await fetchApkSha256(params.apkUrl);
    } catch (e) {
      return res.status(502).json({ error: `could not verify apkUrl: ${e.message}` });
    }
  }
  // WIPE is irreversible, so a valid admin session alone isn't enough - a
  // stolen/left-open session must not be able to wipe a device on its own.
  // Re-checked here, independent of req.body.params, so it can never end up
  // stored on the queued command or forwarded to the device.
  if (command === 'WIPE') {
    const adminPassword = req.body.adminPassword;
    if (
      !ADMIN_PASSWORD_HASH ||
      typeof adminPassword !== 'string' ||
      !bcrypt.compareSync(adminPassword, ADMIN_PASSWORD_HASH)
    ) {
      return res.status(401).json({ error: 'invalid admin password' });
    }
  }
  const device = await db.getDevice(req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }
  // Never trust the panel's own UI gating on which packages it shows a
  // button for - re-derive the real authorization here, server-side, from
  // this device's own policy, before anything is queued.
  if (command === 'OPEN_PLAY_STORE_INSTALL') {
    const policy = normalizePolicy(device.policy);
    if (!policy.allowedApps.includes(params.packageName)) {
      return res.status(403).json({ error: 'packageName is not approved for this device' });
    }
  }
  if (command === 'OPEN_PLAY_STORE_SYSTEM_COMPONENT') {
    const displayName = SYSTEM_COMPONENT_DISPLAY_NAMES[params.packageName];
    if (!displayName) {
      return res.status(403).json({ error: 'packageName is not an allowed system component' });
    }
    // Always the server's own trusted label - overwrites anything the
    // client might have sent under this key.
    params.displayName = displayName;
  }
  if (command === 'ENABLE_DNS_FILTERING') {
    // Always the server's own configured host - overwrites anything the
    // client might have sent under this key, same principle as displayName
    // above.
    params.providerHost = DNS_PROVIDER_HOST;
    // Written immediately so the panel shows "desired: on" right away,
    // before the device has even had a chance to sync and confirm it - see
    // setDnsDesiredState.
    await db.setDnsDesiredState(req.params.deviceId, DNS_PROVIDER_HOST, true);
  }
  if (command === 'DISABLE_DNS_FILTERING') {
    await db.setDnsDesiredState(req.params.deviceId, null, false);
  }
  await db.queueCommand(req.params.deviceId, crypto.randomUUID(), command, params);
  await push.wake(device.pushToken);
  const refreshed = await db.getDevice(req.params.deviceId);
  res.json(publicDevice(refreshed));
}));

/** One round trip per device: report status, take policy, collect commands. */

app.post(
  '/api/devices/:deviceId/commands/:commandId/result',
  requireDevice,
  wrap(async (req, res) => {
    const status = String(req.body.status || '').toUpperCase();
    const message =
      typeof req.body.message === 'string'
        ? req.body.message.slice(0, 1000)
        : '';

    if (!['SUCCESS', 'FAILED'].includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }

    const updated = await db.completeCommand(
      req.params.deviceId,
      req.params.commandId,
      status,
      message,
    );

    if (!updated) {
      return res.status(404).json({ error: 'command not found' });
    }

    res.json({ status: 'ok' });
  }),
);

app.post('/api/devices/:deviceId/push-token', requireDevice, wrap(async (req, res) => {
  const { pushToken } = req.body;
  if (typeof pushToken !== 'string' || pushToken.length < 20 || pushToken.length > 500) {
    return res.status(400).json({ error: 'invalid pushToken' });
  }
  await db.setPushToken(req.params.deviceId, pushToken);
  res.json({ status: 'ok' });
}));

app.post('/api/devices/:deviceId/sync', requireDevice, wrap(async (req, res) => {
  const validation = deviceHealth.validateHealthPayload(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  // Advances last_seen_at and the new first-class health columns. Only
  // fields the device actually sent are changed - see recordDeviceHealth().
  await db.recordDeviceHealth(req.params.deviceId, validation.value);

  // Best-effort only: an alerts bug must never fail a device's sync. Reads
  // the just-saved health back (not `validation.value`, which only has the
  // fields this particular payload sent) so diagnose() sees the full picture.
  try {
    const freshDevice = await db.getDeviceHealth(req.params.deviceId);
    if (freshDevice) await alerts.syncAlertsForDevice(freshDevice);
  } catch (e) {
    console.warn(`[alerts] sync failed for device ${req.params.deviceId}:`, e.message);
  }

  // The existing status JSONB stays populated exactly as before (the admin
  // panel already reads model/androidVersion/isDeviceOwner/lastSeen from it
  // directly) - untouched by this change, still driven from the raw body.
  await db.setStatus(req.params.deviceId, {
    model: validation.value.model,
    androidVersion: validation.value.androidVersion,
    isDeviceOwner: req.body.isDeviceOwner === true,
    lastSeen: new Date().toISOString(),
  });

  const policy = normalizePolicy(req.device.policy);
  const allowed = new Set(policy.allowedApps);

  // Opportunistic only and globally throttled. Device sync never waits for
  // Google Play; it serves the shared cached metadata immediately and one
  // background worker refreshes stale catalog rows for the whole fleet.
  kickAutoPlayMetadataRefresh();

  // Additive app-store fields (category/categoryLabel/isRecommended/
  // sortOrder) alongside the original ones - never renamed, never removed,
  // so an older client that only reads the fields it already knows about
  // keeps working unchanged (see docs/app-store-catalog.md's "Device sync
  // contract" section). isRecommended/category are only ever computed for
  // apps that already passed the `allowed` filter above - a device can
  // never see recommended/category metadata for an app it isn't approved
  // for, since it never sees that app's row at all (no separate policy
  // check needed here; filtering already happened before this .map).
  const catalog = (await db.listAppsCatalog())
    .filter(app => allowed.has(app.packageName))
    .map(({ packageName, name, iconUrl, playVersion, playUpdatedAt, category, isRecommended, sortOrder }) => ({
      packageName,
      name,
      iconUrl,
      playVersion,
      playUpdatedAt,
      category,
      categoryLabel: appCategories.categoryLabel(category),
      isRecommended,
      sortOrder,
    }));

  const commands = await db.takePendingCommands(req.params.deviceId);

  // Only reached once the whole sync succeeded - last_sync_at must not
  // advance on a failed sync (an exception above skips this and 500s instead).
  await db.markSyncSuccessful(req.params.deviceId);

  // A customer's own in-app toggle not yet confirmed by the server (see
  // Config.setDnsPendingCustomerRequest in the app) - honored only if this
  // device is actually allowed to self-toggle, re-derived here from our own
  // stored value rather than trusted from the client. Applied before
  // building the "dns" response below so this same round trip reflects the
  // outcome immediately instead of making the device wait for a second sync.
  let desiredProviderHost = req.device.dnsDesiredProviderHost || null;
  let desiredFilteringRequested = Boolean(req.device.dnsFilteringRequested);
  if (
    validation.value.customerDnsToggleRequest !== undefined &&
    req.device.allowCustomerDnsToggle === true
  ) {
    const updated = await db.setDnsDesiredState(
      req.params.deviceId, DNS_PROVIDER_HOST, validation.value.customerDnsToggleRequest,
    );
    desiredProviderHost = updated.dnsDesiredProviderHost || null;
    desiredFilteringRequested = Boolean(updated.dnsFilteringRequested);
  }

  const dns = {
    desiredProviderHost,
    filteringRequested: desiredFilteringRequested,
    allowCustomerToggle: Boolean(req.device.allowCustomerDnsToggle),
    desiredProviderFilters: DNS_PROVIDER_FILTERS_CONTENT,
  };

  res.json({ policy, catalog, commands, dns });
}));

app.post('/api/devices/:deviceId/policy/sync-interval', requireAdmin,
  wrap(async (req, res) => {
    const { minutes } = req.body;
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) {
      return res.status(400).json({ error: 'minutes must be between 15 and 1440' });
    }
    const device = await db.getDevice(req.params.deviceId);
    if (!device) {
      return res.status(404).json({ error: 'device not found' });
    }
    const policy = normalizePolicy(device.policy);
    policy.syncIntervalMinutes = minutes;
    res.json(await savePolicyAndWake(device, policy));
  }));

// ---------- Filtered Browser: Browser Policy API (Phase 1) ----------
// Full contract: /docs/server-api-contract.md. Any error thrown below is
// left to the wrap()/global-error-handler below to turn into a plain 500 -
// deliberately not caught here into a fabricated decision object, because
// the client is contractually required to treat any non-2xx as blocked
// (never ALLOW). See browserPolicy.js's module doc for the full reasoning.

// Phase 2.3 resource-abuse hardening: every /browser/check call does at
// least one PostgreSQL round-trip plus an unconditional browser_decision_log
// INSERT (see db.logBrowserDecision), and an unknown domain adds a full
// BEGIN/COMMIT transaction on top (db.recordBrowserRequest) - a single
// compromised or malfunctioning device could otherwise spam this endpoint
// enough to exhaust DB write capacity/disk. Same in-memory fixed-window
// pattern as loginRateLimited above (no Redis - single backend process);
// exceeding it returns 429 with no decision object, which the client
// already must treat exactly like any other non-2xx response (see
// server-api-contract.md's fail-closed guarantee) - this can never become
// a silent ALLOW, only ever a "stays blocked."
const browserCheckAttempts = new Map();
const BROWSER_CHECK_RATE_LIMIT_WINDOW_MS =
  Number(process.env.BROWSER_CHECK_RATE_LIMIT_WINDOW_MS) || 10000;
const BROWSER_CHECK_RATE_LIMIT_MAX =
  Number(process.env.BROWSER_CHECK_RATE_LIMIT_MAX) || 40;

/** Bounds how many /browser/check calls one device can make per window. */
function browserCheckRateLimited(deviceId) {
  const now = Date.now();
  const entry = browserCheckAttempts.get(deviceId);
  if (!entry || now - entry.first > BROWSER_CHECK_RATE_LIMIT_WINDOW_MS) {
    browserCheckAttempts.set(deviceId, { first: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > BROWSER_CHECK_RATE_LIMIT_MAX;
}

app.post('/api/devices/:deviceId/browser/check', requireDevice, wrap(async (req, res) => {
  if (browserCheckRateLimited(req.params.deviceId)) {
    return res.status(429).json({ error: 'too many browser checks, try again shortly' });
  }
  const parsed = browserPolicy.parseNavigationUrl(req.body && req.body.url);
  if (!parsed) {
    return res.status(400).json({ error: 'url must be a valid absolute URL' });
  }

  const policyVersion = await db.getBrowserPolicyVersion();

  // Dangerous/forbidden schemes are an explicit, immediate BLOCK - checked
  // BEFORE any host validation, and regardless of whether a host is even
  // present. file:/data:/javascript:/blob: parse with an empty hostname
  // (see parseNavigationUrl's doc); intent:// often does have one. Neither
  // case is a 400 (the client asking is itself meaningful signal, not a
  // malformed request) and neither is REVIEW (there is nothing uncertain
  // about a dangerous scheme).
  if (browserPolicy.isForbiddenScheme(parsed.scheme)) {
    const auditDomain = parsed.host || parsed.scheme;
    const decision = browserPolicy.buildDecisionResponse({
      decision: browserPolicy.DECISIONS.BLOCK,
      domain: auditDomain,
      decisionVersion: 0,
      policyVersion,
      allowSubdomains: false,
      reason: 'forbidden_scheme',
    });
    await db.logBrowserDecision(crypto.randomUUID(), {
      deviceId: req.params.deviceId, domain: auditDomain, url: req.body.url,
      decision: decision.decision, source: 'forbidden_scheme',
    });
    return res.json(decision);
  }
  if (!parsed.host || !browserPolicy.isValidDomainLabel(parsed.host) || browserPolicy.isIpLiteralHost(parsed.host)) {
    const decision = browserPolicy.buildDecisionResponse({
      decision: browserPolicy.DECISIONS.BLOCK,
      domain: parsed.host,
      decisionVersion: 0,
      policyVersion,
      allowSubdomains: false,
      reason: 'invalid_or_ip_literal_host',
    });
    await db.logBrowserDecision(crypto.randomUUID(), {
      deviceId: req.params.deviceId, domain: parsed.host, url: req.body.url,
      decision: decision.decision, source: 'invalid_host',
    });
    return res.json(decision);
  }

  const decision = await browserPolicy.evaluateDomain({
    db, host: parsed.host, url: req.body.url, deviceId: req.params.deviceId,
  });
  await db.logBrowserDecision(crypto.randomUUID(), {
    deviceId: req.params.deviceId, domain: parsed.host, url: req.body.url,
    decision: decision.decision, source: 'policy_engine',
  });
  res.json(decision);
}));

// ---------- Filtered Browser: signed offline policy snapshot (Phase 2.4) ----------
// Full contract: docs/server-api-contract.md's "Signed offline policy
// snapshot" section. Deliberately separate from /browser/check above -
// that endpoint's ALLOW/BLOCK/REVIEW semantics and response shape are
// completely unchanged by this addition (see docs/server-progress.md for
// the explicit confirmation this phase never touched browserPolicy.js).
//
// Fail-closed by construction, not by a try/catch here: policySigning.
// loadSigningConfig()/signSnapshot() throw on a missing/malformed key, a
// monotonicity violation, or any other problem, and this route does not
// catch them - they propagate to wrap()'s catch(next) and the global
// error handler below, which always responds 500 with no envelope body.
// There is no code path in this route that can return an object shaped
// like a signed snapshot without it actually having been signed.
app.get('/api/devices/:deviceId/browser/policy-snapshot', requireDevice, wrap(async (req, res) => {
  const { privateKey, keyId } = policySigning.loadSigningConfig();
  const [policyVersion, domains] = await Promise.all([
    db.getBrowserPolicyVersion(),
    db.listBrowserDomainsForSnapshot(),
  ]);
  const payload = policySigning.buildBrowserPolicySnapshot({ policyVersion, domains });
  const envelope = policySigning.signSnapshot(payload, { privateKey, keyId });
  res.json(envelope);
}));

// Admin-only for now - see docs/app-update-check.md-style honesty note in
// policySigning.js: the public key is meant for Android eventually, but
// "may be distributed to Android later" (per this phase's own scope) is
// not the same as "must be a public unauthenticated endpoint today". An
// admin can retrieve/document/pin it now; broadening this to an
// unauthenticated device-facing endpoint is a later, separate decision.
app.get('/api/browser/policy/signing-key', requireAdmin, wrap(async (req, res) => {
  const { privateKey, keyId } = policySigning.loadSigningConfig();
  res.json(policySigning.derivePublicKeyInfo(privateKey, keyId));
}));

app.get('/api/browser/domains', requireAdmin, wrap(async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const decision = typeof req.query.decision === 'string' ? req.query.decision : undefined;
  res.json(await db.listBrowserDomains({ search, decision }));
}));

app.post('/api/browser/domains', requireAdmin, wrap(async (req, res) => {
  const decision = req.body.decision;
  if (!Object.values(browserPolicy.DECISIONS).includes(decision)) {
    return res.status(400).json({ error: 'decision must be one of ALLOW, BLOCK, REVIEW' });
  }
  const allowSubdomains = req.body.allowSubdomains === true;
  // Public Suffix / shared-hosting hardening (Phase 1.1) - see
  // browserPolicy.validateDomainRuleInput's own doc for why a bare
  // "github.io"/"co.uk"/"blogspot.com" style rule, or allowSubdomains on
  // anything narrower than the true registrable domain, is rejected here
  // rather than silently accepted.
  const validation = browserPolicy.validateDomainRuleInput(req.body && req.body.domain, allowSubdomains);
  if (!validation.ok) {
    return res.status(400).json({ error: `invalid domain: ${validation.reason}` });
  }
  const saved = await db.upsertBrowserDomain({
    domain: validation.host,
    decision,
    allowSubdomains,
    category: typeof req.body.category === 'string' ? req.body.category : null,
    riskScore: typeof req.body.riskScore === 'number' ? req.body.riskScore : null,
    confidence: typeof req.body.confidence === 'number' ? req.body.confidence : null,
    reason: typeof req.body.reason === 'string' ? req.body.reason : null,
    approvalMethod: 'admin_manual',
    actor: req.admin && req.admin.username,
  });
  res.json(saved);
}));

// Deletes a global rule (reverts the domain to "no decision" = REVIEW).
// A clear, safe, auditable semantic - never touches device overrides or
// request history (see db.deleteBrowserDomain's own doc).
app.delete('/api/browser/domains/:domain', requireAdmin, wrap(async (req, res) => {
  const host = browserPolicy.normalizeHost(req.params.domain);
  const deleted = await db.deleteBrowserDomain(host, {
    actor: req.admin && req.admin.username,
    reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
  });
  if (!deleted) {
    return res.status(404).json({ error: 'no rule exists for this domain' });
  }
  res.json({ status: 'deleted', domain: host });
}));

app.get('/api/browser/requests', requireAdmin, wrap(async (req, res) => {
  res.json(await db.listPendingBrowserRequests());
}));

// Per-device breakdown of one request - lets the admin panel show exactly
// which devices are still waiting vs. already answered before picking a
// DEVICE-scope target (see "Global vs Device scope" - the UI must never
// let an admin think they approved one device when they approved everyone,
// or vice versa).
app.get('/api/browser/requests/:id/devices', requireAdmin, wrap(async (req, res) => {
  res.json(await db.listBrowserRequestDevices(req.params.id));
}));

app.post('/api/browser/requests/:id/resolve', requireAdmin, wrap(async (req, res) => {
  const scope = req.body && req.body.scope;
  if (scope !== 'GLOBAL' && scope !== 'DEVICE') {
    return res.status(400).json({ error: 'scope must be GLOBAL or DEVICE' });
  }
  const decision = req.body.decision;
  if (decision !== browserPolicy.DECISIONS.ALLOW && decision !== browserPolicy.DECISIONS.BLOCK) {
    return res.status(400).json({ error: 'decision must be ALLOW or BLOCK' });
  }
  if (scope === 'DEVICE' && !req.body.deviceId) {
    return res.status(400).json({ error: 'deviceId is required when scope is DEVICE' });
  }
  if (scope === 'GLOBAL') {
    // Same Public Suffix hardening as POST /api/browser/domains, applied
    // BEFORE resolving - a request's domain always originated from a real
    // navigation host (see evaluateDomain), but that only guarantees valid
    // syntax/non-IP, not that it's safe to grant as a global rule (e.g. a
    // customer could have navigated to the bare "github.io" itself).
    // allowSubdomains is never set via this path (resolveBrowserRequest's
    // GLOBAL branch always writes false), so validated as false here too.
    const domain = await db.getPendingBrowserRequestDomain(req.params.id);
    if (!domain) {
      return res.status(404).json({ error: 'request not found or already resolved' });
    }
    const validation = browserPolicy.validateDomainRuleInput(domain, false);
    if (!validation.ok) {
      return res.status(400).json({
        error: `cannot resolve globally, domain failed validation: ${validation.reason}`,
      });
    }
  }
  const result = await db.resolveBrowserRequest(req.params.id, {
    scope,
    decision,
    deviceId: req.body.deviceId,
    reason: typeof req.body.reason === 'string' ? req.body.reason : null,
    actor: req.admin && req.admin.username,
  });
  if (!result) {
    // GLOBAL: request already resolved or never existed. DEVICE: this
    // specific device has no still-pending row on this request (already
    // resolved for them, or they never actually requested this domain) -
    // NOT necessarily "the request is gone", which is why this is worth
    // a distinct message rather than reusing the GLOBAL 404 text.
    return res.status(404).json({
      error: scope === 'GLOBAL'
        ? 'request not found or already resolved'
        : 'no pending request found for this device on this domain (already resolved, or never requested)',
    });
  }
  res.json({
    status: 'resolved',
    domain: result.domain,
    scope: result.scope,
    ...(result.scope === 'DEVICE' ? {
      deviceId: result.deviceId,
      // Tells the admin panel whether this was the LAST device still
      // waiting (request now fully closed) or others remain pending -
      // exactly the distinction the UI must never blur (see item 6).
      requestFullyResolved: result.requestFullyResolved,
    } : {}),
  });
}));

// Recent policy-CHANGE audit trail (never browsing history - see
// db.insertAuditRow's doc). Optional ?domain= to see one domain's history.
app.get('/api/browser/audit', requireAdmin, wrap(async (req, res) => {
  const domain = typeof req.query.domain === 'string' ? browserPolicy.normalizeHost(req.query.domain) : undefined;
  res.json(await db.listBrowserPolicyAudit({ domain, limit: req.query.limit }));
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.PORT || 3000;

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend listening on port ${PORT}`);

      // Warm/maintain the shared Play metadata cache independently of device
      // count. A sleeping host simply resumes on its next wake; sync traffic
      // also calls kickAutoPlayMetadataRefresh(), so no separate worker is
      // required for correctness.
      kickAutoPlayMetadataRefresh();
      setInterval(kickAutoPlayMetadataRefresh, AUTO_PLAY_REFRESH_INTERVAL_MS).unref();
      if (!AUTH_ENABLED) {
        console.warn('WARNING: admin panel is UNPROTECTED.');
        console.warn('Run "node setup-admin.js <user> <password>" before exposing this server.');
      }
    });
  })
  .catch(err => {
    console.error('Failed to initialise the database:', err.message);
    process.exit(1);
  });
