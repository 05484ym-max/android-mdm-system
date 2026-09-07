from pathlib import Path

# ----- backend/db.js -----
p = Path('backend/db.js')
s = p.read_text(encoding='utf-8')

schema_old = '''CREATE TABLE IF NOT EXISTS enrollments (\n  id         UUID PRIMARY KEY,\n  token_hash TEXT NOT NULL UNIQUE,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n  expires_at TIMESTAMPTZ NOT NULL,\n  used_at    TIMESTAMPTZ,\n  device_id  TEXT\n);\n'''
schema_new = schema_old + '''\n-- Recovery codes are deliberately distinct from normal enrollment codes.\n-- Existing rows become ENROLL automatically; RECOVERY rows are always bound\n-- to one existing device_id before the plaintext code is returned to admin.\nALTER TABLE enrollments ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'ENROLL';\n'''
if schema_old not in s:
    raise SystemExit('enrollment schema target not found')
s = s.replace(schema_old, schema_new, 1)

old_enroll = '''async function createEnrollment(id, tokenHash, expiresAt) {\n  await pool.query(\n    `INSERT INTO enrollments (id, token_hash, expires_at)\n     VALUES ($1, $2, $3)`,\n    [id, tokenHash, expiresAt],\n  );\n}\n\n/** Marks the code used only if it is still valid. Returns false otherwise. */\nasync function consumeEnrollment(tokenHash, deviceId) {\n  const { rowCount } = await pool.query(\n    `UPDATE enrollments\n        SET used_at = now(), device_id = $2\n      WHERE token_hash = $1\n        AND used_at IS NULL\n        AND expires_at > now()`,\n    [tokenHash, deviceId],\n  );\n  return rowCount > 0;\n}\n'''
new_enroll = '''async function createEnrollment(\n  id, tokenHash, expiresAt, purpose = 'ENROLL', deviceId = null,\n) {\n  if (!['ENROLL', 'RECOVERY'].includes(purpose)) {\n    throw new Error('invalid enrollment purpose');\n  }\n  if (purpose === 'RECOVERY' && !deviceId) {\n    throw new Error('recovery enrollment must be bound to a device');\n  }\n  await pool.query(\n    `INSERT INTO enrollments (id, token_hash, expires_at, purpose, device_id)\n     VALUES ($1, $2, $3, $4, $5)`,\n    [id, tokenHash, expiresAt, purpose, deviceId],\n  );\n}\n\n/** Marks a normal enrollment code used only if it is still valid. */\nasync function consumeEnrollment(tokenHash, deviceId) {\n  const { rowCount } = await pool.query(\n    `UPDATE enrollments\n        SET used_at = now(), device_id = $2\n      WHERE token_hash = $1\n        AND purpose = 'ENROLL'\n        AND used_at IS NULL\n        AND expires_at > now()`,\n    [tokenHash, deviceId],\n  );\n  return rowCount > 0;\n}\n\n/**\n * Consumes a device-bound recovery code and rotates the device credential in\n * one transaction. If either step fails the code remains unused. The old FCM\n * token is cleared so the recovered device registers its current token again.\n */\nasync function recoverDeviceAuthToken(tokenHash, deviceId, newAuthTokenHash) {\n  const client = await pool.connect();\n  try {\n    await client.query('BEGIN');\n    const { rowCount: codeCount } = await client.query(\n      `UPDATE enrollments\n          SET used_at = now()\n        WHERE token_hash = $1\n          AND purpose = 'RECOVERY'\n          AND device_id = $2\n          AND used_at IS NULL\n          AND expires_at > now()`,\n      [tokenHash, deviceId],\n    );\n    if (!codeCount) {\n      await client.query('ROLLBACK');\n      return false;\n    }\n\n    const { rowCount: deviceCount } = await client.query(\n      `UPDATE devices\n          SET auth_token_hash = $2, push_token = NULL\n        WHERE device_id = $1`,\n      [deviceId, newAuthTokenHash],\n    );\n    if (!deviceCount) {\n      await client.query('ROLLBACK');\n      return false;\n    }\n\n    await client.query('COMMIT');\n    return true;\n  } catch (e) {\n    try { await client.query('ROLLBACK'); } catch (_) {}\n    throw e;\n  } finally {\n    client.release();\n  }\n}\n'''
if old_enroll not in s:
    raise SystemExit('enrollment functions target not found')
s = s.replace(old_enroll, new_enroll, 1)

