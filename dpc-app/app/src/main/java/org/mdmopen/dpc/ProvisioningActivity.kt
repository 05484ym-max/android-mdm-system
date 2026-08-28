package org.mdmopen.dpc

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

/** The two screens Android 12+ provisioning drives while setting up a device owner. */
class ProvisioningActivity : Activity() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var statusView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        when (intent.action) {
            DevicePolicyManager.ACTION_GET_PROVISIONING_MODE -> replyWithProvisioningMode()
            DevicePolicyManager.ACTION_ADMIN_POLICY_COMPLIANCE -> runComplianceStep()
            else -> {
                setResult(RESULT_CANCELED)
                finish()
            }
        }
    }

    /** Android asks which provisioning modes this DPC supports. */
    private fun replyWithProvisioningMode() {
        val allowed = intent.getIntegerArrayListExtra(
            DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES
        )
        val mode = when {
            allowed.isNullOrEmpty() ->
                DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
            allowed.contains(DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE) ->
                DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
            else -> allowed.first()
        }

        setResult(
            RESULT_OK,
            Intent().apply {
                putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, mode)
                putExtra(DevicePolicyManager.EXTRA_PROVISIONING_SKIP_EDUCATION_SCREENS, true)
            },
        )
        finish()
    }

    /**
     * The final provisioning screen. Enrols against the server when the QR carried
     * credentials, then hands control back so setup can finish.
     */
    private fun runComplianceStep() {
        setContentView(buildUi())
        readAdminExtras()

        val serverUrl = Config.serverUrl(this)
        val enrollmentToken = Config.pendingEnrollmentToken(this)

        if (serverUrl.isEmpty() || enrollmentToken == null) {
            status("המכשיר מוכן. הרישום יושלם מתוך האפליקציה.")
            mainHandler.postDelayed({ done() }, 1500)
            return
        }

        status("רושם את המכשיר בשרת…")
        Thread {
            try {
                val result = ApiClient(serverUrl).enroll(enrollmentToken)
                Config.setDeviceId(this, result.deviceId)
                Config.setDeviceToken(this, result.deviceToken)
                Config.clearPendingEnrollmentToken(this)
                PolicySync.run(this)
                post("המכשיר נרשם. מזהה מכשיר: ${result.deviceId}")
            } catch (e: Exception) {
                post("הרישום לא הושלם: ${e.message}. אפשר להשלים מהאפליקציה.")
            } finally {
                mainHandler.postDelayed({ done() }, 4000)
            }
        }.start()
    }

    /** Credentials the admin embedded in the QR code. */
    private fun readAdminExtras() {
        val extras = intent.getParcelableExtra<PersistableBundle>(
            DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE
        ) ?: return

        extras.getString("serverUrl")?.takeIf { it.isNotBlank() }
            ?.let { Config.setServerUrl(this, it) }
        extras.getString("enrollmentToken")?.takeIf { it.isNotBlank() }
            ?.let { Config.setPendingEnrollmentToken(this, it) }
    }

    private fun done() {
        setResult(RESULT_OK)
        finish()
    }

    private fun post(message: String) = mainHandler.post { status(message) }

    private fun status(message: String) {
        statusView.text = message
    }

    private fun buildUi(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.parseColor(BG))
        setPadding(64, 64, 64, 64)

        addView(TextView(this@ProvisioningActivity).apply {
            text = "מכשיר מנוהל"
            textSize = 24f
            setTextColor(Color.parseColor(GOLD_SOFT))
            gravity = Gravity.CENTER
        })

        statusView = TextView(this@ProvisioningActivity).apply {
            textSize = 15f
            setTextColor(Color.parseColor(DIM))
            gravity = Gravity.CENTER
            setPadding(0, 32, 0, 0)
        }
        addView(statusView)
    }
}
