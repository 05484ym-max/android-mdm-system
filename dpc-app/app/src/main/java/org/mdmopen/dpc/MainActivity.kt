package org.mdmopen.dpc

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
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

class MainActivity : Activity() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var serverInput: EditText
    private lateinit var enrollInput: EditText
    private lateinit var pinInput: EditText
    private lateinit var statusView: TextView
    private lateinit var enrollStatusView: TextView
    private lateinit var pinStatusView: TextView
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
        serverInput = textField(Config.serverUrl(this), "http://192.168.1.10:3000")
        serverInput.inputType = InputType.TYPE_TEXT_VARIATION_URI
        root.addView(serverInput)

        root.addView(sectionLabel("רישום המכשיר"))
        enrollStatusView = TextView(this).apply {
            textSize = 12f
            setPadding(0, 0, 0, 12)
        }
        root.addView(enrollStatusView)
        enrollInput = textField("", "קוד רישום מהפאנל")
        root.addView(enrollInput)
        root.addView(goldButton("רישום מכשיר") { enrollDevice() })

        root.addView(goldButton("חנות אפליקציות") {
            startActivity(Intent(this@MainActivity, AppStoreActivity::class.java))
        })

        root.addView(goldButton("סנכרון עכשיו") { syncNow() })

        root.addView(sectionLabel("קוד מנהל ליציאה מקיוסק"))
        pinStatusView = TextView(this).apply {
            textSize = 12f
            setPadding(0, 0, 0, 12)
        }
        root.addView(pinStatusView)
        pinInput = textField("", "קוד חדש (4 ספרות ומעלה)")
        pinInput.inputType =
            InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        root.addView(pinInput)
        root.addView(goldButton("שמירת קוד") { saveAdminPin() })

        root.addView(quietButton("יציאה מקיוסק (מקומי)") { exitKioskLocally() })

        root.addView(sectionLabel("יומן"))
        logView = TextView(this).apply {
            textSize = 12f
            setTextColor(Color.parseColor(DIM))
        }
        root.addView(
            ScrollView(this).apply { addView(logView) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )

        return ScrollView(this).apply {
            setBackgroundColor(Color.parseColor(BG))
            addView(root)
        }
    }

    private fun textField(value: String, hintText: String) = EditText(this).apply {
        setText(value)
        hint = hintText
        setSingleLine()
        setTextColor(Color.parseColor(TEXT))
        setHintTextColor(Color.parseColor("#6B6862"))
        setBackgroundColor(Color.parseColor(CARD))
        setPadding(24, 24, 24, 24)
    }

    private fun goldButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        setBackgroundColor(Color.parseColor(GOLD))
        setTextColor(Color.parseColor(BG))
        setOnClickListener { onClick() }
    }

    private fun quietButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        setBackgroundColor(Color.parseColor(CARD))
        setTextColor(Color.parseColor(DIM))
        setOnClickListener { onClick() }
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

        val enrolled = Config.deviceToken(this) != null
        enrollStatusView.text = if (enrolled) "✓ המכשיר רשום בשרת" else "✕ המכשיר אינו רשום"
        enrollStatusView.setTextColor(Color.parseColor(if (enrolled) OK else BAD))

        // After enrollment, lock the server address so the device token
        // cannot accidentally be sent to a different server.
        serverInput.isEnabled = !enrolled
        if (enrolled) {
            serverInput.setText(Config.serverUrl(this))
        }

        val hasPin = Config.hasAdminPin(this)
        pinStatusView.text =
            if (hasPin) "✓ קוד מנהל מוגדר" else "✕ אין קוד — כל אחד יכול לצאת מהקיוסק"
        pinStatusView.setTextColor(Color.parseColor(if (hasPin) OK else BAD))
    }

    private fun enrollDevice() {
        val url = serverInput.text.toString().trim()
        val code = enrollInput.text.toString().trim()
        if (url.isEmpty() || code.isEmpty()) {
            log("נא להזין כתובת שרת וקוד רישום")
            return
        }
        Config.setServerUrl(this, url)
        log("--- רושם מכשיר ---")

        Thread {
            try {
                val token = ApiClient(Config.serverUrl(this@MainActivity))
                    .enroll(Config.deviceId(this@MainActivity), code)
                Config.setDeviceToken(this@MainActivity, token)
                mainHandler.post {
                    enrollInput.setText("")
                    refreshStatus()
                    log("המכשיר נרשם בהצלחה")
                }
            } catch (e: Exception) {
                postLog("רישום נכשל: ${e.message}")
            }
        }.start()
    }

    private fun saveAdminPin() {
        val pin = pinInput.text.toString()
        if (pin.length < 4) {
            log("הקוד חייב להיות באורך 4 ספרות לפחות")
            return
        }
        Config.setAdminPin(this, pin)
        pinInput.setText("")
        refreshStatus()
        log("קוד המנהל נשמר")
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
                postLog(PolicySync.run(this@MainActivity))
                SyncScheduler.schedule(this@MainActivity)
                postLog("סנכרון אוטומטי מתוזמן כל 15 דקות")
                postLog("--- הושלם ---")
            } catch (e: Exception) {
                postLog("שגיאה: ${e.javaClass.simpleName}: ${e.message}")
            }
        }.start()
    }

    private fun exitKioskLocally() {
        if (!Config.hasAdminPin(this)) {
            log("לא מוגדר קוד מנהל — יש להגדיר קוד לפני יציאה מקיוסק")
            return
        }

        val pinDialogInput = EditText(this).apply {
            hint = "קוד מנהל"
            inputType =
                InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            setSingleLine()
        }

        AlertDialog.Builder(this)
            .setTitle("אימות מנהל")
            .setMessage("הזן קוד מנהל כדי לצאת מהקיוסק")
            .setView(pinDialogInput)
            .setNegativeButton("ביטול", null)
            .setPositiveButton("אישור") { _, _ ->
                val pin = pinDialogInput.text.toString()
                if (Config.checkAdminPin(this, pin)) {
                    performLocalKioskExit()
                } else {
                    log("קוד מנהל שגוי — הקיוסק נשאר פעיל")
                }
            }
            .show()
    }

    private fun performLocalKioskExit() {
        try {
            PolicyEnforcer(this).disableKiosk()
            Config.setKioskEnabled(this, false)
            log("קיוסק כובה מקומית — יחזור בסנכרון הבא אם השרת מורה על כך")
        } catch (e: Exception) {
            log("שגיאה: ${e.message}")
        }
    }

    private fun postLog(message: String) = mainHandler.post { log(message) }

    private fun log(message: String) {
        logView.append("$message\n")
    }
}
