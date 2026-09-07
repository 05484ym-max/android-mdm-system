from pathlib import Path

# 1) Store: only call an app "installed" when it is really available to the current user.
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/AppStoreActivity.kt')
s = p.read_text(encoding='utf-8')
start = s.index('    private fun isInstalled(packageName: String): Boolean {')
end = s.index('    private fun confirmQuickUninstall', start)
new_fn = '''    private fun isInstalled(packageName: String): Boolean {\n        // Store status is customer-visible state, not retained package metadata.\n        // Do NOT use MATCH_UNINSTALLED_PACKAGES here: Samsung can return rows\n        // for packages removed/hidden for the current user, which made absent\n        // apps appear as \"מותקן\". Require a normal current-user lookup, not\n        // hidden by Device Owner, and a launchable activity.\n        return try {\n            val info = packageManager.getApplicationInfo(packageName, 0)\n            if ((info.flags and ApplicationInfo.FLAG_INSTALLED) == 0) return false\n\n            val dpm = getSystemService(DevicePolicyManager::class.java)\n            if (dpm.isDeviceOwnerApp(this.packageName)) {\n                val admin = ComponentName(this, DpcDeviceAdminReceiver::class.java)\n                if (dpm.isApplicationHidden(admin, packageName)) return false\n            }\n\n            packageManager.getLaunchIntentForPackage(packageName) != null\n        } catch (_: PackageManager.NameNotFoundException) {\n            false\n        } catch (_: Exception) {\n            false\n        }\n    }\n\n'''
s = s[:start] + new_fn + s[end:]
p.write_text(s, encoding='utf-8')

# 2) Accessibility: temporarily leave kiosk, open official Accessibility settings,
# and restore cached kiosk policy when returning to the app.
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = p.read_text(encoding='utf-8')
anchor = '    private var isNewsActive = false\n'
if 'private var accessibilitySetupWindowOpen' not in s:
    s = s.replace(anchor, anchor + '    private var accessibilitySetupWindowOpen = false\n', 1)
old_resume = '''    override fun onResume() {\n        super.onResume()\n        if (::contentArea.isInitialized && isPersonalAreaActive) {\n            showPersonalArea()\n        }\n    }\n'''
new_resume = '''    override fun onResume() {\n        super.onResume()\n        if (accessibilitySetupWindowOpen) {\n            accessibilitySetupWindowOpen = false\n            // Restore the cached kiosk policy immediately on return; no network\n            // dependency is required to close the temporary setup window.\n            try {\n                PolicyEnforcer(this).restoreCachedKioskPolicy()\n            } catch (_: Exception) {\n                SyncScheduler.enqueueImmediate(applicationContext)\n            }\n        }\n        if (::contentArea.isInitialized && isPersonalAreaActive) {\n            showPersonalArea()\n        }\n    }\n'''
if old_resume not in s:
    raise SystemExit('CustomerActivity onResume target not found')
s = s.replace(old_resume, new_resume, 1)
start = s.index('    private fun openWhatsAppAccessibilitySettings() {')
end = s.index('    private fun compactPersonalIdentityCard()', start)
new_access = '''    private fun openWhatsAppAccessibilitySettings() {\n        try {\n            val enforcer = PolicyEnforcer(this)\n            if (!enforcer.isDeviceOwner()) {\n                Toast.makeText(this, \"המכשיר אינו במצב ניהול מלא\", Toast.LENGTH_LONG).show()\n                return\n            }\n            enforcer.allowManagedAccessibilityService()\n            // Samsung A31 blocks/crashes the accessibility UI while our kiosk\n            // lock task is active. Open a very narrow temporary setup window:\n            // Device Owner and all user restrictions stay active; only kiosk/home\n            // pinning is suspended until this Activity resumes.\n            enforcer.disableKiosk()\n            accessibilitySetupWindowOpen = true\n        } catch (e: Exception) {\n            Toast.makeText(this, \"לא ניתן לפתוח חלון נגישות: ${e.message}\", Toast.LENGTH_LONG).show()\n            return\n        }\n\n        val attempts = listOf(\n            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS),\n            Intent(Settings.ACTION_SETTINGS),\n        )\n        Toast.makeText(\n            this,\n            \"הפעילו: יהודי כשר — הגנת WhatsApp\",\n            Toast.LENGTH_LONG\n        ).show()\n        for (intent in attempts) {\n            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)\n            if (intent.resolveActivity(packageManager) == null) continue\n            try {\n                startActivity(intent)\n                return\n            } catch (_: Exception) {}\n        }\n        accessibilitySetupWindowOpen = false\n        try { PolicyEnforcer(this).restoreCachedKioskPolicy() } catch (_: Exception) {}\n        Toast.makeText(this, \"לא ניתן לפתוח את הגדרות הנגישות במכשיר זה\", Toast.LENGTH_LONG).show()\n    }\n\n'''
s = s[:start] + new_access + s[end:]
p.write_text(s, encoding='utf-8')

