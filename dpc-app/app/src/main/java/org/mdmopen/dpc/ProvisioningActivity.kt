package org.mdmopen.dpc

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.PersistableBundle
import android.util.Log
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Provisioning callbacks used by Android 12+ while the same APK remains compatible
 * with Android 10/11 through DeviceAdminReceiver completion callbacks.
 */
class ProvisioningActivity : Activity() {

    private lateinit var statusView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.i(TAG, "Provisioning callback ${intent.action} on ${AndroidCompatibility.label()}")

        when (intent.action) {
            DevicePolicyManager.ACTION_GET_PROVISIONING_MODE -> replyWithProvisioningMode()
            DevicePolicyManager.ACTION_ADMIN_POLICY_COMPLIANCE -> runComplianceStep()
            else -> {
                setResult(RESULT_CANCELED)
                finish()
            }
        }
    }

    /** Android 12+ asks which provisioning mode this DPC supports. */
    private fun replyWithProvisioningMode() {
        val allowed = intent.getIntegerArrayListExtra(
            DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES
        )

        // The product is a fully managed Device Owner. Never silently select a
        // managed-profile mode merely because it appears first in an OEM list.
        val fullyManaged = DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
        if (!allowed.isNullOrEmpty() && !allowed.contains(fullyManaged)) {
            Log.e(TAG, "Fully managed mode was not offered by setup wizard: $allowed")
            setResult(RESULT_CANCELED)
            finish()
            return
        }

        setResult(
            RESULT_OK,
            Intent().apply {
                putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, fullyManaged)
                putExtra(DevicePolicyManager.EXTRA_PROVISIONING_SKIP_EDUCATION_SCREENS, true)
            },
        )
        finish()
    }

    /**
     * Keep Android's compliance callback deliberately short and deterministic.
     * Network enrollment and policy sync run only after setup hands control back.
     */
    private fun runComplianceStep() {
        setContentView(buildUi())
        status("מסיים את הגדרת המכשיר…")

        try {
            readAdminExtras()
            PostProvisionEnrollmentScheduler.enqueueIfPending(applicationContext)
            setResult(RESULT_OK)
        } catch (e: Exception) {
            Log.e(TAG, "Could not persist/schedule provisioning extras", e)
            // Do not keep Setup Wizard blocked by server/background work. Durable
            // completion callbacks and app startup can re-arm pending enrollment.
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

    private companion object {
        const val TAG = "ProvisioningActivity"
    }
}
