from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'pattern occurs {text.count(old)} times in {path}')
    p.write_text(text.replace(old, new, 1))

# backend: persist WhatsApp Guard inside the existing JSON policy object.
replace_once(
    'backend/index.js',
    """function normalizePolicy(policy) {\n  return {\n    allowedApps: (policy && policy.allowedApps) || [],\n    kioskEnabled: Boolean(policy && policy.kioskEnabled),\n    syncIntervalMinutes:\n      (policy && policy.syncIntervalMinutes) || DEFAULT_SYNC_INTERVAL_MINUTES,\n  };\n}""",
    """function normalizePolicy(policy) {\n  const whatsappGuard = policy && policy.whatsappGuard;\n  return {\n    allowedApps: (policy && policy.allowedApps) || [],\n    kioskEnabled: Boolean(policy && policy.kioskEnabled),\n    syncIntervalMinutes:\n      (policy && policy.syncIntervalMinutes) || DEFAULT_SYNC_INTERVAL_MINUTES,\n    whatsappGuard: {\n      blockStatuses: Boolean(whatsappGuard && whatsappGuard.blockStatuses),\n      blockChannels: Boolean(whatsappGuard && whatsappGuard.blockChannels),\n      hideProfilePhotos: Boolean(whatsappGuard && whatsappGuard.hideProfilePhotos),\n    },\n  };\n}""",
)

anchor = """app.post('/api/devices/:deviceId/policy/kiosk', requireAdmin, wrap(async (req, res) => {\n  const { enabled } = req.body;\n  if (typeof enabled !== 'boolean') {\n    return res.status(400).json({ error: 'enabled must be a boolean' });\n  }\n  const device = await db.getDevice(req.params.deviceId);\n  if (!device) {\n    return res.status(404).json({ error: 'device not found' });\n  }\n  const policy = normalizePolicy(device.policy);\n  policy.kioskEnabled = enabled;\n  res.json(await savePolicyAndWake(device, policy));\n}));\n"""
route = anchor + """\n// WhatsApp Guard is part of the managed DPC policy, but each protection can\n// be controlled independently. The server validates every field instead of\n// trusting the admin UI and wakes the device after the JSON policy is saved.\napp.post('/api/devices/:deviceId/policy/whatsapp-guard', requireAdmin, wrap(async (req, res) => {\n  const body = req.body || {};\n  const keys = ['blockStatuses', 'blockChannels', 'hideProfilePhotos'];\n  if (!keys.every(key => typeof body[key] === 'boolean')) {\n    return res.status(400).json({ error: 'all WhatsApp Guard fields must be boolean' });\n  }\n  const device = await db.getDevice(req.params.deviceId);\n  if (!device) {\n    return res.status(404).json({ error: 'device not found' });\n  }\n  const policy = normalizePolicy(device.policy);\n  policy.whatsappGuard = {\n    blockStatuses: body.blockStatuses,\n    blockChannels: body.blockChannels,\n    hideProfilePhotos: body.hideProfilePhotos,\n  };\n  res.json(await savePolicyAndWake(device, policy));\n}));\n"""
replace_once('backend/index.js', anchor, route)

# Android API model/parsing.
replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt',
    """data class Policy(\n    val allowedApps: List<String>,\n    val kioskEnabled: Boolean,\n    val syncIntervalMinutes: Int,\n    val fullOpen: Boolean = false,\n)""",
    """data class Policy(\n    val allowedApps: List<String>,\n    val kioskEnabled: Boolean,\n    val syncIntervalMinutes: Int,\n    val fullOpen: Boolean = false,\n    val whatsappGuard: WhatsAppGuardPolicy = WhatsAppGuardPolicy(),\n)""",
)
replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt',
    """        val policy = Policy(\n            allowedApps = (0 until apps.length()).map { apps.getString(it) },\n            kioskEnabled = policyJson.optBoolean(\"kioskEnabled\", false),\n            syncIntervalMinutes = policyJson.optInt(\n                \"syncIntervalMinutes\",\n                Config.DEFAULT_SYNC_MINUTES,\n            ),\n            fullOpen = policyJson.optBoolean(\"fullOpen\", false),\n        )""",
    """        val whatsappGuardJson = policyJson.optJSONObject(\"whatsappGuard\")\n        val policy = Policy(\n            allowedApps = (0 until apps.length()).map { apps.getString(it) },\n            kioskEnabled = policyJson.optBoolean(\"kioskEnabled\", false),\n            syncIntervalMinutes = policyJson.optInt(\n                \"syncIntervalMinutes\",\n                Config.DEFAULT_SYNC_MINUTES,\n            ),\n            fullOpen = policyJson.optBoolean(\"fullOpen\", false),\n            whatsappGuard = WhatsAppGuardPolicy(\n                blockStatuses = whatsappGuardJson?.optBoolean(\"blockStatuses\", false) ?: false,\n                blockChannels = whatsappGuardJson?.optBoolean(\"blockChannels\", false) ?: false,\n                hideProfilePhotos = whatsappGuardJson?.optBoolean(\"hideProfilePhotos\", false) ?: false,\n            ),\n        )""",
)

replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/PolicySync.kt',
    """        Config.setKioskEnabled(context, result.policy.kioskEnabled)\n        Config.setSyncIntervalMinutes(context, result.policy.syncIntervalMinutes)""",
    """        Config.setKioskEnabled(context, result.policy.kioskEnabled)\n        Config.setSyncIntervalMinutes(context, result.policy.syncIntervalMinutes)\n        WhatsAppGuardConfig.save(context, result.policy.whatsappGuard)""",
)

# Admin: add controls into the unified customer card.
p = Path('admin-panel/customer-search.js')
text = p.read_text()
old = """    const deviceStatus = d.status || {};\n    const lastCommands = history.slice(-5).reverse();"""
new = """    const deviceStatus = d.status || {};\n    const wa = p.whatsappGuard || { blockStatuses: false, blockChannels: false, hideProfilePhotos: false };\n    const lastCommands = history.slice(-5).reverse();"""
if old not in text: raise SystemExit('customer-search vars anchor missing')
text = text.replace(old, new, 1)
old = """      <div class=\"unified-profile-section\">\n        <h3>אפליקציות מותרות (${apps.length})</h3>"""
new = """      <div class=\"unified-profile-section whatsapp-guard-admin\">\n        <h3>🟢 הגנת WhatsApp</h3>\n        <div class=\"unified-command-summary\">כל חסימה נשלטת בנפרד ומסתנכרנת למכשיר.</div>\n        <div style=\"display:flex;flex-wrap:wrap;gap:8px;margin-top:10px\">\n          <button type=\"button\" class=\"toggle-btn ${wa.blockStatuses ? 'wa-on' : ''}\" data-wa-key=\"blockStatuses\">סטטוסים: ${wa.blockStatuses ? 'חסום' : 'פתוח'}</button>\n          <button type=\"button\" class=\"toggle-btn ${wa.blockChannels ? 'wa-on' : ''}\" data-wa-key=\"blockChannels\">ערוצים: ${wa.blockChannels ? 'חסום' : 'פתוח'}</button>\n          <button type=\"button\" class=\"toggle-btn ${wa.hideProfilePhotos ? 'wa-on' : ''}\" data-wa-key=\"hideProfilePhotos\">תמונות פרופיל: ${wa.hideProfilePhotos ? 'מוסתר' : 'גלוי'}</button>\n        </div>\n      </div>\n\n      <div class=\"unified-profile-section\">\n        <h3>אפליקציות מותרות (${apps.length})</h3>"""
if old not in text: raise SystemExit('customer-search section anchor missing')
text = text.replace(old, new, 1)
old = """    panel.querySelector('[data-unified-close]')?.addEventListener('click', () => {"""
new = """    panel.querySelectorAll('[data-wa-key]').forEach(btn => btn.addEventListener('click', async e => {\n      const key = e.currentTarget.getAttribute('data-wa-key');\n      const next = {\n        blockStatuses: Boolean(wa.blockStatuses),\n        blockChannels: Boolean(wa.blockChannels),\n        hideProfilePhotos: Boolean(wa.hideProfilePhotos),\n      };\n      next[key] = !next[key];\n      panel.querySelectorAll('[data-wa-key]').forEach(x => x.disabled = true);\n      try {\n        const response = await fetch(`/api/devices/${encodeURIComponent(d.deviceId)}/policy/whatsapp-guard`, {\n          method: 'POST',\n          headers: { 'Content-Type': 'application/json' },\n          body: JSON.stringify(next),\n        });\n        const body = await response.json().catch(() => ({}));\n        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);\n        const idx = devices.findIndex(x => x && x.deviceId === d.deviceId);\n        if (idx >= 0) devices[idx] = body;\n        render(d.deviceId);\n      } catch (err) {\n        alert('שמירת הגנת WhatsApp נכשלה: ' + (err && err.message ? err.message : err));\n        panel.querySelectorAll('[data-wa-key]').forEach(x => x.disabled = false);\n      }\n    }));\n\n    panel.querySelector('[data-unified-close]')?.addEventListener('click', () => {"""
if old not in text: raise SystemExit('customer-search listener anchor missing')
text = text.replace(old, new, 1)
p.write_text(text)

# Small visual state, without changing the panel's existing palette.
p = Path('admin-panel/news.css')
css = p.read_text()
marker = '\n/* WhatsApp Guard admin controls */\n'
if marker not in css:
    css += marker + ".whatsapp-guard-admin .toggle-btn.wa-on{background:var(--accent);color:#fff;border-color:var(--accent)}\n.whatsapp-guard-admin .toggle-btn:disabled{opacity:.55;cursor:wait}\n"
p.write_text(css)

print('WhatsApp Guard MDM integration patch applied')
