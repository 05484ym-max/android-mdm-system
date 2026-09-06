from pathlib import Path
import re
p=Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s=p.read_text()
pattern=re.compile(r"    private fun openWhatsAppAccessibilitySettings\(\) \{.*?^    \}\n", re.S|re.M)
replacement='''    private fun openWhatsAppAccessibilitySettings() {
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
s2,n=pattern.subn(replacement,s,count=1)
if n!=1: raise SystemExit(f'replacements={n}')
p.write_text(s2)
