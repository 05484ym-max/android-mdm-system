package org.mdmopen.dpc

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

private const val BG = "#0B0B0C"
private const val CARD = "#1A1A1C"
private const val GOLD = "#D4AF37"
private const val GOLD_SOFT = "#E8CF7A"
private const val TEXT = "#F2EDE1"
private const val DIM = "#A9A49A"
private const val OK = "#7ED957"
private const val BAD = "#E05C5C"

class MainActivity : Activity() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var serverInput: EditText
    private lateinit var statusView: TextView
    private lateinit var logView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        refreshStatus()
    }

    private fun buildUi(): ViewGroup {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(BG))
            setPadding(40, 72, 40, 40)
        }

        root.addView(TextView(this).apply {
            text = "MDM DPC"
            textSize = 24f
            setTextColor(Color.parseColor(GOLD_SOFT))
            gravity = Gravity.CENTER
        })

        statusView = TextView(this).apply {
            textSize = 14f
            setPadding(0, 28, 0, 0)
        }
        root.addView(statusView)

        root.addView(sectionLabel("כתובת השרת"))
        serverInput = EditText(this).apply {
            setText(Config.serverUrl(this@MainActivity))
            hint = "http://192.168.1.10:3000"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
            setTextColor(Color.parseColor(TEXT))
            setHintTextColor(Color.parseColor("#6B6862"))
            setBackgroundColor(Color.parseColor(CARD))
            setPadding(24, 24, 24, 24)
        }
        root.addView(serverInput)

        root.addView(Button(this).apply {
            text = "סנכרון עכשיו"
            setBackgroundColor(Color.parseColor(GOLD))
            setTextColor(Color.parseColor(BG))
            setOnClickListener { syncNow() }
        })

        root.addView(sectionLabel("יומן"))
        logView = TextView(this).apply {
            textSize = 12f
            setTextColor(Color.parseColor(DIM))
        }
        root.addView(
            ScrollView(this).apply { addView(logView) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )

        return root
    }

    private fun sectionLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTextColor(Color.parseColor(GOLD_SOFT))
        setPadding(0, 36, 0, 10)
    }

    private fun refreshStatus() {
        val owner = PolicyEnforcer(this).isDeviceOwner()
        statusView.text = if (owner) "✓ Device Owner פעיל" else "✕ לא Device Owner"
        statusView.setTextColor(Color.parseColor(if (owner) OK else BAD))
    }

    private fun syncNow() {
        val url = serverInput.text.toString().trim()
        if (url.isEmpty()) {
            log("נא להזין כתובת שרת")
            return
        }
        Config.setServerUrl(this, url)
        log("--- מסנכרן מול $url ---")

        Thread {
            try {
                val summary = PolicySync.run(this@MainActivity)
                postLog(summary)
                SyncScheduler.schedule(this@MainActivity)
                postLog("סנכרון אוטומטי מתוזמן כל 15 דקות")
                postLog("--- הושלם ---")
            } catch (e: Exception) {
                postLog("שגיאה: ${e.javaClass.simpleName}: ${e.message}")
            }
        }.start()
    }

    private fun postLog(message: String) = mainHandler.post { log(message) }

    private fun log(message: String) {
        logView.append("$message\n")
    }
}
