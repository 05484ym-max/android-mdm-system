from pathlib import Path

path = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
text = path.read_text(encoding='utf-8')
old = '''    private fun openWhatsAppAccessibilitySettings() {
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
new = '''    private fun openWhatsAppAccessibilitySettings() {
        // Galaxy A31 / older One UI can crash Settings even when launched with
        // ACTION_ACCESSIBILITY_SETTINGS. Use only the top-level public Settings
        // screen and guide the customer manually from there.
        val intent = Intent(Settings.ACTION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

        if (intent.resolveActivity(packageManager) == null) {
            Toast.makeText(
                this,
                "פתחו ידנית: הגדרות > נגישות > שירותים מותקנים > יהודי כשר — הגנת WhatsApp",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        Toast.makeText(
            this,
            "בהגדרות היכנסו: נגישות > שירותים מותקנים > יהודי כשר — הגנת WhatsApp",
            Toast.LENGTH_LONG
        ).show()

        try {
            startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(
                this,
                "פתחו ידנית: הגדרות > נגישות > שירותים מותקנים > יהודי כשר — הגנת WhatsApp",
                Toast.LENGTH_LONG
            ).show()
        }
    }
'''
if old not in text:
    raise SystemExit('target function not found')
path.write_text(text.replace(old, new), encoding='utf-8')
