from pathlib import Path


def rep(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'missing marker in {path}: {old[:80]!r}')
    p.write_text(s.replace(old, new, 1))

# backend/db.js
rep('backend/db.js',
    'ALTER TABLE devices ADD COLUMN IF NOT EXISTS subscription_unblock_permanent BOOLEAN NOT NULL DEFAULT false;\n',
    'ALTER TABLE devices ADD COLUMN IF NOT EXISTS subscription_unblock_permanent BOOLEAN NOT NULL DEFAULT false;\nALTER TABLE devices ADD COLUMN IF NOT EXISTS full_open_mode BOOLEAN NOT NULL DEFAULT false;\n')
rep('backend/db.js',
    '    subscriptionUnblockPermanent: row.subscription_unblock_permanent === true,\n',
    '    subscriptionUnblockPermanent: row.subscription_unblock_permanent === true,\n    fullOpenMode: row.full_open_mode === true,\n')
rep('backend/db.js',
    '            customer_name, customer_number, subscription_unblock_until, subscription_unblock_permanent\n',
    '            customer_name, customer_number, subscription_unblock_until, subscription_unblock_permanent, full_open_mode\n')
rep('backend/db.js',
    'const setPolicy = (deviceId, value) =>\n  updateDeviceField(deviceId, \'policy\', value);\n',
    'const setFullOpenMode = (deviceId, enabled) =>\n  updateDeviceField(deviceId, \'full_open_mode\', enabled === true);\n\nconst setPolicy = (deviceId, value) =>\n  updateDeviceField(deviceId, \'policy\', value);\n')
rep('backend/db.js',
    '  setSubscriptionUnblock,\n  setPolicy,\n',
    '  setSubscriptionUnblock,\n  setFullOpenMode,\n  setPolicy,\n')

# backend/index.js
rep('backend/index.js',
    'app.post(\'/api/devices/:deviceId/customer\', requireAdmin, wrap(async (req, res) => {\n',
    "const fullOpenAdminLimiter = rateLimit({\n  windowMs: 60 * 1000,\n  limit: 30,\n  standardHeaders: 'draft-7',\n  legacyHeaders: false,\n  message: { error: 'too many full-open changes; try again shortly' },\n});\n\napp.post('/api/devices/:deviceId/full-open', fullOpenAdminLimiter, requireAdmin, wrap(async (req, res) => {\n  if (typeof req.body.enabled !== 'boolean') {\n    return res.status(400).json({ error: 'enabled must be boolean' });\n  }\n  const device = await db.getDevice(req.params.deviceId);\n  if (!device) return res.status(404).json({ error: 'device not found' });\n  const updated = await db.setFullOpenMode(req.params.deviceId, req.body.enabled);\n  await push.wake(device.pushToken);\n  res.json(publicDevice(updated));\n}));\n\napp.post('/api/devices/:deviceId/customer', requireAdmin, wrap(async (req, res) => {\n")
rep('backend/index.js',
    '  const policy = normalizePolicy(req.device.policy);\n  const allowed = new Set(policy.allowedApps);\n',
    '  const fullOpen = req.device.fullOpenMode === true;\n  const policy = normalizePolicy(req.device.policy);\n  policy.fullOpen = fullOpen;\n  const allowed = new Set(policy.allowedApps);\n')
rep('backend/index.js',
    '  const catalog = (await db.listAppsCatalog())\n    .filter(app => allowed.has(app.packageName))\n',
    '  const catalog = (await db.listAppsCatalog())\n    .filter(app => fullOpen || allowed.has(app.packageName))\n')
