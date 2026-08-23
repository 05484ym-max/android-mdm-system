const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../admin-panel')));

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'devices.json');

function loadDevices() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveDevices() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(devices, null, 2));
}

let devices = loadDevices();

const PACKAGE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function withSubscriptionStatus(device) {
  let subscriptionStatus = 'none';
  if (device.subscription) {
    subscriptionStatus = new Date(device.subscription.expiryDate) > new Date() ? 'active' : 'expired';
  }
  return { ...device, subscriptionStatus, policy: device.policy || { allowedApps: [] } };
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/devices/register', (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }
  const existing = devices.find(d => d.deviceId === deviceId);
  if (!existing) {
    devices.push({
      deviceId,
      registeredAt: new Date().toISOString(),
      subscription: null,
      policy: { allowedApps: [] },
    });
    saveDevices();
  }
  res.json({ status: 'registered', deviceId });
});

app.get('/api/devices', (req, res) => {
  res.json(devices.map(withSubscriptionStatus));
});

app.post('/api/devices/:deviceId/subscription', (req, res) => {
  const { deviceId } = req.params;
  const { price } = req.body;

  if (typeof price !== 'number' || price < 0) {
    return res.status(400).json({ error: 'price must be a non-negative number' });
  }

  const device = devices.find(d => d.deviceId === deviceId);
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

  res.json(withSubscriptionStatus(device));
});

app.post('/api/devices/:deviceId/policy/apps', (req, res) => {
  const { deviceId } = req.params;
  const { packageName } = req.body;

  if (typeof packageName !== 'string' || !PACKAGE_NAME_REGEX.test(packageName)) {
    return res.status(400).json({ error: 'invalid packageName format' });
  }

  const device = devices.find(d => d.deviceId === deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }

  if (!device.policy) {
    device.policy = { allowedApps: [] };
  }
  if (!device.policy.allowedApps.includes(packageName)) {
    device.policy.allowedApps.push(packageName);
    saveDevices();
  }

  res.json(withSubscriptionStatus(device));
});

app.delete('/api/devices/:deviceId/policy/apps/:packageName', (req, res) => {
  const { deviceId, packageName } = req.params;

  const device = devices.find(d => d.deviceId === deviceId);
  if (!device) {
    return res.status(404).json({ error: 'device not found' });
  }

  if (device.policy) {
    device.policy.allowedApps = device.policy.allowedApps.filter(p => p !== packageName);
    saveDevices();
  }

  res.json(withSubscriptionStatus(device));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
