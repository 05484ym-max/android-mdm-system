from pathlib import Path

# --- backend: allow HEIC/HEIF back through the media proxy ---
p = Path('backend/index.js')
s = p.read_text(encoding='utf-8')
old = "if (!['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'].includes(contentType)) {"
new = "if (!['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/webm'].includes(contentType)) {"
if old not in s:
    raise SystemExit('backend proxy whitelist target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# --- admin panel: Android/Samsung can report HEIC (and sometimes images) with empty MIME ---
p = Path('admin-panel/news.js')
s = p.read_text(encoding='utf-8')
anchor = "  function clearLocalPreviewUrl() {\n"
helper = '''  function selectedMediaKind(file) {\n    if (!file) return null;\n    const mime = String(file.type || '').toLowerCase();\n    const name = String(file.name || '').toLowerCase();\n    if (mime.startsWith('image/') || /\\.(png|jpe?g|webp|heic|heif)$/.test(name)) return 'IMAGE';\n    if (mime.startsWith('video/') || /\\.(mp4|webm)$/.test(name)) return 'VIDEO';\n    return null;\n  }\n\n'''
if anchor not in s:
    raise SystemExit('news.js helper anchor not found')
s = s.replace(anchor, helper + anchor, 1)
old = "    const type = file.type.startsWith('image/') ? 'IMAGE' : 'VIDEO';\n"
new = "    const type = selectedMediaKind(file);\n"
if old not in s:
    raise SystemExit('news.js preview classification target not found')
s = s.replace(old, new, 1)
old = "      const image = file.type.startsWith('image/');\n      const video = file.type.startsWith('video/');\n      if (!image && !video) {\n"
new = "      const kind = selectedMediaKind(file);\n      const image = kind === 'IMAGE';\n      const video = kind === 'VIDEO';\n      if (!kind) {\n"
if old not in s:
    raise SystemExit('news.js validation target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# --- DPC policy: explicitly permit our accessibility service under Device Owner ---
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt')
s = p.read_text(encoding='utf-8')
anchor = "        dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)\n\n        val allowed = policy.allowedApps.toSet() + playStoreTemporaryAllowance()\n"
replacement = "        dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)\n\n        // Explicitly permit this DPC's accessibility service. Some Samsung/One UI\n        // builds otherwise surface the service as blocked by the device administrator.\n        allowManagedAccessibilityService()\n\n        val allowed = policy.allowedApps.toSet() + playStoreTemporaryAllowance()\n"
if anchor not in s:
    raise SystemExit('PolicyEnforcer apply anchor not found')
s = s.replace(anchor, replacement, 1)
anchor = "    private fun applyFullOpen(): EnforcementResult {\n"
method = '''    fun allowManagedAccessibilityService() {\n        check(isDeviceOwner()) { "Not device owner" }\n        try {\n            dpm.setPermittedAccessibilityServices(admin, listOf(context.packageName))\n        } catch (_: Exception) {\n            // Keep policy sync alive on OEMs that reject this API unexpectedly.\n        }\n    }\n\n'''
if anchor not in s:
    raise SystemExit('PolicyEnforcer method anchor not found')
s = s.replace(anchor, method + anchor, 1)
anchor = "        dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)\n        disableKiosk()\n\n        val recovered = mutableListOf<String>()\n"
replacement = "        dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)\n        try { dpm.setPermittedAccessibilityServices(admin, null) } catch (_: Exception) {}\n        disableKiosk()\n\n        val recovered = mutableListOf<String>()\n"
if anchor not in s:
    raise SystemExit('PolicyEnforcer full-open anchor not found')
s = s.replace(anchor, replacement, 1)
p.write_text(s, encoding='utf-8')

# --- Customer UI: never invoke the A31-crashing Accessibility Settings intent directly ---
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = p.read_text(encoding='utf-8')
start = s.index('    private fun openWhatsAppAccessibilitySettings() {')
end = s.index('    private fun compactPersonalIdentityCard()', start)
new_fn = '''    private fun openWhatsAppAccessibilitySettings() {\n        // Ensure Device Owner explicitly permits our accessibility service before\n        // sending the customer into Settings. Older Samsung/One UI devices can\n        // otherwise label the service as blocked by the administrator.\n        try {\n            val enforcer = PolicyEnforcer(this)\n            if (enforcer.isDeviceOwner()) enforcer.allowManagedAccessibilityService()\n        } catch (_: Exception) {\n            // The Settings guidance below is still useful even if the OEM rejects it.\n        }\n\n        // Galaxy A31 can crash com.android.settings when\n        // ACTION_ACCESSIBILITY_SETTINGS is invoked directly. Open only the public\n        // top-level Settings screen and guide the user from there.\n        val intent = Intent(Settings.ACTION_SETTINGS).apply {\n            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)\n        }\n        Toast.makeText(\n            this,\n            "היכנסו: נגישות > שירותים מותקנים > יהודי כשר — הגנת WhatsApp",\n            Toast.LENGTH_LONG\n        ).show()\n        try {\n            if (intent.resolveActivity(packageManager) != null) startActivity(intent)\n        } catch (_: Exception) {\n            Toast.makeText(\n                this,\n                "פתחו ידנית: הגדרות > נגישות > שירותים מותקנים > יהודי כשר — הגנת WhatsApp",\n                Toast.LENGTH_LONG\n            ).show()\n        }\n    }\n\n'''
s = s[:start] + new_fn + s[end:]
p.write_text(s, encoding='utf-8')
