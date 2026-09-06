from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'{label} marker not found in {path}')
    p.write_text(s.replace(old, new, 1))

# ---- DB schema + mapping + write helper ----
replace_once('backend/db.js',
"ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_number TEXT;\n",
"ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_number TEXT;\nALTER TABLE devices ADD COLUMN IF NOT EXISTS subscription_unblock_until TIMESTAMPTZ;\nALTER TABLE devices ADD COLUMN IF NOT EXISTS subscription_unblock_permanent BOOLEAN NOT NULL DEFAULT false;\n",
'db schema')

replace_once('backend/db.js',
"    customerNumber: row.customer_number,\n",
"    customerNumber: row.customer_number,\n    subscriptionUnblockUntil: row.subscription_unblock_until ? row.subscription_unblock_until.toISOString() : null,\n    subscriptionUnblockPermanent: row.subscription_unblock_permanent === true,\n",
'db mapping')

replace_once('backend/db.js',
"    `SELECT device_id, registered_at, subscription, policy, status,\n            customer_name, customer_number\n",
"    `SELECT device_id, registered_at, subscription, policy, status,\n            customer_name, customer_number, subscription_unblock_until, subscription_unblock_permanent\n",
'db list select')

replace_once('backend/db.js',
"const setSubscription = (deviceId, value) =>\n  updateDeviceField(deviceId, 'subscription', value);\n",
"const setSubscription = (deviceId, value) =>\n  updateDeviceField(deviceId, 'subscription', value);\n\nasync function setSubscriptionUnblock(deviceId, until, permanent) {\n  const { rows } = await pool.query(\n    `UPDATE devices\n        SET subscription_unblock_until = $2,\n            subscription_unblock_permanent = $3\n      WHERE device_id = $1\n      RETURNING *`,\n    [deviceId, until || null, permanent === true],\n  );\n  return rows[0] ? toDevice(rows[0]) : null;\n}\n",
'db setter')

replace_once('backend/db.js',
"  setSubscription,\n  setPolicy,\n",
"  setSubscription,\n  setSubscriptionUnblock,\n  setPolicy,\n",
'db export')

# ---- Backend access computation + admin route + sync payload ----
replace_once('backend/index.js',
"function publicDevice(device) {\n",
"function subscriptionAccess(device, now = new Date()) {\n  const subscriptionActive = Boolean(\n    device.subscription &&\n    device.subscription.expiryDate &&\n    new Date(device.subscription.expiryDate) > now\n  );\n  const permanent = device.subscriptionUnblockPermanent === true;\n  const until = device.subscriptionUnblockUntil ? new Date(device.subscriptionUnblockUntil) : null;\n  const temporary = Boolean(until && !Number.isNaN(until.getTime()) && until > now);\n  const overrideActive = permanent || temporary;\n  return {\n    allowed: subscriptionActive || overrideActive,\n    subscriptionActive,\n    overrideActive,\n    overridePermanent: permanent,\n    overrideUntil: permanent ? null : (temporary ? until.toISOString() : null),\n    source: subscriptionActive ? 'SUBSCRIPTION' : permanent ? 'PERMANENT' : temporary ? 'TEMPORARY' : 'NONE',\n  };\n}\n\nfunction publicDevice(device) {\n",
'backend access helper')

replace_once('backend/index.js',
"    subscriptionStatus,\n    policy: normalizePolicy(device.policy),\n",
"    subscriptionStatus,\n    subscriptionAccess: subscriptionAccess(device),\n    policy: normalizePolicy(device.policy),\n",
'public device access')

route_marker = "app.post('/api/devices/:deviceId/customer', requireAdmin, wrap(async (req, res) => {"
route = """const subscriptionUnblockAdminLimiter = rateLimit({\n  windowMs: 60 * 1000,\n  limit: 60,\n  standardHeaders: 'draft-7',\n  legacyHeaders: false,\n  message: { error: 'too many subscription unblock changes; try again shortly' },\n});\n\napp.post('/api/devices/:deviceId/subscription-unblock', subscriptionUnblockAdminLimiter, requireAdmin, wrap(async (req, res) => {\n  const device = await db.getDevice(req.params.deviceId);\n  if (!device) return res.status(404).json({ error: 'device not found' });\n\n  const mode = typeof req.body.mode === 'string' ? req.body.mode : '';\n  let until = null;\n  let permanent = false;\n  const now = new Date();\n\n  if (mode === '24h') {\n    until = new Date(now.getTime() + 24 * 60 * 60 * 1000);\n  } else if (mode === 'days') {\n    const days = Number(req.body.days);\n    if (!Number.isInteger(days) || days < 1 || days > 3650) {\n      return res.status(400).json({ error: 'days must be an integer between 1 and 3650' });\n    }\n    until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);\n  } else if (mode === 'until') {\n    if (typeof req.body.until !== 'string') return res.status(400).json({ error: 'until is required' });\n    until = new Date(req.body.until);\n    const max = new Date(now);\n    max.setFullYear(max.getFullYear() + 10);\n    if (Number.isNaN(until.getTime()) || until <= now || until > max) {\n      return res.status(400).json({ error: 'until must be a future date within 10 years' });\n    }\n  } else if (mode === 'permanent') {\n    permanent = true;\n  } else if (mode !== 'clear') {\n    return res.status(400).json({ error: 'invalid mode' });\n  }\n\n  const updated = await db.setSubscriptionUnblock(\n    req.params.deviceId,\n    until ? until.toISOString() : null,\n    permanent,\n  );\n  await push.wake(device.pushToken);\n  res.json(publicDevice(updated));\n}));\n\n""" + route_marker
replace_once('backend/index.js', route_marker, route, 'admin unblock route')

replace_once('backend/index.js',
"  res.json({ policy, catalog, commands, dns });\n",
"  res.json({ policy, catalog, commands, dns, subscriptionAccess: subscriptionAccess(req.device) });\n",
'sync access payload')

# ---- Admin panel: expose data globally, load unified card + unblock UI ----
replace_once('admin-panel/index.html',
"  allDevices = await res.json();\n",
"  allDevices = await res.json();\n  window.__allDevices = allDevices;\n",
'admin expose devices')

replace_once('admin-panel/index.html',
"<script src=\"support.js\"></script>\n",
"<script src=\"support.js\"></script>\n<script src=\"customer-search.js\"></script>\n<script src=\"subscription-unblock.js\"></script>\n",
'admin scripts')

# Fix the unified customer card to read the actual top-level `let allDevices` mirror.
p = Path('admin-panel/customer-search.js')
s = p.read_text()
s = s.replace('window.allDevices', 'window.__allDevices')
p.write_text(s)

print('subscription unblock patch applied')
