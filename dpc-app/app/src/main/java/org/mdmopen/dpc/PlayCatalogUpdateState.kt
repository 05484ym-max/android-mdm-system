package org.mdmopen.dpc

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray

/**
 * Keeps the customer-facing Play catalog status aligned with what Google Play
 * actually offers to this exact device.
 *
 * Public catalog metadata can advertise a rollout that is not yet available to
 * a particular device. After a guarded Play session succeeds, or after Play
 * establishes that the already-installed package is current for this device,
 * we remember the pair: server catalog version + actually installed version.
 *
 * On later policy syncs, if the server still advertises that same catalog
 * version and the installed version is unchanged, we locally present the app as
 * current. As soon as the server catalog version changes, the acknowledgement is
 * dropped automatically and a new update can be shown.
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

            val acknowledgedRemote = acknowledgements.getString(remoteKey(packageName), null) ?: continue
            val acknowledgedInstalled = acknowledgements.getString(installedKey(packageName), null) ?: continue
            val currentRemote = item.optString("playVersion", "").trim()
            val currentInstalled = installedVersionName(appContext, packageName)

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

    private fun installedVersionName(context: Context, packageName: String): String? = try {
        context.packageManager.getPackageInfo(packageName, 0).versionName
            ?.trim()
            ?.takeIf { it.isNotBlank() }
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }

    private fun ackPrefs(context: Context) =
        context.getSharedPreferences(ACK_PREFS, Context.MODE_PRIVATE)

    private fun remoteKey(packageName: String) = "remote:$packageName"
    private fun installedKey(packageName: String) = "installed:$packageName"
}
