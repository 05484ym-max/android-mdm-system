const express = require('express');
const app = express();
app.use(express.json());

const devices = [];

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
