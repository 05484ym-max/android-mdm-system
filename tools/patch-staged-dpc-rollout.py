from pathlib import Path

# ----- backend/db.js -----
p = Path('backend/db.js')
s = p.read_text(encoding='utf-8')

s = s.replace(
    '''    fullOpenMode: row.full_open_mode === true,\n''',
    '''    fullOpenMode: row.full_open_mode === true,\n    isTestDevice: row.is_test_device === true,\n''',
    1,
)
s = s.replace(
    '''            customer_name, customer_number, subscription_unblock_until, subscription_unblock_permanent, full_open_mode\n''',
    '''            customer_name, customer_number, subscription_unblock_until, subscription_unblock_permanent, full_open_mode, is_test_device\n''',
    1,
)

anchor = '''const setFullOpenMode = (deviceId, enabled) =>\n  updateDeviceField(deviceId, 'full_open_mode', enabled === true);\n'''
insert = anchor + '''\nconst setTestDevice = (deviceId, enabled) =>\n  updateDeviceField(deviceId, 'is_test_device', enabled === true);\n'''
if anchor not in s:
    raise SystemExit('setFullOpenMode anchor missing')
s = s.replace(anchor, insert, 1)

release_anchor = '''// ---------- alerts ----------\n'''
release_code = '''// ---------- DPC releases ----------\n\nfunction mapAppReleaseRow(row) {\n  return {\n    versionCode: row.version_code,\n    versionName: row.version_name,\n    apkUrl: row.apk_url,\n    sha256: row.sha256,\n    releaseStatus: row.release_status,\n    rolloutPercentage: row.rollout_percentage,\n    createdAt: row.created_at.toISOString(),\n    notes: row.notes,\n  };\n}\n\nasync function ensureAppRelease({ versionCode, versionName = null, apkUrl, sha256 }) {\n  await pool.query(\n    `INSERT INTO app_releases\n       (version_code, version_name, apk_url, sha256, release_status, rollout_percentage)\n     VALUES ($1, $2, $3, $4, 'TEST', 0)\n     ON CONFLICT (version_code) DO NOTHING`,\n    [versionCode, versionName, apkUrl, sha256],\n  );\n  const { rows } = await pool.query(\n    `SELECT * FROM app_releases WHERE version_code = $1`,\n    [versionCode],\n  );\n  return rows[0] ? mapAppReleaseRow(rows[0]) : null;\n}\n\nasync function listAppReleases() {\n  const { rows } = await pool.query(\n    `SELECT * FROM app_releases ORDER BY version_code DESC`,\n  );\n  return rows.map(mapAppReleaseRow);\n}\n\nasync function updateAppReleaseControl(versionCode, releaseStatus, rolloutPercentage) {\n  const { rows } = await pool.query(\n    `UPDATE app_releases\n        SET release_status = $2, rollout_percentage = $3\n      WHERE version_code = $1\n      RETURNING *`,\n    [versionCode, releaseStatus, rolloutPercentage],\n  );\n  return rows[0] ? mapAppReleaseRow(rows[0]) : null;\n}\n\n'''+release_anchor
if release_anchor not in s:
    raise SystemExit('alerts anchor missing')
s = s.replace(release_anchor, release_code, 1)

exports_anchor = '''  setFullOpenMode,\n  setPolicy,\n'''
exports_new = '''  setFullOpenMode,\n  setTestDevice,\n  setPolicy,\n'''
if exports_anchor not in s:
    raise SystemExit('exports device anchor missing')
s = s.replace(exports_anchor, exports_new, 1)
exports_anchor2 = '''  getDeviceHealth,\n  queueCommand,\n'''
exports_new2 = '''  getDeviceHealth,\n  ensureAppRelease,\n  listAppReleases,\n  updateAppReleaseControl,\n  queueCommand,\n'''
if exports_anchor2 not in s:
    raise SystemExit('exports release anchor missing')
