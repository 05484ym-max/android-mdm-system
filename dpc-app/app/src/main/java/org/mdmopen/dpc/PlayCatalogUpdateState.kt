package org.mdmopen.dpc

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray

/**
 * Keeps the customer-facing Play catalog status aligned with what is actually
 * installed on this device after an approved guarded Play session.
 *
 * Public Play metadata can describe a newer rollout than the version Google
 * Play currently offers to a particular device. After Play confirms an install
 * or after the guarded flow establishes that the already-installed package is
 * current for this device, rewrite only the local cached playVersion for that
 * package to the versionName PackageManager actually reports. The next policy
 * sync may replace it again when the server catalog really changes.
 */
object PlayCatalogUpdateState {
    private const val CONFIG_PREFS = "dpc_config"
    private const val KEY_APP_CATALOG = "app_catalog"

    fun acknowledgeInstalledVersion(context: Context, packageName: String): Boolean {
        val installedVersion = installedVersionName(context, packageName) ?: return false
        val prefs = context.applicationContext.getSharedPreferences(CONFIG_PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_APP_CATALOG, null) ?: return false
        val array = runCatching { JSONArray(raw) }.getOrNull() ?: return false
        var changed = false

        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            if (item.optString("packageName") != packageName) continue
            if (item.optString("appSource", "PLAY") != "PLAY") return false
            if (item.optString("playVersion", "") != installedVersion) {
                item.put("playVersion", installedVersion)
                changed = true
            }
            break
        }

        if (!changed) return true
        return prefs.edit().putString(KEY_APP_CATALOG, array.toString()).commit()
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
}
