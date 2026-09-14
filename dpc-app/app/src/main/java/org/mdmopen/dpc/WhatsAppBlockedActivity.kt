package org.mdmopen.dpc

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class WhatsAppBlockedActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val kind = intent.getStringExtra(EXTRA_KIND)
        val (title, message) = when (kind) {
            KIND_CHANNEL -> "הערוץ חסום" to "הגישה לערוצים חסומה במכשיר זה."
            KIND_UPDATES -> "העדכונים חסומים" to "הגישה לעדכונים, סטטוסים וערוצים חסומה במכשיר זה."
            else -> "הסטטוס חסום" to "הגישה לסטטוסים חסומה במכשיר זה."
        }

        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(36), dp(28), dp(36))
            setBackgroundColor(Color.rgb(248, 250, 252))
        }

        val titleView = TextView(this).apply {
            text = title
            textSize = 28f
            setTextColor(Color.rgb(15, 23, 42))
            gravity = Gravity.CENTER
        }
        root.addView(titleView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ))

        val messageView = TextView(this).apply {
            text = message
            textSize = 17f
            setTextColor(Color.rgb(71, 85, 105))
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, dp(28))
        }
        root.addView(messageView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ))

        val button = Button(this).apply {
            text = "חזרה ל-WhatsApp"
            textSize = 16f
            setOnClickListener { returnToWhatsApp() }
        }
        root.addView(button, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(52),
        ))

        setContentView(root)
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