s = s.replace(exports_anchor2, exports_new2, 1)
p.write_text(s, encoding='utf-8')

# ----- backend/index.js -----
p = Path('backend/index.js')
s = p.read_text(encoding='utf-8')
s = s.replace("const path = require('path');\n", "const path = require('path');\nconst fs = require('fs');\n", 1)
s = s.replace(
    "const imageModerationCache = require('./imageModerationCache');\n",
    "const imageModerationCache = require('./imageModerationCache');\nconst releaseRollout = require('./releaseRollout');\n",
    1,
)

const_anchor = '''const NEWS_IMAGE_MAX_BYTES = 10 * 1024 * 1024;\n'''
helper = const_anchor + '''\nlet dpcMetadataFileCache = null;\n\nasync function ensureCurrentDpcRelease() {\n  const metadataPath = path.join(__dirname, '../admin-panel/downloads/version.json');\n  const apkPath = path.join(__dirname, '../admin-panel/downloads/mdm.apk');\n  const raw = await fs.promises.readFile(metadataPath, 'utf8');\n  const metadata = JSON.parse(raw);\n  const versionCode = Number(metadata.versionCode);\n  if (!Number.isInteger(versionCode) || versionCode <= 0) {\n    throw new Error('published DPC versionCode is invalid');\n  }\n  const apkUrl = String(metadata.apkUrl || '').trim();\n  if (!apkUrl.startsWith('https://')) {\n    throw new Error('published DPC apkUrl must use HTTPS');\n  }\n\n  let sha256 = typeof metadata.sha256 === 'string' ? metadata.sha256.toLowerCase() : '';\n  if (!/^[0-9a-f]{64}$/.test(sha256)) {\n    if (dpcMetadataFileCache?.versionCode === versionCode) {\n      sha256 = dpcMetadataFileCache.sha256;\n    } else {\n      const apk = await fs.promises.readFile(apkPath);\n      sha256 = crypto.createHash('sha256').update(apk).digest('hex');\n      dpcMetadataFileCache = { versionCode, sha256 };\n    }\n  }\n\n  return db.ensureAppRelease({\n    versionCode,\n    versionName: metadata.versionName || null,\n    apkUrl,\n    sha256,\n  });\n}\n'''
if const_anchor not in s:
    raise SystemExit('index constant anchor missing')
s = s.replace(const_anchor, helper, 1)

admin_anchor = '''app.get('/api/devices', requireAdmin, wrap(async (req, res) => {\n  const devices = await db.listDevices();\n  res.json(devices.map(publicDevice));\n}));\n'''
admin_routes = admin_anchor + '''\napp.put('/api/devices/:deviceId/test-device', requireAdmin, wrap(async (req, res) => {\n  if (typeof req.body.isTestDevice !== 'boolean') {\n    return res.status(400).json({ error: 'isTestDevice boolean is required' });\n  }\n  const updated = await db.setTestDevice(req.params.deviceId, req.body.isTestDevice);\n  if (!updated) return res.status(404).json({ error: 'device not found' });\n  res.json(publicDevice(updated));\n}));\n\napp.get('/api/releases', requireAdmin, wrap(async (req, res) => {\n  const current = await ensureCurrentDpcRelease();\n  const releases = await db.listAppReleases();\n  res.json(releases.map(release => ({\n    ...release,\n    isCurrent: release.versionCode === current.versionCode,\n  })));\n}));\n\napp.put('/api/releases/:versionCode/control', requireAdmin, wrap(async (req, res) => {\n  const versionCode = Number(req.params.versionCode);\n  if (!Number.isInteger(versionCode) || versionCode <= 0) {\n    return res.status(400).json({ error: 'invalid versionCode' });\n  }\n  let control;\n  try {\n    control = releaseRollout.normalizeReleaseControl(req.body.status, req.body.rolloutPercentage);\n  } catch (e) {\n    return res.status(400).json({ error: e.message });\n  }\n  const updated = await db.updateAppReleaseControl(\n    versionCode,\n    control.status,\n    control.rolloutPercentage,\n  );\n  if (!updated) return res.status(404).json({ error: 'release not found' });\n  res.json(updated);\n}));\n'''
if admin_anchor not in s:
    raise SystemExit('admin devices anchor missing')
