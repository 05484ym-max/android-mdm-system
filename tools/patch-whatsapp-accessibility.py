from pathlib import Path
import re

p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = p.read_text()
pattern = re.compile(r"    private fun openWhatsAppAccessibilitySettings\(\) \{.*?^    \}\n", re.S | re.M)
replacement = '''    private fun openWhatsAppAccessibilitySettings() {
        // Samsung devices are more reliable when entering the general
        // Accessibility screen first. The former details-only intent can be
        // accepted without actually presenting a usable screen on some One UI
        // versions, leaving WhatsApp fail-closed with no setup path.
        val general = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
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

        val details = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS").apply {
            data = Uri.parse("package:$packageName")
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        try {
            startActivity(details)
            return
        } catch (_: Exception) {
        }

        Toast.makeText(
            this,
            "לא ניתן לפתוח את הגדרות הנגישות במכשיר זה",
            Toast.LENGTH_LONG
        ).show()
    }
'''
s2, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'openWhatsAppAccessibilitySettings replacements={n}')
p.write_text(s2)
