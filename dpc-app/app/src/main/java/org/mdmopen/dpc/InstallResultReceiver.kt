package org.mdmopen.dpc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log

/** PackageInstaller reports install and uninstall outcomes here. */
class InstallResultReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)
        val packageName = intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)

        // Restore app-install blocking after every install/uninstall result.
        try {
            AppInstaller(context).restoreInstallBlock()
        } catch (e: Exception) {
            Log.e(PolicySync.TAG, "Failed to restore install restriction", e)
        }

        when (status) {
            PackageInstaller.STATUS_SUCCESS ->
                Log.i(PolicySync.TAG, "Package operation succeeded: $packageName")
            PackageInstaller.STATUS_PENDING_USER_ACTION ->
                Log.w(PolicySync.TAG, "Package operation needs user action - not device owner?")
            else ->
                Log.w(PolicySync.TAG, "Package operation failed ($status): $message")
        }
    }
}
