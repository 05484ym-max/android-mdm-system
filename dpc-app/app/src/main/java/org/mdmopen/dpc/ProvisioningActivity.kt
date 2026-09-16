package org.mdmopen.dpc

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.PersistableBundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

/** The two screens Android 12+ provisioning drives while setting up a device owner. */
class ProvisioningActivity : Activity() {

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
     * Keep Android's compliance callback deliberately short and deterministic.
     *
     * Newer Android/Samsung setup flows can abort provisioning when a DPC keeps
     * ACTION_ADMIN_POLICY_COMPLIANCE open for network enrollment or policy sync.
     * We therefore persist the QR extras, enqueue durable background enrollment,
     * and return RESULT_OK immediately. The worker owns retries and policy sync.
     */
    private fun runComplianceStep() {
        setContentView(buildUi())
        status("מסיים את הגדרת המכשיר…")

        try {
            readAdminExtras()
            if (!Config.serverUrl(this).isBlank() &&
                !Config.pendingEnrollmentToken(this).isNullOrBlank()
            ) {
                PostProvisionEnrollmentScheduler.enqueue(applicationContext)
            }

            setResult(RESULT_OK)
        } catch (_: Exception) {
            // Provisioning must not be held hostage by background/server setup.
            // Any already-persisted enrollment token remains available for later
            // retry from the app or worker. Returning OK lets Device Owner setup
            // complete instead of dropping into the OEM "contact IT admin" screen.
            setResult(RESULT_OK)
        } finally {
            finish()
        }
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
