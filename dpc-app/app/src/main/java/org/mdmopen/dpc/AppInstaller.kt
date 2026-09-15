package org.mdmopen.dpc

import android.app.PendingIntent
import android.content.Context
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
 * silently, so every remote APK is downloaded first and its SHA-256 is verified
 * before PackageInstaller receives it.
 */
class AppInstaller(private val context: Context) {

    fun installFromUrl(apkUrl: String, expectedSha256: String, commandId: String? = null): String {
        val url = URL(apkUrl)
        require(url.protocol == "https") {
            "רק כתובות HTTPS מותרות להתקנת אפליקציה"
        }

        val tempFile = File(context.cacheDir, "install-${commandId ?: System.currentTimeMillis()}.apk")
        var sessionId = -1
        var windowOpened = false

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

            // DISALLOW_INSTALL_APPS is checked by createSession(), not only by
            // commit(), so the managed window must be opened first.
            ManagedInstallWindow.open(context)
            windowOpened = true

            sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                tempFile.inputStream().use { input ->
                    session.openWrite("dpc-install", 0, tempFile.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                session.commit(statusSender(sessionId, commandId, managedInstallWindow = true))
            }

            // The callback closes the window. A persisted timeout worker and boot
            // recovery cover lost callbacks/process death.
            windowOpened = false
            return "התקנה הופעלה מ-$apkUrl"
        } catch (e: Exception) {
            if (sessionId >= 0) {
                try {
                    context.packageManager.packageInstaller.abandonSession(sessionId)
                } catch (_: Exception) {
                }
            }
            if (windowOpened) {
                try { ManagedInstallWindow.close(context) } catch (_: Exception) {}
            }
            throw e
        } finally {
            tempFile.delete()
        }
    }

    fun uninstall(packageName: String, commandId: String? = null): String {
        context.packageManager.packageInstaller
            .uninstall(packageName, statusSender(packageName.hashCode(), commandId))
        return "הסרה הופעלה עבור $packageName"
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
            val declaredLength = connection.contentLengthLong
            if (declaredLength > MAX_APK_BYTES) {
                throw IllegalStateException("קובץ ה-APK גדול מהמגבלה המותרת")
            }
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var total = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > MAX_APK_BYTES) {
                            throw IllegalStateException("קובץ ה-APK גדול מהמגבלה המותרת")
                        }
                        output.write(buffer, 0, read)
                    }
                }
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

    private fun statusSender(
        requestCode: Int,
        commandId: String? = null,
        managedInstallWindow: Boolean = false,
    ): IntentSender {
        val intent = Intent(context, InstallResultReceiver::class.java).apply {
            commandId?.let { putExtra(EXTRA_COMMAND_ID, it) }
            putExtra(EXTRA_MANAGED_INSTALL_WINDOW, managedInstallWindow)
        }
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        return PendingIntent.getBroadcast(context, requestCode, intent, flags).intentSender
    }

    companion object {
        // Backend upload limit is 150 MiB. Keep a little protocol/headroom while
        // still preventing a changed/malicious URL from exhausting device storage.
        private const val MAX_APK_BYTES = 160L * 1024L * 1024L
        const val EXTRA_COMMAND_ID = "commandId"
        const val EXTRA_MANAGED_INSTALL_WINDOW = "managedInstallWindow"
    }
}
