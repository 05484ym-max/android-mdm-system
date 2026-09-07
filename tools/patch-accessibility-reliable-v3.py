from pathlib import Path

p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = p.read_text(encoding='utf-8')
old = '''    private fun openWhatsAppAccessibilitySettings() {
        // Samsung/One UI is more reliable when opening the general Accessibility
        // screen first. A details-only intent can be accepted without showing a
        // usable screen on some devices.
        val general = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(general)
            Toast.makeText(
                this,
                "בחרו 'יהודי כשר — הגנת WhatsApp' והפעילו את השירות",
                Toast.LENGTH_LONG
            ).show()
            return
        } catch (_: Exception) {
        }

        // Fallback for devices that do support the per-service details screen.
        val details = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS").apply {
            data = Uri.parse("package:$packageName")
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(details)
            return
        } catch (_: Exception) {
        }

        // Last-resort Samsung settings component. resolveActivity is checked first
        // so we never crash on non-Samsung devices.
        val samsung = Intent().apply {
            setClassName("com.android.settings", "com.samsung.android.settings.accessibility.AccessibilitySettingsActivity")
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            if (samsung.resolveActivity(packageManager) != null) {
                startActivity(samsung)
                return
            }
        } catch (_: Exception) {
        }

        Toast.makeText(this, "לא ניתן לפתוח את הגדרות הנגישות במכשיר זה", Toast.LENGTH_LONG).show()
    }
'''
new = '''    private fun openWhatsAppAccessibilitySettings() {
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
                "com.android.settings.Settings\\$AccessibilitySettingsActivity"
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
if old not in s:
    raise SystemExit('target accessibility method not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