# 3) Policy helper: restore kiosk from cached policy without needing network.
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt')
s = p.read_text(encoding='utf-8')
anchor = '    /** Also used as a local escape hatch from the admin screen. */\n    fun disableKiosk() {\n'
method = '''    fun restoreCachedKioskPolicy() {\n        check(isDeviceOwner()) { \"Not device owner\" }\n        if (Config.kioskEnabled(context)) {\n            enableKiosk(Config.allowedApps(context).toSet())\n        } else {\n            disableKiosk()\n        }\n    }\n\n'''
if 'fun restoreCachedKioskPolicy()' not in s:
    if anchor not in s:
        raise SystemExit('PolicyEnforcer restore anchor not found')
    s = s.replace(anchor, method + anchor, 1)
p.write_text(s, encoding='utf-8')

# 4) Media: support larger phone photos and do not trust GitHub's returned MIME
# for HEIC/HEIF; derive the trusted MIME from the DB metadata for this asset.
p = Path('backend/index.js')
s = p.read_text(encoding='utf-8')
s = s.replace('const NEWS_IMAGE_MAX_BYTES = 10 * 1024 * 1024;', 'const NEWS_IMAGE_MAX_BYTES = 50 * 1024 * 1024;', 1)
old_route = '''app.get('/api/customer-updates/media/:assetId', wrap(async (req, res) => {\n  if (!/^\\d+$/.test(req.params.assetId)) {\n    return res.status(400).json({ error: 'invalid media asset id' });\n  }\n  const storageConfig = apkStorage.loadStorageConfig();\n  const range = req.get('range');\n  const upstream = await apkStorage.downloadApk(\n    storageConfig,\n    req.params.assetId,\n    range ? { Range: range } : {},\n  );\n  const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();\n  if (!['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/webm'].includes(contentType)) {\n    throw new Error('GitHub media asset returned an invalid content type');\n  }\n'''
new_route = '''app.get('/api/customer-updates/media/:assetId', wrap(async (req, res) => {\n  if (!/^\\d+$/.test(req.params.assetId)) {\n    return res.status(400).json({ error: 'invalid media asset id' });\n  }\n  const mediaMeta = await db.getCustomerUpdateMediaByStorageKey(req.params.assetId);\n  if (!mediaMeta || !mediaMeta.mediaMimeType) {\n    return res.status(404).json({ error: 'media asset not found' });\n  }\n  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/webm']);\n  const contentType = String(mediaMeta.mediaMimeType).toLowerCase();\n  if (!allowedTypes.has(contentType)) {\n    return res.status(415).json({ error: 'unsupported stored media type' });\n  }\n  const storageConfig = apkStorage.loadStorageConfig();\n  const range = req.get('range');\n  const upstream = await apkStorage.downloadApk(\n    storageConfig,\n    req.params.assetId,\n    range ? { Range: range } : {},\n  );\n'''
if old_route not in s:
    raise SystemExit('media proxy route target not found')
s = s.replace(old_route, new_route, 1)
p.write_text(s, encoding='utf-8')

# 5) DB lookup for media metadata by exact storage key.
p = Path('backend/db.js')
s = p.read_text(encoding='utf-8')
marker = 'async function getCustomerUpdateById('
idx = s.find(marker)
if idx < 0:
    raise SystemExit('db getCustomerUpdateById marker not found')
# insert before the function so declaration order is irrelevant but locality is good
method = '''async function getCustomerUpdateMediaByStorageKey(storageKey) {\n  const { rows } = await pool.query(\n    `SELECT media_storage_key AS \"mediaStorageKey\", media_mime_type AS \"mediaMimeType\"\n       FROM customer_updates\n      WHERE media_storage_key = $1\n      LIMIT 1`,\n    [String(storageKey)],\n  );\n  return rows[0] || null;\n}\n\n'''
if 'async function getCustomerUpdateMediaByStorageKey' not in s:
    s = s[:idx] + method + s[idx:]
# export it near getCustomerUpdateById export
export_marker = '  getCustomerUpdateById,\n'
if export_marker not in s:
    raise SystemExit('db export marker not found')
if '  getCustomerUpdateMediaByStorageKey,\n' not in s:
    s = s.replace(export_marker, '  getCustomerUpdateMediaByStorageKey,\n' + export_marker, 1)
p.write_text(s, encoding='utf-8')

# 6) Admin UI: align image limit with backend and show the real server error.
p = Path('admin-panel/news.js')
s = p.read_text(encoding='utf-8')
s = s.replace('const limit = image ? 10 * 1024 * 1024 : 50 * 1024 * 1024;', 'const limit = 50 * 1024 * 1024;', 1)
s = s.replace("formError.textContent = image ? 'התמונה גדולה מ-10MB' : 'הסרטון גדול מ-50MB';", "formError.textContent = 'הקובץ גדול מ-50MB';", 1)
p.write_text(s, encoding='utf-8')
