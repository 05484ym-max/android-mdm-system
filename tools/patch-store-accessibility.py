from pathlib import Path

root = Path('dpc-app/app/src/main/java/org/mdmopen/dpc')

# 1) App Store installed-state: only PackageManager + FLAG_INSTALLED is authoritative.
p = root / 'AppStoreActivity.kt'
s = p.read_text()
old = '''    private fun isInstalled(packageName: String): Boolean {
        // Hidden packages can disappear from ordinary PackageManager lookups
        // on some OEM builds even though they are still physically installed.
        // MATCH_UNINSTALLED_PACKAGES lets us inspect their ApplicationInfo and
        // FLAG_INSTALLED distinguishes a real installed package from retained
        // metadata for an uninstalled package.
        val installedByPackageManager = try {
            val info = packageManager.getApplicationInfo(
                packageName,
                PackageManager.MATCH_UNINSTALLED_PACKAGES
            )
            (info.flags and ApplicationInfo.FLAG_INSTALLED) != 0
        } catch (_: Exception) {
            false
        }
        if (installedByPackageManager) return true

        // DevicePolicyManager is authoritative for apps hidden by this DPC.
        // If Android says this package is hidden by our Device Owner policy,
        // it necessarily exists on the device even if PackageManager omitted
        // it from the normal visible-package view.
        return try {
            val dpm = getSystemService(DevicePolicyManager::class.java)
            val admin = ComponentName(this, DpcDeviceAdminReceiver::class.java)
            dpm.isDeviceOwnerApp(this.packageName) &&
                dpm.isApplicationHidden(admin, packageName)
        } catch (_: Exception) {
            false
        }
    }
'''
new = '''    private fun isInstalled(packageName: String): Boolean {
        // MATCH_UNINSTALLED_PACKAGES can return retained metadata after an app
        // was removed, so FLAG_INSTALLED is the only signal used here. Policy
        // hidden-state must never be treated as proof that an app is installed.
        return try {
            val info = packageManager.getApplicationInfo(
                packageName,
                PackageManager.MATCH_UNINSTALLED_PACKAGES
            )
            (info.flags and ApplicationInfo.FLAG_INSTALLED) != 0
        } catch (_: PackageManager.NameNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }
'''
if old not in s:
    raise SystemExit('AppStore isInstalled block not found')
s = s.replace(old, new, 1)
p.write_text(s)

# 2) Accessibility launcher: do not assume startActivity means Samsung actually navigated.
p = root / 'CustomerActivity.kt'
s = p.read_text()
start = s.index('    private fun openWhatsAppAccessibilitySettings() {')
end = s.index('\n    private fun compactPersonalIdentityCard()', start)
new_method = '''    private fun openWhatsAppAccessibilitySettings() {
        val attempts = listOf(
            // Prefer an intent explicitly owned by Settings so the kiosk/home
            // resolver cannot swallow it on OEM builds.
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).setPackage("com.android.settings"),
            // Samsung One UI variants seen across generations.
            Intent().setClassName(
                "com.android.settings",
                "com.samsung.android.settings.accessibility.AccessibilitySettingsActivity"
            ),
            Intent().setClassName(
                "com.android.settings",
                "com.android.settings.Settings$AccessibilitySettingsActivity"
            ),
            // Per-service details where supported.
            Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS").apply {
                data = Uri.parse("package:$packageName")
                setPackage("com.android.settings")
            },
            // Generic Android fallback last.
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS),
        )

        fun launchAttempt(index: Int) {
            if (index >= attempts.size) {
                Toast.makeText(
                    this,
                    "לא ניתן לפתוח את הגדרות הנגישות במכשיר זה",
                    Toast.LENGTH_LONG
                ).show()
                return
            }

            val intent = attempts[index].apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            try {
                startActivity(intent)
            } catch (_: Exception) {
                launchAttempt(index + 1)
                return
            }

            // Some Samsung builds accept startActivity() while keeping the
            // caller in the foreground. If that happens, continue to the next
            // explicit Settings route instead of incorrectly treating it as success.
            window.decorView.postDelayed({
                if (hasWindowFocus()) {
                    launchAttempt(index + 1)
                }
            }, 900L)
        }

        Toast.makeText(
            this,
            "בחרו 'יהודי כשר — הגנת WhatsApp' והפעילו את השירות",
            Toast.LENGTH_LONG
        ).show()
        launchAttempt(0)
    }
'''
s = s[:start] + new_method + s[end:]
p.write_text(s)
