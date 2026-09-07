from pathlib import Path

# Fix the ACTUAL customer store screen. CustomerActivity still used the old
# MATCH_UNINSTALLED_PACKAGES + hidden fallback even after AppStoreActivity was fixed.
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = p.read_text(encoding='utf-8')
old = '''    private fun isInstalled(packageName: String): Boolean {\n        val installedByPackageManager = try {\n            val info = packageManager.getApplicationInfo(\n                packageName,\n                PackageManager.MATCH_UNINSTALLED_PACKAGES\n            )\n            (info.flags and ApplicationInfo.FLAG_INSTALLED) != 0\n        } catch (_: Exception) {\n            false\n        }\n        if (installedByPackageManager) return true\n\n        return try {\n            val dpm = getSystemService(DevicePolicyManager::class.java)\n            val admin = ComponentName(this, DpcDeviceAdminReceiver::class.java)\n            dpm.isDeviceOwnerApp(this.packageName) &&\n                dpm.isApplicationHidden(admin, packageName)\n        } catch (_: Exception) {\n            false\n        }\n    }\n'''
new = '''    private fun isInstalled(packageName: String): Boolean {\n        // Customer-visible truth only. Do not use MATCH_UNINSTALLED_PACKAGES and\n        // do not treat a Device Owner-hidden package as installed: Samsung keeps\n        // retained package rows for removed/disabled apps, which caused false\n        // \"✓ מותקן\" states in this actual customer store screen.\n        return try {\n            val info = packageManager.getApplicationInfo(packageName, 0)\n            if ((info.flags and ApplicationInfo.FLAG_INSTALLED) == 0) return false\n            if (!info.enabled) return false\n\n            val enabledSetting = try {\n                packageManager.getApplicationEnabledSetting(packageName)\n            } catch (_: Exception) {\n                PackageManager.COMPONENT_ENABLED_STATE_DEFAULT\n            }\n            if (enabledSetting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED ||\n                enabledSetting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER ||\n                enabledSetting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED) {\n                return false\n            }\n\n            val dpm = getSystemService(DevicePolicyManager::class.java)\n            if (dpm.isDeviceOwnerApp(this.packageName)) {\n                val admin = ComponentName(this, DpcDeviceAdminReceiver::class.java)\n                if (dpm.isApplicationHidden(admin, packageName)) return false\n            }\n\n            val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return false\n            launchIntent.resolveActivity(packageManager) != null\n        } catch (_: PackageManager.NameNotFoundException) {\n            false\n        } catch (_: Exception) {\n            false\n        }\n    }\n'''
if old not in s:
    raise SystemExit('CustomerActivity isInstalled target not found')
s = s.replace(old, new, 1)

# Accessibility setup: keep Device Owner and anti-removal protections in force.
# Samsung gets a tiny unrestricted accessibility-policy window only to construct
# its Settings page; we re-allowlist this DPC after 1500 ms and again on resume.
old_open = '''            enforcer.allowManagedAccessibilityService()\n            // Samsung A31 blocks/crashes the accessibility UI while our kiosk\n            // lock task is active. Open a very narrow temporary setup window:\n            // Device Owner and all user restrictions stay active; only kiosk/home\n            // pinning is suspended until this Activity resumes.\n            try { stopLockTask() } catch (_: Exception) {}\n            enforcer.disableKiosk()\n            accessibilitySetupWindowOpen = true\n'''
new_open = '''            enforcer.beginAccessibilitySetupWindow()\n            // Samsung A31 needs LockTask/home pinning released before Settings\n            // can enter Accessibility. Device Owner and anti-removal protections\n            // remain active throughout this temporary setup window.\n            try { stopLockTask() } catch (_: Exception) {}\n            enforcer.disableKiosk()\n            accessibilitySetupWindowOpen = true\n'''
if old_open not in s:
    raise SystemExit('CustomerActivity accessibility setup target not found')
s = s.replace(old_open, new_open, 1)

old_resume = '''            try {\n                PolicyEnforcer(this).restoreCachedKioskPolicy()\n            } catch (_: Exception) {\n                SyncScheduler.enqueueImmediate(applicationContext)\n            }\n'''
new_resume = '''            try {\n                PolicyEnforcer(this).finishAccessibilitySetupWindow()\n            } catch (_: Exception) {\n                SyncScheduler.enqueueImmediate(applicationContext)\n            }\n'''
if old_resume not in s:
    raise SystemExit('CustomerActivity onResume restore target not found')
s = s.replace(old_resume, new_resume, 1)

# After Settings has had a moment to build its accessibility page, re-apply the
# strict accessibility allowlist even while the page remains open.
needle = '''                startActivity(intent)\n                return\n'''
replacement = '''                startActivity(intent)\n                contentArea.postDelayed({\n                    try { PolicyEnforcer(this).allowManagedAccessibilityService() } catch (_: Exception) {}\n                }, 1500L)\n                return\n'''
if needle not in s:
    raise SystemExit('CustomerActivity startActivity target not found')
s = s.replace(needle, replacement, 1)

# If no Settings route opens, fully close the temporary policy window.
s = s.replace(
    'try { PolicyEnforcer(this).restoreCachedKioskPolicy() } catch (_: Exception) {}',
    'try { PolicyEnforcer(this).finishAccessibilitySetupWindow() } catch (_: Exception) {}',
    1,
)
p.write_text(s, encoding='utf-8')

p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt')
s = p.read_text(encoding='utf-8')
anchor = '''    fun allowManagedAccessibilityService() {\n        check(isDeviceOwner()) { \"Not device owner\" }\n        try {\n            dpm.setPermittedAccessibilityServices(admin, listOf(context.packageName))\n        } catch (_: Exception) {\n            // Keep policy sync alive on OEMs that reject this API unexpectedly.\n        }\n    }\n\n'''
insert = anchor + '''    fun beginAccessibilitySetupWindow() {\n        check(isDeviceOwner()) { \"Not device owner\" }\n        // Belt-and-suspenders protection: Device Owner is already not removable\n        // through normal Settings, and this explicit block stays in force while\n        // kiosk is temporarily released.\n        try { dpm.setUninstallBlocked(admin, context.packageName, true) } catch (_: Exception) {}\n        try { dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET) } catch (_: Exception) {}\n        try { dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES) } catch (_: Exception) {}\n        try { dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT) } catch (_: Exception) {}\n\n        // Some Samsung/One UI builds refuse to construct the Accessibility page\n        // while a non-null permitted-services policy is active. Lift ONLY this\n        // one policy momentarily; CustomerActivity re-applies our package-only\n        // allowlist after 1.5s and finishAccessibilitySetupWindow() does it again.\n        try { dpm.setPermittedAccessibilityServices(admin, null) } catch (_: Exception) {}\n    }\n\n    fun finishAccessibilitySetupWindow() {\n        check(isDeviceOwner()) { \"Not device owner\" }\n        allowManagedAccessibilityService()\n        try { dpm.setUninstallBlocked(admin, context.packageName, true) } catch (_: Exception) {}\n        restoreCachedKioskPolicy()\n    }\n\n'''
if anchor not in s:
    raise SystemExit('PolicyEnforcer accessibility anchor not found')
s = s.replace(anchor, insert, 1)
p.write_text(s, encoding='utf-8')
