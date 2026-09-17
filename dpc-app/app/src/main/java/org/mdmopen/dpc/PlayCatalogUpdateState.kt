package org.mdmopen.dpc

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray

/**
 * Keeps the customer-facing Play catalog status aligned with what Google Play
 * actually offers to this exact device.
 *
 * Public Play versionName text is not device-stable: variants/rollouts can
 * legitimately report a different versionName from PackageManager even when
 * the device already has the newest build Play offers it. Therefore the store
 * must not treat a versionName mismatch alone as proof of an available update.
 *
 * When the server gives us Google Play's updated timestamp, compare it with the
 * package's local lastUpdateTime. If this device installed/updated the package
 * at or after the current Play release timestamp, normalize the cached catalog
 * version to the version actually installed on this device. CustomerActivity's
 * existing status rendering then correctly shows "מותקן". A later Play release
 * has a newer playUpdatedAt and is not normalized, so "עדכון זמין" can appear.
 *
 * Guarded Play sessions also keep the explicit acknowledgement path for staged
 * rollouts where public metadata and the exact device offering can differ.
 */
object PlayCatalogUpdateState {
    private const val CONFIG_PREFS = "dpc_config"
    private const val KEY_APP_CATALOG = "app_catalog"
    private const val ACK_PREFS = "dpc_play_catalog_ack"

    fun acknowledgeInstalledVersion(context: Context, packageName: String): Boolean {
        val appContext = context.applicationContext
        val installedVersion = installedVersionName(appContext, packageName) ?: return false
        val prefs = appContext.getSharedPreferences(CONFIG_PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_APP_CATALOG, null) ?: return false
        val array = runCatching { JSONArray(raw) }.getOrNull() ?: return false
        var remoteVersion: String? = null
        var changed = false

        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            if (item.optString("packageName") != packageName) continue
            if (!item.optString("appSource", "PLAY").equals("PLAY", ignoreCase = true)) return false
            remoteVersion = item.optString("playVersion", "").trim().takeIf { it.isNotBlank() }
            if (item.optString("playVersion", "") != installedVersion) {
                item.put("playVersion", installedVersion)
                changed = true
            }
            break
        }

        val advertisedVersion = remoteVersion ?: return false
        val ackStored = ackPrefs(appContext).edit()
            .putString(remoteKey(packageName), advertisedVersion)
            .putString(installedKey(packageName), installedVersion)
            .commit()
        if (!ackStored) return false

        if (!changed) return true
        return prefs.edit().putString(KEY_APP_CATALOG, array.toString()).commit()
    }

    /** Re-apply a still-valid device acknowledgement after server policy sync. */
    fun reapplyAcknowledgements(context: Context): Boolean {
        val appContext = context.applicationContext
        val prefs = appContext.getSharedPreferences(CONFIG_PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_APP_CATALOG, null) ?: return true
        val array = runCatching { JSONArray(raw) }.getOrNull() ?: return false
        val acknowledgements = ackPrefs(appContext)
        val ackEditor = acknowledgements.edit()
        var catalogChanged = false
        var ackChanged = false

        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            if (!item.optString("appSource", "PLAY").equals("PLAY", ignoreCase = true)) continue
            val packageName = item.optString("packageName", "").trim()
            if (packageName.isBlank()) continue

            val installed = installedPackageState(appContext, packageName)
            val currentRemote = item.optString("playVersion", "").trim()
            val playUpdatedAt = item.optLong("playUpdatedAt", 0L)

            // Strongest device-local signal available without a Play update API:
            // this package was installed/updated no earlier than the current
            // Play release timestamp. In that case a textual versionName mismatch
            // must not keep showing a false "update available" badge.
            if (installed != null && playUpdatedAt > 0L && installed.lastUpdateTime >= playUpdatedAt) {
                if (currentRemote != installed.versionName) {
                    item.put("playVersion", installed.versionName)
                    catalogChanged = true
                }
                continue
            }

            val acknowledgedRemote = acknowledgements.getString(remoteKey(packageName), null) ?: continue
            val acknowledgedInstalled = acknowledgements.getString(installedKey(packageName), null) ?: continue
            val currentInstalled = installed?.versionName

            if (currentRemote == acknowledgedRemote && currentInstalled == acknowledgedInstalled) {
                if (currentRemote != acknowledgedInstalled) {
                    item.put("playVersion", acknowledgedInstalled)
                    catalogChanged = true
                }
            } else {
                ackEditor.remove(remoteKey(packageName)).remove(installedKey(packageName))
                ackChanged = true
            }
        }

        val ackOk = !ackChanged || ackEditor.commit()
        if (!ackOk) return false
        return !catalogChanged || prefs.edit().putString(KEY_APP_CATALOG, array.toString()).commit()
    }

    fun installedVersionCode(context: Context, packageName: String): Long? = try {
        val info = context.packageManager.getPackageInfo(packageName, 0)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }

    private data class InstalledPackageState(
        val versionName: String,
        val lastUpdateTime: Long,
    )

    private fun installedPackageState(context: Context, packageName: String): InstalledPackageState? {
        return try {
            val info = context.packageManager.getPackageInfo(packageName, 0)
            val versionName = info.versionName?.trim()?.takeIf { it.isNotBlank() } ?: return null
            InstalledPackageState(versionName, info.lastUpdateTime)
        } catch (_: PackageManager.NameNotFoundException) {
            null
        }
    }

    private fun installedVersionName(context: Context, packageName: String): String? =
        installedPackageState(context, packageName)?.versionName

    private fun ackPrefs(context: Context) =
        context.getSharedPreferences(ACK_PREFS, Context.MODE_PRIVATE)

    private fun remoteKey(packageName: String) = "remote:$packageName"
    private fun installedKey(packageName: String) = "installed:$packageName"
}
