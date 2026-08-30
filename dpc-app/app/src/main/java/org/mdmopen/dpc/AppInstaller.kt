package org.mdmopen.dpc

import android.app.PendingIntent
import android.content.Context
import android.os.UserManager
import android.content.ComponentName
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.content.IntentSender
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Installs and removes apps through PackageInstaller. A Device Owner may do this
 * silently, which is what makes remote app management possible - and exactly why
 * the APK is downloaded to a file and its SHA-256 verified against what the admin
 * queued *before* it ever reaches PackageInstaller: silent install means no user
 * consent screen catches a swapped or corrupted APK the way a normal install would.
 */
class AppInstaller(private val context: Context) {

    fun installFromUrl(apkUrl: String, expectedSha256: String, commandId: String? = null): String {
        val url = URL(apkUrl)
        require(url.protocol == "https") {
            "רק כתובות HTTPS מותרות להתקנת אפליקציה"
        }

        val tempFile = File(context.cacheDir, "install-${commandId ?: System.currentTimeMillis()}.apk")
        try {
            downloadToFile(url, tempFile)

            val actualSha256 = sha256OfFile(tempFile)
            if (!actualSha256.equals(expectedSha256, ignoreCase = true)) {
                throw IllegalStateException("אימות checksum של ה-APK נכשל")
            }

            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            )
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                tempFile.inputStream().use { input ->
                    session.openWrite("dpc-install", 0, tempFile.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                temporarilyAllowInstall()
                session.commit(statusSender(sessionId, commandId))
            }
            return "התקנה הופעלה מ-$apkUrl"
        } finally {
            tempFile.delete()
        }
    }

    fun uninstall(packageName: String): String {
        context.packageManager.packageInstaller
            .uninstall(packageName, statusSender(packageName.hashCode()))
        return "הסרה הופעלה עבור $packageName"
    }


    private fun temporarilyAllowInstall() {
        val dpm =
            context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

        if (!dpm.isDeviceOwnerApp(context.packageName)) return

        val admin =
            ComponentName(context, DpcDeviceAdminReceiver::class.java)

        dpm.clearUserRestriction(
            admin,
            UserManager.DISALLOW_INSTALL_APPS
        )

        context.getSharedPreferences(
            "dpc_installer",
            Context.MODE_PRIVATE
        ).edit()
            .putBoolean("install_temporarily_allowed", true)
            .apply()
    }

    /** Restores the install block after any install/uninstall result.
     * DISALLOW_UNINSTALL_APPS is never applied in the first place (the
     * customer can freely uninstall apps), so there's nothing to restore
     * on that side. */
    fun restoreInstallBlock() {
        val dpm =
            context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

        if (!dpm.isDeviceOwnerApp(context.packageName)) return

        val admin =
            ComponentName(context, DpcDeviceAdminReceiver::class.java)

        dpm.addUserRestriction(
            admin,
            UserManager.DISALLOW_INSTALL_APPS
        )

        context.getSharedPreferences(
            "dpc_installer",
            Context.MODE_PRIVATE
        ).edit()
            .putBoolean("install_temporarily_allowed", false)
            .apply()
    }

    private fun downloadToFile(url: URL, target: File) {
        val connection = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
            instanceFollowRedirects = true
        }
        try {
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("הורדת ה-APK נכשלה: HTTP ${connection.responseCode}")
            }
            connection.inputStream.use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun sha256OfFile(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun statusSender(requestCode: Int, commandId: String? = null): IntentSender {
        val intent = Intent(context, InstallResultReceiver::class.java).apply {
            commandId?.let { putExtra("commandId", it) }
        }
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        return PendingIntent.getBroadcast(context, requestCode, intent, flags).intentSender
    }
}
