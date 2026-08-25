package org.mdmopen.dpc

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Bundle

class ProvisioningActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        when (intent.action) {

            DevicePolicyManager.ACTION_GET_PROVISIONING_MODE -> {
                val allowedModes =
                    intent.getIntegerArrayListExtra(
                        DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES
                    )

                val mode =
                    if (
                        allowedModes?.contains(
                            DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
                        ) == true
                    ) {
                        DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
                    } else {
                        allowedModes?.firstOrNull()
                            ?: DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
                    }

                val result = Intent().apply {
                    putExtra(
                        DevicePolicyManager.EXTRA_PROVISIONING_MODE,
                        mode
                    )

                    putExtra(
                        DevicePolicyManager.EXTRA_PROVISIONING_SKIP_EDUCATION_SCREENS,
                        true
                    )
                }

                setResult(RESULT_OK, result)
                finish()
            }

            DevicePolicyManager.ACTION_ADMIN_POLICY_COMPLIANCE -> {
                setResult(RESULT_OK)
                finish()
            }

            else -> {
                setResult(RESULT_CANCELED)
                finish()
            }
        }
    }
}
