const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

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
    devices.push({ deviceId, registeredAt: new Date().toISOString() });
    saveDevices();
  }
  res.json({ status: 'registered', deviceId });
});

app.get('/api/devices', (req, res) => {
  res.json(devices);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
