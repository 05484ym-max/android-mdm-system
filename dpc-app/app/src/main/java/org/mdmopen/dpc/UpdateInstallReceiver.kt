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

        AutoUpdater.restoreInstallBlock(context)

        when (status) {
            PackageInstaller.STATUS_SUCCESS ->
                Log.i(TAG, "MDM updated successfully")

            PackageInstaller.STATUS_PENDING_USER_ACTION ->
                Log.w(
                    TAG,
                    "Unexpected user action required"
                )

            else ->
                Log.e(
                    TAG,
                    "MDM update failed: $status $message"
                )
        }
    }

    companion object {
        const val ACTION_UPDATE_RESULT =
            "org.mdmopen.dpc.UPDATE_RESULT"

        private const val TAG = "MdmAutoUpdater"
    }
}