s = s.replace(
    '`SELECT id, created_at, expires_at, used_at, device_id\\n       FROM enrollments',
    '`SELECT id, created_at, expires_at, used_at, device_id, purpose\\n       FROM enrollments',
    1,
)
s = s.replace(
    '''    deviceId: row.device_id,\n  }));\n}\n\n// ---------- customer updates''',
    '''    deviceId: row.device_id,\n    purpose: row.purpose || 'ENROLL',\n  }));\n}\n\n// ---------- customer updates''',
    1,
)
if 'recoverDeviceAuthToken,' not in s:
    s = s.replace('  consumeEnrollment,\n', '  consumeEnrollment,\n  recoverDeviceAuthToken,\n', 1)
p.write_text(s, encoding='utf-8')

# ----- backend/index.js -----
p = Path('backend/index.js')
s = p.read_text(encoding='utf-8')
if 'const RECOVERY_TTL_MS' not in s:
    s = s.replace(
        'const ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000;\n',
        'const ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000;\nconst RECOVERY_TTL_MS = 30 * 60 * 1000;\n',
        1,
    )

anchor = '''app.get('/api/enrollments', requireAdmin, wrap(async (req, res) => {\n  res.json(await db.listEnrollments());\n}));\n'''
recovery_admin = anchor + '''\napp.post('/api/devices/:deviceId/recovery-code', requireAdmin, wrap(async (req, res) => {\n  const device = await db.getDevice(req.params.deviceId);\n  if (!device) return res.status(404).json({ error: 'device not found' });\n\n  const token = crypto.randomBytes(16).toString('hex').toUpperCase();\n  const expiresAt = new Date(Date.now() + RECOVERY_TTL_MS);\n  await db.createEnrollment(\n    crypto.randomUUID(),\n    sha256(token),\n    expiresAt,\n    'RECOVERY',\n    device.deviceId,\n  );\n  res.json({\n    token,\n    deviceId: device.deviceId,\n    expiresAt: expiresAt.toISOString(),\n  });\n}));\n'''
if anchor not in s:
    raise SystemExit('admin recovery route anchor not found')
s = s.replace(anchor, recovery_admin, 1)

limiter_anchor = '''const deviceRegistrationLimiter = rateLimit({\n  windowMs: 15 * 60 * 1000,\n  limit: 20,\n  standardHeaders: 'draft-7',\n  legacyHeaders: false,\n  message: { error: 'too many device registration attempts; try again later' },\n});\n'''
limiter_new = limiter_anchor + '''\nconst deviceRecoveryLimiter = rateLimit({\n  windowMs: 15 * 60 * 1000,\n  limit: 10,\n  standardHeaders: 'draft-7',\n  legacyHeaders: false,\n  message: { error: 'too many device recovery attempts; try again later' },\n});\n'''
if limiter_anchor not in s:
    raise SystemExit('device limiter anchor not found')
s = s.replace(limiter_anchor, limiter_new, 1)

register_end = '''  await db.createDevice(deviceId, sha256(deviceToken));\n  res.json({ status: 'enrolled', deviceId, deviceToken });\n}));\n'''
recover_route = register_end + '''\napp.post('/api/devices/:deviceId/recover', deviceRecoveryLimiter, wrap(async (req, res) => {\n  const { recoveryToken } = req.body;\n  if (typeof recoveryToken !== 'string' || !recoveryToken.trim()) {\n    return res.status(400).json({ error: 'recoveryToken is required' });\n  }\n\n  const deviceToken = crypto.randomBytes(32).toString('hex');\n  const recovered = await db.recoverDeviceAuthToken(\n    sha256(recoveryToken.trim().toUpperCase()),\n    req.params.deviceId,\n    sha256(deviceToken),\n  );\n  if (!recovered) {\n    return res.status(401).json({ error: 'invalid or expired recovery token' });\n  }\n  res.json({ status: 'recovered', deviceId: req.params.deviceId, deviceToken });\n}));\n'''
if register_end not in s:
    raise SystemExit('register route end not found')
s = s.replace(register_end, recover_route, 1)
p.write_text(s, encoding='utf-8')

