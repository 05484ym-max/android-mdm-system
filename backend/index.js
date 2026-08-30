require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const push = require('./push');

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
   'OPEN_PLAY_STORE_INSTALL'];
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
    jwt.verify(token, JWT_SECRET);
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
    return /^https?:\/\//.test(params.apkUrl || '')
      ? null
      : 'apkUrl must be an http(s) URL';
  }
  if (command === 'UNINSTALL_APP' || command === 'OPEN_PLAY_STORE_INSTALL') {
    return PACKAGE_NAME_REGEX.test(params.packageName || '')
      ? null
      : 'packageName is invalid';
  }
  return null;
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
  const device = await db.getDevice(req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
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
  const { model, androidVersion, isDeviceOwner } = req.body;
  const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);

  await db.setStatus(req.params.deviceId, {
    model: str(model, 100),
    androidVersion: str(androidVersion, 20),
    isDeviceOwner: isDeviceOwner === true,
    lastSeen: new Date().toISOString(),
  });

  const policy = normalizePolicy(req.device.policy);
  const allowed = new Set(policy.allowedApps);
  const catalog = (await db.listAppsCatalog())
    .filter(app => allowed.has(app.packageName))
    .map(({ packageName, name, iconUrl }) => ({ packageName, name, iconUrl }));

  res.json({
    policy,
    catalog,
    commands: await db.takePendingCommands(req.params.deviceId),
  });
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.PORT || 3000;

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend listening on port ${PORT}`);
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