s = s.replace(admin_anchor, admin_routes, 1)

device_anchor = '''app.get('/api/devices/:deviceId/policy', requireDevice, (req, res) => {\n'''
device_route = '''app.get('/api/devices/:deviceId/update-metadata', requireDevice, wrap(async (req, res) => {\n  const release = await ensureCurrentDpcRelease();\n  const eligible = releaseRollout.isDeviceEligibleForRelease(release, {\n    deviceId: req.params.deviceId,\n    isTestDevice: req.device.isTestDevice === true,\n  });\n  res.set('Cache-Control', 'no-store');\n  if (!eligible) return res.status(204).end();\n  res.json({\n    versionCode: release.versionCode,\n    versionName: release.versionName,\n    apkUrl: release.apkUrl,\n    sha256: release.sha256,\n    releaseStatus: release.releaseStatus,\n    rolloutPercentage: release.rolloutPercentage,\n  });\n}));\n\n'''+device_anchor
if device_anchor not in s:
    raise SystemExit('device policy anchor missing')
s = s.replace(device_anchor, device_route, 1)
p.write_text(s, encoding='utf-8')

# ----- AutoUpdater.kt -----
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/AutoUpdater.kt')
s = p.read_text(encoding='utf-8')
s = s.replace('import java.net.URL\n', 'import java.net.URL\nimport java.net.URLEncoder\n', 1)
old_meta = '''        val baseUrl = Config.serverUrl(context).trimEnd('/')\n        val metadataUrl = "$baseUrl/downloads/version.json"\n\n        val metadata = JSONObject(downloadText(metadataUrl))\n        val remoteVersion = metadata.getLong("versionCode")\n'''
new_meta = '''        val baseUrl = Config.serverUrl(context).trimEnd('/')\n        val deviceToken = Config.deviceToken(context) ?: run {\n            Log.w(TAG, "No device token - skipping staged update check")\n            return\n        }\n        val deviceId = Config.deviceId(context)\n        val encodedDeviceId = URLEncoder.encode(deviceId, Charsets.UTF_8.name())\n        val metadataUrl = "$baseUrl/api/devices/$encodedDeviceId/update-metadata"\n\n        val metadataText = downloadText(metadataUrl, deviceToken) ?: run {\n            Log.i(TAG, "No DPC update assigned to this device")\n            return\n        }\n        val metadata = JSONObject(metadataText)\n        val remoteVersion = metadata.getLong("versionCode")\n'''
if old_meta not in s:
    raise SystemExit('AutoUpdater metadata block missing')
s = s.replace(old_meta, new_meta, 1)
old_download = '''    private fun downloadText(url: String): String {\n        val connection = URL(url).openConnection() as HttpURLConnection\n\n        try {\n            connection.connectTimeout = 15000\n            connection.readTimeout = 15000\n            connection.requestMethod = "GET"\n\n            if (connection.responseCode !in 200..299) {\n                error("HTTP ${connection.responseCode}")\n            }\n\n            return connection.inputStream\n                .bufferedReader()\n                .use { it.readText() }\n        } finally {\n            connection.disconnect()\n        }\n    }\n'''
new_download = '''    private fun downloadText(url: String, deviceToken: String): String? {\n        val connection = URL(url).openConnection() as HttpURLConnection\n\n        try {\n            connection.connectTimeout = 15000\n            connection.readTimeout = 15000\n            connection.requestMethod = "GET"\n            connection.setRequestProperty("Authorization", "Bearer $deviceToken")\n\n            val code = connection.responseCode\n            if (code == HttpURLConnection.HTTP_NO_CONTENT) return null\n            if (code !in 200..299) {\n                error("HTTP $code")\n            }\n\n            return connection.inputStream\n                .bufferedReader()\n                .use { it.readText() }\n        } finally {\n            connection.disconnect()\n        }\n    }\n'''
if old_download not in s:
    raise SystemExit('AutoUpdater downloadText block missing')
