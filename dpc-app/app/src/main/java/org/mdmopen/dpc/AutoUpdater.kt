package org.mdmopen.dpc

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.os.UserManager
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

object AutoUpdater {

    private const val TAG = "MdmAutoUpdater"
    private val running = AtomicBoolean(false)

    fun check(context: Context) {
        if (!running.compareAndSet(false, true)) return

        Thread {
            try {
                checkInternal(context.applicationContext)
            } catch (e: Exception) {
                Log.e(TAG, "Update check failed", e)
            } finally {
                running.set(false)
            }
        }.start()
    }

    private fun checkInternal(context: Context) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)

        if (!dpm.isDeviceOwnerApp(context.packageName)) {
            Log.w(TAG, "Not Device Owner - skipping auto update")
            return
        }

        val baseUrl = Config.serverUrl(context).trimEnd('/')
        val metadataUrl = "$baseUrl/downloads/version.json"

        val metadata = JSONObject(downloadText(metadataUrl))
        val remoteVersion = metadata.getLong("versionCode")

        val currentVersion =
            context.packageManager
                .getPackageInfo(context.packageName, 0)
                .longVersionCode

        if (remoteVersion <= currentVersion) {
            Log.i(TAG, "Already up to date: $currentVersion")
            return
        }

        val apkUrl =
            metadata.optString(
                "apkUrl",
                "$baseUrl/downloads/mdm.apk"
            )

        Log.i(TAG, "New version: $remoteVersion")

        val apk = File(context.cacheDir, "mdm-update-$remoteVersion.apk")

        try {
            downloadFile(apkUrl, apk)
            verifyApk(context, apk, remoteVersion)
            installUpdate(context, apk, remoteVersion)
        } catch (e: Exception) {
            // The actual install outcome (once committed) is reported
            // asynchronously by UpdateInstallReceiver instead - this only
            // covers a failure before that point (download/verification).
            DeviceHealth.recordUpdateResult(context, "FAILED", remoteVersion, e.message)
            throw e
        }
    }

    private fun downloadText(url: String): String {
        val connection = URL(url).openConnection() as HttpURLConnection

        try {
            connection.connectTimeout = 15000
            connection.readTimeout = 15000
            connection.requestMethod = "GET"

            if (connection.responseCode !in 200..299) {
                error("HTTP ${connection.responseCode}")
            }

            return connection.inputStream
                .bufferedReader()
                .use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadFile(url: String, file: File) {
        val connection = URL(url).openConnection() as HttpURLConnection

        try {
            connection.connectTimeout = 20000
            connection.readTimeout = 60000
            connection.requestMethod = "GET"

            if (connection.responseCode !in 200..299) {
                error("APK HTTP ${connection.responseCode}")
            }

            connection.inputStream.use { input ->
                file.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun verifyApk(
        context: Context,
        apk: File,
        expectedVersion: Long
    ) {
        val pm = context.packageManager

        val archive =
            pm.getPackageArchiveInfo(
                apk.absolutePath,
                PackageManager.GET_SIGNING_CERTIFICATES
            ) ?: error("APK לא תקין")

        if (archive.packageName != context.packageName) {
            error("Package name mismatch")
        }

        if (archive.longVersionCode != expectedVersion) {
            error("Version mismatch")
        }

        val installed =
            pm.getPackageInfo(
                context.packageName,
                PackageManager.GET_SIGNING_CERTIFICATES
            )

        val oldCerts =
            installed.signingInfo.apkContentsSigners
                .map { sha256(it.toByteArray()) }
                .toSet()

        val newCerts =
            archive.signingInfo.apkContentsSigners
                .map { sha256(it.toByteArray()) }
                .toSet()

        if (oldCerts != newCerts) {
            error("APK signing certificate mismatch")
        }

        Log.i(TAG, "APK signature verified")
    }

    private fun sha256(data: ByteArray): String =
        MessageDigest
            .getInstance("SHA-256")
            .digest(data)
            .joinToString("") { "%02x".format(it) }

    private fun installUpdate(context: Context, apk: File, remoteVersion: Long) {
        val installer = context.packageManager.packageInstaller

        val params =
            PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL
            ).apply {
                setAppPackageName(context.packageName)

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setRequireUserAction(
                        PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED
                    )
                }
            }

        // Must be lifted before createSession() - DISALLOW_INSTALL_APPS blocks
        // session creation itself, not just the final commit.
        temporarilyAllowInstall(context)

        var sessionId = -1

        try {
            sessionId = installer.createSession(params)

            installer.openSession(sessionId).use { session ->

                apk.inputStream().use { input ->
                    session.openWrite(
                        "base.apk",
                        0,
                        apk.length()
                    ).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }

                val callbackIntent =
                    Intent(
                        context,
                        UpdateInstallReceiver::class.java
                    ).apply {
                        action = UpdateInstallReceiver.ACTION_UPDATE_RESULT
                        putExtra(UpdateInstallReceiver.EXTRA_VERSION_CODE, remoteVersion)
                    }

                val pendingIntent =
                    PendingIntent.getBroadcast(
                        context,
                        sessionId,
                        callbackIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT or
                            PendingIntent.FLAG_MUTABLE
                    )

                session.commit(pendingIntent.intentSender)
            }

            Log.i(TAG, "Update installation committed")

        } catch (e: Exception) {
            restoreInstallBlock(context)

            if (sessionId >= 0) {
                try {
                    installer.abandonSession(sessionId)
                } catch (_: Exception) {
                }
            }

            throw e
        }
    }

    private fun temporarilyAllowInstall(context: Context) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin =
            ComponentName(
                context,
                DpcDeviceAdminReceiver::class.java
            )

        dpm.clearUserRestriction(
            admin,
            UserManager.DISALLOW_INSTALL_APPS
        )

        context.getSharedPreferences(
            "dpc_updater",
            Context.MODE_PRIVATE
        ).edit()
            .putBoolean("install_in_progress", true)
            .apply()
    }

    fun restoreInstallBlock(context: Context) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)

        if (!dpm.isDeviceOwnerApp(context.packageName)) return

        val admin =
            ComponentName(
                context,
                DpcDeviceAdminReceiver::class.java
            )

        dpm.addUserRestriction(
            admin,
            UserManager.DISALLOW_INSTALL_APPS
        )

        context.getSharedPreferences(
            "dpc_updater",
            Context.MODE_PRIVATE
        ).edit()
            .putBoolean("install_in_progress", false)
            .apply()

        Log.i(TAG, "Install blocking restored")
    }
}
