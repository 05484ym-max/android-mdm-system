package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings

/**
 * Intent factory for the user/technician-confirmed Android setup screens used
 * by the non-Device-Owner path. No step silently grants itself privileges.
 */
object NonDoSetupIntents {

    fun forStep(context: Context, step: NonDoSetupStep): Intent? = when (step) {
        NonDoSetupStep.SET_DEFAULT_HOME ->
            Intent(Settings.ACTION_HOME_SETTINGS)

        NonDoSetupStep.ENABLE_ACCESSIBILITY ->
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)

        NonDoSetupStep.ACTIVATE_DEVICE_ADMIN ->
            Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                .putExtra(
                    DevicePolicyManager.EXTRA_DEVICE_ADMIN,
                    ComponentName(context, DpcDeviceAdminReceiver::class.java),
                )
                .putExtra(
                    DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                    "הפעלת מנהל המכשיר מוסיפה שכבת הגנה במכשיר שאינו Device Owner.",
                )

        // OEM-specific autostart/battery screens are deliberately not guessed
        // here. Each adapter must provide a verified intent before we launch it;
        // a wrong proprietary component name is worse than clear manual guidance.
        NonDoSetupStep.OEM_BACKGROUND_SETUP -> null

        NonDoSetupStep.VERIFY_PROTECTION -> null
    }
}