# ----- DPC ApiClient.kt -----
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt')
s = p.read_text(encoding='utf-8')
enroll_method = '''    fun enroll(enrollmentToken: String): EnrollResult {\n        val body = request(\n            "POST",\n            "/api/devices/register",\n            JSONObject().put("enrollmentToken", enrollmentToken),\n        )\n        val json = JSONObject(body)\n        return EnrollResult(json.getString("deviceId"), json.getString("deviceToken"))\n    }\n'''
recover_method = enroll_method + '''\n    /** Rotates a lost device token without creating a second device record. */\n    fun recover(deviceId: String, recoveryToken: String): EnrollResult {\n        val body = request(\n            "POST",\n            "/api/devices/${segment(deviceId)}/recover",\n            JSONObject().put("recoveryToken", recoveryToken),\n        )\n        val json = JSONObject(body)\n        return EnrollResult(json.getString("deviceId"), json.getString("deviceToken"))\n    }\n'''
if enroll_method not in s:
    raise SystemExit('ApiClient enroll method not found')
s = s.replace(enroll_method, recover_method, 1)
p.write_text(s, encoding='utf-8')

# ----- DPC MainActivity.kt -----
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/MainActivity.kt')
s = p.read_text(encoding='utf-8')
old_call = '                val result = ApiClient(Config.serverUrl(this@MainActivity)).enroll(code)\n'
new_call = '''                val client = ApiClient(Config.serverUrl(this@MainActivity))\n                val existingId = Config.deviceId(this@MainActivity)\n                val result = if (existingId.matches(Regex("\\\\d{10}"))) {\n                    client.recover(existingId, code)\n                } else {\n                    client.enroll(code)\n                }\n'''
if old_call not in s:
    raise SystemExit('MainActivity enroll call not found')
s = s.replace(old_call, new_call, 1)
old_status = '        enrollStatusView.text = if (enrolled) "✓ המכשיר רשום בשרת" else "✕ המכשיר אינו רשום"\n'
new_status = '''        val existingId = Config.deviceId(this)\n        val recoverable = !enrolled && existingId.matches(Regex("\\\\d{10}"))\n        enrollStatusView.text = when {\n            enrolled -> "✓ המכשיר רשום בשרת"\n            recoverable -> "⚠ נדרש קוד שחזור למכשיר $existingId"\n            else -> "✕ המכשיר אינו רשום"\n        }\n'''
if old_status not in s:
    raise SystemExit('MainActivity enrollment status target not found')
s = s.replace(old_status, new_status, 1)
p.write_text(s, encoding='utf-8')

# ----- admin-panel/index.html -----
p = Path('admin-panel/index.html')
s = p.read_text(encoding='utf-8')
button_anchor = '''        <button class=\\"cmd-btn\\" data-cmd=\\"OPEN_DEBUGGING_TEMP\\">פתח ניפוי באגים זמנית</button>\n        <button class=\\"cmd-btn cmd-danger\\" data-cmd=\\"WIPE\\">מחיקת מכשיר</button>'''
button_new = '''        <button class=\\"cmd-btn\\" data-cmd=\\"OPEN_DEBUGGING_TEMP\\">פתח ניפוי באגים זמנית</button>\n        <button class=\\"cmd-btn\\" id=\\"detailRecoveryCode\\">קוד שחזור</button>\n        <button class=\\"cmd-btn cmd-danger\\" data-cmd=\\"WIPE\\">מחיקת מכשיר</button>'''
if button_anchor not in s:
    raise SystemExit('admin recovery button anchor not found')
s = s.replace(button_anchor, button_new, 1)

listener_anchor = "  document.querySelectorAll('#detailContent .cmd-btn').forEach(btn => {"
listener_new = '''  const recoveryBtn = document.getElementById('detailRecoveryCode');\n  if (recoveryBtn) {\n    recoveryBtn.addEventListener('click', async () => {\n      recoveryBtn.disabled = true;\n      try {\n        const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/recovery-code`, { method: 'POST' });\n        const data = await res.json().catch(() => ({}));\n        if (!res.ok) {\n          alert(data.error || 'יצירת קוד השחזור נכשלה');\n          return;\n        }\n        alert(`קוד שחזור למכשיר ${deviceId}:\\n\\n${data.token}\\n\\nהקוד חד-פעמי ותקף ל-30 דקות.`);\n      } finally {\n        recoveryBtn.disabled = false;\n      }\n    });\n  }\n\n  document.querySelectorAll('#detailContent .cmd-btn[data-cmd]').forEach(btn => {'''
if listener_anchor not in s:
    raise SystemExit('admin command listener anchor not found')
s = s.replace(listener_anchor, listener_new, 1)
p.write_text(s, encoding='utf-8')
