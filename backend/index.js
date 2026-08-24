const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../admin-panel')));

const DATA_DIR = path.join(__dirname, 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const ENROLLMENTS_FILE = path.join(DATA_DIR, 'enrollments.json');

function load(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function save(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

let devices = load(DEVICES_FILE, []);
let enrollments = load(ENROLLMENTS_FILE, []);

const saveDevices = () => save(DEVICES_FILE, devices);
const saveEnrollments = () => save(ENROLLMENTS_FILE, enrollments);

const PACKAGE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const ALLOWED_COMMANDS = ['LOCK', 'SYNC_POLICY', 'REBOOT', 'WIPE'];
const ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

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

/** Guards the endpoints a managed device calls: the token must match that device. */
function requireDevice(req, res, next) {
  const device = devices.find(d => d.deviceId === req.params.deviceId);
  if (!device || !device.authTokenHash) {
    return res.status(404).json({ error: 'device not found' });
  }
  const token = bearerToken(req);
  if (!token || !digestsMatch(sha256(token), device.authTokenHash)) {
    return res.status(401).json({ error: 'invalid device token' });
  }
  req.device = device;
  next();
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
    policy: device.policy || { allowedApps: [], kioskEnabled: false },
    pendingCommands: device.pendingCommands || [],
    commandHistory: device.commandHistory || [],
  };
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------- enrollment (admin) ----------

app.post('/api/enrollments', (req, res) => {
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  const entry = {
    id: crypto.randomUUID(),
    tokenHash: sha256(token),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ENROLLMENT_TTL_MS).toISOString(),
    usedAt: null,
    deviceId: null,
  };
  enrollments.push(entry);
  saveEnrollments();
  res.json({ token, expiresAt: entry.expiresAt });
});

app.get('/api/enrollments', (req, res) => {
  res.json(enrollments.map(({ tokenHash, ...rest }) => rest));
});

// ---------- device endpoints ----------

app.post('/api/devices/register', (req, res) => {
  const { deviceId, enrollmentToken } = req.body;
  if (typeof deviceId !== 'string' || !deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const existing = devices.find(d => d.deviceId === deviceId);
  if (existing) {
    const token = bearerToken(req);
    if (token && digestsMatch(sha256(token), existing.authTokenHash)) {
      return res.json({ status: 'registered', deviceId });
    }
    return res.status(409).json({ error: 'device already enrolled' });
  }

  if (typeof enrollmentToken !== 'string' || !enrollmentToken) {
    return res.status(400).json({ error: 'enrollmentToken is required' });
  }

  const now = Date.now();
  const candidate = sha256(enrollmentToken.trim().toUpperCase());
  const enrollment = enrollments.find(e =>
    !e.usedAt &&
    new Date(e.expiresAt).getTime() > now &&
    digestsMatch(candidate, e.tokenHash));

  if (!enrollment) {
    return res.status(401).json({ error: 'invalid or expired enrollment token' });
  }

  const deviceToken = crypto.randomBytes(32).toString('hex');
  devices.push({
    deviceId,
    registeredAt: new Date().toISOString(),
    authTokenHash: sha256(deviceToken),
    subscription: null,
    policy: { allowedApps: [], kioskEnabled: false },
    pendingCommands: [],
    commandHistory: [],
  });
  enrollment.usedAt = new Date().toISOString();
  enrollment.deviceId = deviceId;
  saveDevices();
  saveEnrollments();

  res.json({ status: 'enrolled', deviceId, deviceToken });
});

app.get('/api/devices/:deviceId/policy', requireDevice, (req, res) => {
  const policy = req.device.policy || {};
  res.json({
    allowedApps: policy.allowedApps || [],
    kioskEnabled: policy.kioskEnabled === true,
  });
});

app.get('/api/devices/:deviceId/commands', requireDevice, (req, res) => {
  const device = req.device;
  const delivered = device.pendingCommands || [];
  if (!device.commandHistory) device.commandHistory = [];
  device.commandHistory.push(
    ...delivered.map(c => ({ ...c, deliveredAt: new Date().toISOString() }))
  );
  device.pendingCommands = [];
  saveDevices();
  res.json({ commands: delivered });
});

app.post('/api/devices/:deviceId/heartbeat', requireDevice, (req, res) => {
  const { model, androidVersion, isDeviceOwner } = req.body;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  req.device.status = {
    model: str(model, 100),
    androidVersion: str(androidVersion, 20),
    isDeviceOwner: isDeviceOwner === true,
    lastSeen: new Date().toISOString(),
  };
  saveDevices();
  res.json({ status: 'ok' });
});

// ---------- admin endpoints ----------

app.get('/api/devices', (req, res) => {
  res.json(devices.map(publicDevice));
});

app.post('/api/devices/:deviceId/subscription', (req, res) => {
  const { price } = req.body;
  if (typeof price !== 'number' || price < 0) {
    return res.status(400).json({ error: 'price must be a non-negative number' });
  }
  const device = devices.find(d => d.deviceId === req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }

  const startDate = new Date();
  const expiryDate = new Date(startDate);
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  device.subscription = {
    price,
    startDate: startDate.toISOString(),
    expiryDate: expiryDate.toISOString(),
  };
  saveDevices();
  res.json(publicDevice(device));
});

app.post('/api/devices/:deviceId/policy/apps', (req, res) => {
  const { packageName } = req.body;
  if (typeof packageName !== 'string' || !PACKAGE_NAME_REGEX.test(packageName)) {
    return res.status(400).json({ error: 'invalid packageName format' });
  }
  const device = devices.find(d => d.deviceId === req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }
  if (!device.policy) device.policy = { allowedApps: [], kioskEnabled: false };
  if (!device.policy.allowedApps.includes(packageName)) {
    device.policy.allowedApps.push(packageName);
    saveDevices();
  }
  res.json(publicDevice(device));
});

app.delete('/api/devices/:deviceId/policy/apps/:packageName', (req, res) => {
  const device = devices.find(d => d.deviceId === req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }
  if (device.policy) {
    device.policy.allowedApps =
      device.policy.allowedApps.filter(p => p !== req.params.packageName);
    saveDevices();
  }
  res.json(publicDevice(device));
});

app.post('/api/devices/:deviceId/policy/kiosk', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const device = devices.find(d => d.deviceId === req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }
  if (!device.policy) device.policy = { allowedApps: [], kioskEnabled: false };
  device.policy.kioskEnabled = enabled;
  saveDevices();
  res.json(publicDevice(device));
});

app.post('/api/devices/:deviceId/commands', (req, res) => {
  const { command } = req.body;
  if (!ALLOWED_COMMANDS.includes(command)) {
    return res.status(400).json({ error: 'invalid command' });
  }
  const device = devices.find(d => d.deviceId === req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }
  if (!device.pendingCommands) device.pendingCommands = [];
  device.pendingCommands.push({
    id: crypto.randomUUID(),
    command,
    queuedAt: new Date().toISOString(),
  });
  saveDevices();
  res.json(publicDevice(device));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