rep('backend/index.js',
    '  const dns = {\n    desiredProviderHost,\n    filteringRequested: desiredFilteringRequested,\n    allowCustomerToggle: Boolean(req.device.allowCustomerDnsToggle),\n    desiredProviderFilters: DNS_PROVIDER_FILTERS_CONTENT,\n  };\n\n  res.json({ policy, catalog, commands, dns, subscriptionAccess: subscriptionAccess(req.device) });\n',
    '  const dns = fullOpen ? {\n    desiredProviderHost: null,\n    filteringRequested: false,\n    allowCustomerToggle: false,\n    desiredProviderFilters: false,\n  } : {\n    desiredProviderHost,\n    filteringRequested: desiredFilteringRequested,\n    allowCustomerToggle: Boolean(req.device.allowCustomerDnsToggle),\n    desiredProviderFilters: DNS_PROVIDER_FILTERS_CONTENT,\n  };\n\n  const subscription = subscriptionAccess(req.device);\n  if (fullOpen) subscription.allowed = true;\n  res.json({ policy, catalog, commands, dns, subscriptionAccess: subscription });\n')

# Android API model
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt',
    'data class Policy(\n    val allowedApps: List<String>,\n    val kioskEnabled: Boolean,\n    val syncIntervalMinutes: Int,\n)\n',
    'data class Policy(\n    val allowedApps: List<String>,\n    val kioskEnabled: Boolean,\n    val syncIntervalMinutes: Int,\n    val fullOpen: Boolean = false,\n)\n')
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt',
    '            syncIntervalMinutes = policyJson.optInt(\n                "syncIntervalMinutes",\n                Config.DEFAULT_SYNC_MINUTES,\n            ),\n        )\n',
    '            syncIntervalMinutes = policyJson.optInt(\n                "syncIntervalMinutes",\n                Config.DEFAULT_SYNC_MINUTES,\n            ),\n            fullOpen = policyJson.optBoolean("fullOpen", false),\n        )\n')

# Android enforcement
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt',
    '    fun apply(policy: Policy): EnforcementResult {\n        check(isDeviceOwner()) { "Not device owner - cannot enforce policy" }\n\n',
    '    fun apply(policy: Policy): EnforcementResult {\n        check(isDeviceOwner()) { "Not device owner - cannot enforce policy" }\n        if (policy.fullOpen) return applyFullOpen()\n\n')
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt',
    '    /** The package backing the customer\'s currently active keyboard, or null if it\n',
    '''    private fun applyFullOpen(): EnforcementResult {\n        // Reversible full-open mode: make the phone behave normally while keeping\n        // Device Owner and anti-escape protections so the admin can re-apply policy remotely.\n        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)\n        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)\n        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)\n        dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)\n        dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)\n        dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)\n        disableKiosk()\n\n        val recovered = mutableListOf<String>()\n        val failed = mutableListOf<String>()\n        val installed = context.packageManager.getInstalledApplications(0)\n            .map { it.packageName }\n            .filter { it != context.packageName }\n            .distinct()\n\n        if (installed.isNotEmpty()) {\n            try {\n                val failedSuspended = dpm.setPackagesSuspended(admin, installed.toTypedArray(), false).toSet()\n                recovered += installed.filter { it !in failedSuspended }\n                failed += failedSuspended\n            } catch (_: Exception) {\n                // Continue with hidden-state recovery package-by-package.\n            }\n        }\n        for (pkg in installed) {\n            try {\n                if (dpm.isApplicationHidden(admin, pkg) && !dpm.setApplicationHidden(admin, pkg, false)) {\n                    failed += pkg\n                }\n            } catch (_: Exception) {\n                failed += pkg\n            }\n        }\n        return EnforcementResult(\n            suspended = emptyList(),\n            unsuspended = recovered.distinct() - failed.toSet(),\n            failed = failed.distinct(),\n            systemAppsSkipped = 0,\n            kioskEnabled = false,\n        )\n    }\n\n    /** The package backing the customer's currently active keyboard, or null if it\n''')

# Admin panel loader hooks
rep('admin-panel/index.html',
    '<link rel="stylesheet" href="subscription-unblock.css" />\n',
    '<link rel="stylesheet" href="subscription-unblock.css" />\n<link rel="stylesheet" href="full-open.css" />\n')
rep('admin-panel/index.html',
    '<script src="subscription-unblock.js"></script>\n',
    '<script src="subscription-unblock.js"></script>\n<script src="full-open.js"></script>\n')

print('full-open patch applied')
