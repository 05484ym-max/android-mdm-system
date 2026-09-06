from pathlib import Path

p = Path('app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = p.read_text()

needle = 'import android.os.Bundle\n'
replacement = 'import android.os.Bundle\nimport android.provider.Settings\n'
if replacement not in s:
    if needle not in s:
        raise SystemExit('Bundle import anchor missing')
    s = s.replace(needle, replacement, 1)

old = '''    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        newsItems = Config.newsCache(this)
        setContentView(buildUi())
        showAppStore()
        updateNewsBadge()
        refreshNews()
    }
'''
new = '''    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        newsItems = Config.newsCache(this)
        setContentView(buildUi())
        showAppStore()
        updateNewsBadge()
        refreshNews()
    }

    override fun onResume() {
        super.onResume()
        if (::contentArea.isInitialized && isPersonalAreaActive) {
            showPersonalArea()
        }
    }
'''
if 'override fun onResume()' not in s:
    if old not in s:
        raise SystemExit('onCreate anchor missing')
    s = s.replace(old, new, 1)

old = '''        contentArea.addView(sectionTitle("סינון DNS"))
        contentArea.addView(dnsToggleCard())
'''
new = '''        val guardPolicy = WhatsAppGuardConfig.load(this)
        if (guardPolicy.enabled) {
            contentArea.addView(sectionTitle("הגנת WhatsApp"))
            contentArea.addView(whatsAppGuardSetupCard())
        }

        contentArea.addView(sectionTitle("סינון DNS"))
        contentArea.addView(dnsToggleCard())
'''
if 'contentArea.addView(whatsAppGuardSetupCard())' not in s:
    if old not in s:
        raise SystemExit('personal area anchor missing')
    s = s.replace(old, new, 1)

anchor = '    private fun compactPersonalIdentityCard(): LinearLayout = LinearLayout(this).apply {\n'
block = '''    private fun whatsAppGuardSetupCard(): LinearLayout {
        val enabled = WhatsAppGuardProtection.accessibilityEnabled(this)
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedCardWithBorder()
            setPadding(dp(16), dp(14), dp(16), dp(14))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }

            addView(TextView(this@CustomerActivity).apply {
                text = if (enabled) "✓ הגנת WhatsApp פעילה" else "הגנת WhatsApp ממתינה להפעלה"
                textSize = 15f
                typeface = heavyFont
                setTextColor(Color.parseColor(if (enabled) OK else TEXT))
                gravity = Gravity.RIGHT
            })

            addView(TextView(this@CustomerActivity).apply {
                text = if (enabled) {
                    "שירות הנגישות פעיל והסינון יכול להגן על WhatsApp לפי מדיניות המנהל."
                } else {
                    "נדרשת הפעלה חד-פעמית של שירות ‘יהודי כשר — הגנת WhatsApp’."
                }
                textSize = 12f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                setPadding(0, dp(5), 0, if (enabled) 0 else dp(10))
            })

            if (!enabled) {
                addView(primaryButton("הפעל הגנת WhatsApp") {
                    openWhatsAppAccessibilitySettings()
                })
            }
        }
    }

    private fun openWhatsAppAccessibilitySettings() {
        val details = Intent(Settings.ACTION_ACCESSIBILITY_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:$packageName")
        }
        try {
            startActivity(details)
            return
        } catch (_: Exception) {
        }

        try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        } catch (e: Exception) {
            Toast.makeText(
                this,
                "לא ניתן לפתוח את הגדרות הנגישות במכשיר זה: ${e.message ?: "שגיאה לא ידועה"}",
                Toast.LENGTH_LONG
            ).show()
        }
    }

'''
if 'private fun whatsAppGuardSetupCard()' not in s:
    if anchor not in s:
        raise SystemExit('identity card anchor missing')
    s = s.replace(anchor, block + anchor, 1)

p.write_text(s)
