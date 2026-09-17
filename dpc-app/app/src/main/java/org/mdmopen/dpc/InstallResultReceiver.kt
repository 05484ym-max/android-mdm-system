package org.mdmopen.dpc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log
import android.widget.Toast

/** PackageInstaller reports install and uninstall outcomes here. */
class InstallResultReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)
        val packageName = intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        val commandId = intent.getStringExtra(AppInstaller.EXTRA_COMMAND_ID)
        val attemptId = intent.getStringExtra(AppInstaller.EXTRA_COMMAND_ATTEMPT_ID)

        if (intent.getBooleanExtra(AppInstaller.EXTRA_MANAGED_INSTALL_WINDOW, false)) {
            try {
                ManagedInstallWindow.close(context)
            } catch (e: Exception) {
                Log.e(PolicySync.TAG, "Failed to restore install restriction", e)
            }
        }

        if (commandId == null) {
            if (status == PackageInstaller.STATUS_SUCCESS) {
                packageName?.let { PlayCatalogUpdateState.acknowledgeInstalledVersion(context, it) }
                runCatching {
                    context.applicationContext.startActivity(
                        Intent(context.applicationContext, CustomerActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    )
                }.onFailure {
                    Log.w(PolicySync.TAG, "Could not return to customer store after managed install", it)
                }
            } else if (status != PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Toast.makeText(
                    context.applicationContext,
                    "ההתקנה נכשלה: ${message ?: "שגיאה לא ידועה"}",
                    Toast.LENGTH_LONG,
                ).show()
            }
            return
        }

        val current = CommandJournal.get(context, commandId)
        val expectedAttempt = attemptId?.let { "package:$it" }
        if (expectedAttempt == null || current?.metadata != expectedAttempt) {
            Log.w(PolicySync.TAG, "Ignoring stale package callback for command $commandId")
            return
        }
        if (current.terminal) return

        val terminal = when (status) {
            PackageInstaller.STATUS_SUCCESS -> {
                Log.i(PolicySync.TAG, "Package operation succeeded: $packageName")
                "SUCCESS" to "Package operation succeeded: ${packageName ?: "unknown"}"
            }
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                Log.w(PolicySync.TAG, "Package operation needs user action - not device owner?")
                "FAILED" to "Package operation unexpectedly requires user action"
            }
            else -> {
                Log.w(PolicySync.TAG, "Package operation failed ($status): $message")
                "FAILED" to (message ?: "Package operation failed with status $status")
            }
        }

        CommandJournal.markTerminal(context, commandId, terminal.first, terminal.second)

        val pending = goAsync()
        Thread({
            try {
                val token = Config.deviceToken(context) ?: return@Thread
                val serverUrl = Config.serverUrl(context)
                if (serverUrl.isBlank()) return@Thread
                ApiClient(serverUrl, token).reportCommandResult(
                    Config.deviceId(context), commandId, terminal.first, terminal.second,
                )
            } catch (e: Exception) {
                Log.w(PolicySync.TAG, "Could not report package command result; sync will retry", e)
            } finally {
                pending.finish()
            }
        }, "mdm-package-result").start()
    }
}