s = s.replace(old_download, new_download, 1)
old_verify_call = '''            downloadFile(apkUrl, apk)\n            verifyApk(context, apk, remoteVersion)\n'''
new_verify_call = '''            downloadFile(apkUrl, apk)\n            val expectedSha256 = metadata.optString("sha256").trim().lowercase()\n            if (expectedSha256.isNotEmpty() && sha256OfFile(apk) != expectedSha256) {\n                error("DPC APK SHA-256 mismatch")\n            }\n            verifyApk(context, apk, remoteVersion)\n'''
if old_verify_call not in s:
    raise SystemExit('AutoUpdater verify call missing')
s = s.replace(old_verify_call, new_verify_call, 1)
sha_anchor = '''    private fun sha256(data: ByteArray): String =\n'''
sha_file = '''    private fun sha256OfFile(file: File): String {\n        val digest = MessageDigest.getInstance("SHA-256")\n        file.inputStream().use { input ->\n            val buffer = ByteArray(8192)\n            while (true) {\n                val read = input.read(buffer)\n                if (read < 0) break\n                digest.update(buffer, 0, read)\n            }\n        }\n        return digest.digest().joinToString("") { "%02x".format(it) }\n    }\n\n'''+sha_anchor
if sha_anchor not in s:
    raise SystemExit('AutoUpdater sha anchor missing')
s = s.replace(sha_anchor, sha_file, 1)
p.write_text(s, encoding='utf-8')

# ----- build-dpc.yml -----
p = Path('.github/workflows/build-dpc.yml')
s = p.read_text(encoding='utf-8')
checksum_anchor = '''          CHECKSUM=$(python3 -c "import base64,sys; print(base64.urlsafe_b64encode(bytes.fromhex(sys.argv[1])).decode().rstrip('='))" "$CERT_HEX")\n'''
checksum_new = checksum_anchor + '''          APK_SHA256=$(sha256sum "$APK" | awk '{print $1}')\n'''
if checksum_anchor not in s:
    raise SystemExit('build checksum anchor missing')
s = s.replace(checksum_anchor, checksum_new, 1)
s = s.replace(
    '''          python3 - "${{ github.run_number }}" <<'PYVER'\n          import json, sys\n\n          version_code = int(sys.argv[1])\n''',
    '''          python3 - "${{ github.run_number }}" "$APK_SHA256" <<'PYVER'\n          import json, sys\n\n          version_code = int(sys.argv[1])\n          sha256 = sys.argv[2]\n''',
    1,
)
s = s.replace(
    '''              "apkUrl": "https://android-mdm-system.onrender.com/downloads/mdm.apk"\n''',
    '''              "apkUrl": "https://android-mdm-system.onrender.com/downloads/mdm.apk",\n              "sha256": sha256\n''',
    1,
)
p.write_text(s, encoding='utf-8')

# ----- admin-panel/index.html -----
p = Path('admin-panel/index.html')
s = p.read_text(encoding='utf-8')
css_anchor = '<link rel="stylesheet" href="permanent-release.css" />\n'
if css_anchor not in s:
    raise SystemExit('panel CSS anchor missing')
s = s.replace(css_anchor, css_anchor + '<link rel="stylesheet" href="release-control.css" />\n', 1)
script_anchor = '<script src="permanent-release.js"></script>\n'
if script_anchor not in s:
    raise SystemExit('panel script anchor missing')
s = s.replace(script_anchor, script_anchor + '<script src="release-control.js"></script>\n', 1)
p.write_text(s, encoding='utf-8')
