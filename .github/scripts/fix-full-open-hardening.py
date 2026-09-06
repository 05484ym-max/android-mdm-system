from pathlib import Path


def rep(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'missing marker in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1))

# Authenticate admin before consuming the full-open rate limiter.
rep('backend/index.js',
    "app.post('/api/devices/:deviceId/full-open', fullOpenAdminLimiter, requireAdmin, wrap(async (req, res) => {\n",
    "app.post('/api/devices/:deviceId/full-open', requireAdmin, fullOpenAdminLimiter, wrap(async (req, res) => {\n")

# Persist the packages this DPC hid so a later full-open can recover them even on OEMs
# where hidden apps disappear from the normal PackageManager enumeration.
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt',
    '    private const val KEY_SUBSCRIPTION_EXPIRY_DATE = "subscription_expiry_date"\n',
    '    private const val KEY_SUBSCRIPTION_EXPIRY_DATE = "subscription_expiry_date"\n    private const val KEY_POLICY_HIDDEN_APPS = "policy_hidden_apps"\n')
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt',
    '    fun setAllowedApps(context: Context, apps: List<String>) {\n        prefs(context).edit().putStringSet(KEY_ALLOWED_APPS, apps.toSet()).apply()\n    }\n',
    '    fun setAllowedApps(context: Context, apps: List<String>) {\n        prefs(context).edit().putStringSet(KEY_ALLOWED_APPS, apps.toSet()).apply()\n    }\n\n    fun policyHiddenApps(context: Context): Set<String> =\n        prefs(context).getStringSet(KEY_POLICY_HIDDEN_APPS, emptySet()).orEmpty().toSet()\n\n    fun setPolicyHiddenApps(context: Context, packages: Set<String>) {\n        prefs(context).edit().putStringSet(KEY_POLICY_HIDDEN_APPS, packages).apply()\n    }\n')

# Track successfully-hidden packages during normal policy enforcement.
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt',
    '        for (pkg in toUnsuspend) {\n            if (!dpm.setApplicationHidden(admin, pkg, false)) failed += pkg\n        }\n\n        if (policy.kioskEnabled) enableKiosk(allowed) else disableKiosk()\n',
    '        for (pkg in toUnsuspend) {\n            if (!dpm.setApplicationHidden(admin, pkg, false)) failed += pkg\n        }\n\n        val successfullyHidden = (toSuspend - failed.toSet()).toSet()\n        val stillTracked = (Config.policyHiddenApps(context) + successfullyHidden) - toUnsuspend.toSet()\n        Config.setPolicyHiddenApps(context, stillTracked)\n\n        if (policy.kioskEnabled) enableKiosk(allowed) else disableKiosk()\n')

# Full-open recovers normal installed apps, packages visible only with MATCH_UNINSTALLED_PACKAGES,
# and every package this DPC previously recorded as hidden.
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt',
    '        val installed = context.packageManager.getInstalledApplications(0)\n            .map { it.packageName }\n            .filter { it != context.packageName }\n            .distinct()\n',
    '        val normallyVisible = context.packageManager.getInstalledApplications(0).map { it.packageName }\n        val hiddenVisible = try {\n            context.packageManager.getInstalledApplications(PackageManager.MATCH_UNINSTALLED_PACKAGES)\n                .map { it.packageName }\n        } catch (_: Exception) { emptyList() }\n        val installed = (normallyVisible + hiddenVisible + Config.policyHiddenApps(context))\n            .filter { it != context.packageName }\n            .distinct()\n')
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt',
    '        return EnforcementResult(\n            suspended = emptyList(),\n            unsuspended = recovered.distinct() - failed.toSet(),\n            failed = failed.distinct(),\n',
    '        val failedSet = failed.toSet()\n        Config.setPolicyHiddenApps(context, Config.policyHiddenApps(context).intersect(failedSet))\n        return EnforcementResult(\n            suspended = emptyList(),\n            unsuspended = recovered.distinct() - failedSet,\n            failed = failed.distinct(),\n')

print('full-open hardening applied')
