package org.yehudikasher.whatsappguard

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private val bg = Color.parseColor("#F2F1E6")
    private val card = Color.WHITE
    private val text = Color.parseColor("#1C1C1C")
    private val muted = Color.parseColor("#7C7C76")
    private val accent = Color.parseColor("#4B6B45")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
    }

    override fun onResume() {
        super.onResume()
        // Rebuild so the accessibility status and current policy are always fresh.
        setContentView(buildUi())
    }

    private fun buildUi(): ScrollView {
        val policy = GuardPolicy.load(this)
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(28))
            setBackgroundColor(bg)
        }

        body.addView(TextView(this).apply {
            text = "יהודי כשר Guard"
            textSize = 24f
            setTextColor(text)
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(6))
        })
        body.addView(TextView(this).apply {
            text = "הגנת WhatsApp עצמאית — ללא MDM וללא איפוס מכשיר"
            textSize = 14f
            setTextColor(muted)
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(20))
        })

        val enabled = isAccessibilityEnabled()
        body.addView(TextView(this).apply {
            text = if (enabled) "✓ שירות ההגנה פעיל" else "שירות ההגנה עדיין לא הופעל"
            textSize = 15f
            setTextColor(if (enabled) accent else Color.parseColor("#A64032"))
            gravity = Gravity.RIGHT
            setPadding(dp(14), dp(14), dp(14), dp(14))
            setBackgroundColor(card)
        }, marginParams(dp(10)))

        body.addView(policySwitch(
            "חסום סטטוסים",
            "מונע גישה לאזורי Status בלי להשפיע על הצ'אטים.",
            policy.blockStatuses,
        ) { save(policy.copy(blockStatuses = it)) })

        body.addView(policySwitch(
            "חסום ערוצים",
            "מונע גישה לערוצי WhatsApp בנפרד מהסטטוסים.",
            policy.blockChannels,
        ) { save(policy.copy(blockChannels = it)) })

        body.addView(policySwitch(
            "הסתר תמונות פרופיל",
            "רשימת צ'אטים: פס צר באזור האווטארים. בתוך צ'אט: מסכה קטנה רק בכותרת.",
            policy.hideProfilePhotos,
        ) { save(policy.copy(hideProfilePhotos = it)) })

        body.addView(Button(this).apply {
            text = if (enabled) "פתח הגדרות נגישות" else "הפעל את שירות ההגנה"
            isAllCaps = false
            textSize = 15f
            setTextColor(Color.WHITE)
            setBackgroundColor(accent)
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)).apply {
            topMargin = dp(8)
        })

        body.addView(TextView(this).apply {
            text = "הערה: זו אפליקציה עצמאית. היא אינה Device Owner ואינה משנה את WhatsApp עצמו. אם מכבים את שירות הנגישות — ההגנה נעצרת."
            textSize = 12f
            setTextColor(muted)
            gravity = Gravity.RIGHT
            setPadding(0, dp(18), 0, 0)
        })

        return ScrollView(this).apply { addView(body) }
    }

    private fun policySwitch(
        title: String,
        subtitle: String,
        checked: Boolean,
        onChange: (Boolean) -> Unit,
    ): LinearLayout {
        val sw = Switch(this).apply {
            isChecked = checked
            setOnCheckedChangeListener { _, value -> onChange(value) }
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
            setBackgroundColor(card)
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT
                addView(TextView(this@MainActivity).apply {
                    text = title
                    textSize = 16f
                    setTextColor(this@MainActivity.text)
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@MainActivity).apply {
                    text = subtitle
                    textSize = 12f
                    setTextColor(muted)
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(4), 0, 0)
                })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(sw)
            layoutParams = marginParams(dp(10))
        }
    }

    private fun save(policy: GuardPolicy) {
        GuardPolicy.save(this, policy)
    }

    private fun isAccessibilityEnabled(): Boolean {
        val expected = "$packageName/${WhatsAppGuardService::class.java.canonicalName}"
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?: return false
        return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    private fun marginParams(bottom: Int) = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { bottomMargin = bottom }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
