from pathlib import Path

path = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
text = path.read_text()
old = '''    private fun openWhatsAppAccessibilitySettings() {
        val attempts = listOf(
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).setPackage("com.android.settings"),
            Intent().setClassName(
                "com.android.settings",
                "com.samsung.android.settings.accessibility.AccessibilitySettingsActivity"
            ),
            Intent().setClassName(
                "com.android.settings",
                "com.android.settings.Settings\\$AccessibilitySettingsActivity"
            ),
            Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS").apply {
                data = Uri.parse("package:$packageName")
                setPackage("com.android.settings")
            },
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
new = '''    private fun openWhatsAppAccessibilitySettings() {
        // Use only public Android Settings actions here. Explicit Samsung/
        // Settings implementation Activity class names are not API contracts
        // and can crash the Settings app on older One UI builds (Galaxy A31).
        val attempts = listOf(
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )

        for (intent in attempts) {
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (intent.resolveActivity(packageManager) == null) continue
            try {
                Toast.makeText(
                    this,
                    "בחרו 'נגישות' ואז 'יהודי כשר — הגנת WhatsApp' והפעילו את השירות",
                    Toast.LENGTH_LONG
                ).show()
                startActivity(intent)
                return
            } catch (_: Exception) {
                // Try the next public Settings action.
            }
        }

        Toast.makeText(
            this,
            "לא ניתן לפתוח את הגדרות הנגישות במכשיר זה",
            Toast.LENGTH_LONG
        ).show()
    }
'''
if old not in text:
    raise SystemExit('target accessibility function not found')
path.write_text(text.replace(old, new))
