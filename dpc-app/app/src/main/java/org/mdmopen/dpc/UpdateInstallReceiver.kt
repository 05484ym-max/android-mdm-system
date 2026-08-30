package org.mdmopen.dpc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log

class UpdateInstallReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {

        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            AutoUpdater.restoreInstallBlock(context)
            AutoUpdater.check(context)
            return
        }

        if (intent.action != ACTION_UPDATE_RESULT) return

        val status =
            intent.getIntExtra(
                PackageInstaller.EXTRA_STATUS,
                PackageInstaller.STATUS_FAILURE
            )

        val message =
            intent.getStringExtra(
                PackageInstaller.EXTRA_STATUS_MESSAGE
            )

        val versionCode = intent.getLongExtra(EXTRA_VERSION_CODE, -1L).takeIf { it >= 0 }

        AutoUpdater.restoreInstallBlock(context)

        when (status) {
            PackageInstaller.STATUS_SUCCESS -> {
                Log.i(TAG, "MDM updated successfully")
                DeviceHealth.recordUpdateResult(context, "SUCCESS", versionCode, null)
            }

            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                Log.w(
                    TAG,
                    "Unexpected user action required"
                )
                DeviceHealth.recordUpdateResult(
                    context,
                    "FAILED",
                    versionCode,
                    "Update unexpectedly requires user action"
                )
            }

            else -> {
                Log.e(
                    TAG,
                    "MDM update failed: $status $message"
                )
                DeviceHealth.recordUpdateResult(context, "FAILED", versionCode, message)
            }
        }
    }

    companion object {
        const val ACTION_UPDATE_RESULT =
            "org.mdmopen.dpc.UPDATE_RESULT"
        const val EXTRA_VERSION_CODE =
            "org.mdmopen.dpc.EXTRA_VERSION_CODE"

        private const val TAG = "MdmAutoUpdater"
    }
}
