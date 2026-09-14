package org.mdmopen.dpc

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class WhatsAppBlockedActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        render()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) setIntent(intent)
        render()
    }

    private fun render() {
        val kind = intent.getStringExtra(EXTRA_KIND)
        val copy = when (kind) {
            KIND_CHANNEL -> UnifiedBlockedScreenStyle.Copy(
                eyebrow = "תוכן חסום",
                title = "הערוץ חסום",
                message = "הגישה לערוצים אינה זמינה במכשיר זה בהתאם להגדרות ההגנה.",
                button = "חזרה ל-WhatsApp",
            )
            KIND_UPDATES -> UnifiedBlockedScreenStyle.Copy(
                eyebrow = "הגנת WhatsApp",
                title = "העדכונים חסומים",
                message = "הגישה לעדכונים, סטטוסים וערוצים חסומה במכשיר זה.",
                button = "חזרה ל-WhatsApp",
            )
            else -> UnifiedBlockedScreenStyle.Copy(
                eyebrow = "תוכן חסום",
                title = "הסטטוס חסום",
                message = "הגישה לסטטוסים אינה זמינה במכשיר זה בהתאם להגדרות ההגנה.",
                button = "חזרה ל-WhatsApp",
            )
        }

        setContentView(
            UnifiedBlockedScreenStyle.create(this, copy) {
                returnToWhatsApp()
            },
        )
    }

    private fun returnToWhatsApp() {
        val launch = packageManager.getLaunchIntentForPackage(WHATSAPP_PACKAGE)
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            startActivity(launch)
        }
        finish()
    }

    companion object {
        const val EXTRA_KIND = "blocked_kind"
        const val KIND_STATUS = "status"
        const val KIND_CHANNEL = "channel"
        const val KIND_UPDATES = "updates"
        private const val WHATSAPP_PACKAGE = "com.whatsapp"
    }
}
