package org.mdmopen.dpc

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject

/**
 * Collects the device-health fields reported on every sync, and separately
 * persists the outcome of the last AutoUpdater attempt (recorded in
 * AutoUpdater.kt / UpdateInstallReceiver.kt) so it can be included on the
 * *next* sync - the update check and the sync that reports it are two
 * separate round trips.
 *
 * Everything collected here is device/hardware metadata already visible to
 * any app with no special permission: battery percentage, free storage
 * space, OS/build info, and this app's own version. Nothing about the
 * customer - no location, no contacts, no files, no personal content.
 */
object DeviceHealth {

    private const val PREFS = "dpc_device_health"
    private const val KEY_LAST_UPDATE_STATUS = "last_update_status"
    private const val KEY_LAST_UPDATE_VERSION = "last_update_version"
    private const val KEY_LAST_UPDATE_ERROR = "last_update_error"
    private const val KEY_NO_LAUNCHER_CANDIDATES = "no_launcher_dry_run_candidates"

    /** Called from AutoUpdater/UpdateInstallReceiver once an update attempt
     * has an outcome. status should be one of "SUCCESS", "FAILED", "SKIPPED". */
    fun recordUpdateResult(context: Context, status: String, version: Long?, error: String?) {
        val editor = prefs(context).edit()
        editor.putString(KEY_LAST_UPDATE_STATUS, status)
        if (version != null) editor.putLong(KEY_LAST_UPDATE_VERSION, version)
        else editor.remove(KEY_LAST_UPDATE_VERSION)
        if (error != null) editor.putString(KEY_LAST_UPDATE_ERROR, error.take(500))
        else editor.remove(KEY_LAST_UPDATE_ERROR)
        editor.apply()
    }

    /**
     * Called from PolicySync right after PolicyEnforcer.apply() so the *next*
     * sync's health payload can report this cycle's DRY-RUN result - same
     * one-cycle-behind pattern as recordUpdateResult() above, since apply()
     * always runs after this sync's own health payload was already sent.
     * Always overwrites (never accumulates) so a package that got approved
     * or gained a launcher since the last cycle stops being reported.
     */
    fun recordNoLauncherDryRun(context: Context, candidates: List<NoLauncherCandidate>) {
        val array = JSONArray()
        candidates.forEach { candidate ->
            array.put(
                JSONObject()
                    .put("packageName", candidate.packageName)
                    .put("label", candidate.label)
            )
        }
        prefs(context).edit().putString(KEY_NO_LAUNCHER_CANDIDATES, array.toString()).apply()
    }

    /** Builds the JSON body reported on every sync. */
    fun collect(context: Context, isDeviceOwner: Boolean): JSONObject {
        val json = JSONObject()
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("manufacturer", Build.MANUFACTURER)
            .put("androidVersion", Build.VERSION.RELEASE)
            .put("isDeviceOwner", isDeviceOwner)

        appVersion(context)?.let { (code, name) ->
            json.put("currentVersionCode", code)
            name?.let { json.put("currentVersionName", it) }
        }

        batteryLevel(context)?.let { json.put("batteryLevel", it) }
        freeStorageBytes()?.let { json.put("freeStorageBytes", it) }

        val p = prefs(context)
        p.getString(KEY_LAST_UPDATE_STATUS, null)?.let { json.put("lastUpdateStatus", it) }
        if (p.contains(KEY_LAST_UPDATE_VERSION)) {
            json.put("lastUpdateVersion", p.getLong(KEY_LAST_UPDATE_VERSION, 0))
        }
        p.getString(KEY_LAST_UPDATE_ERROR, null)?.let { json.put("lastUpdateError", it) }
        p.getString(KEY_NO_LAUNCHER_CANDIDATES, null)?.let {
            json.put("wouldHideNoLauncherPackages", JSONArray(it))
        }

        val dns = AdBlockDns.currentStatus(context)
        json.put("dnsMode", dns.dnsMode.name)
        json.put("dnsActualProviderHost", dns.dnsActualProviderHost)
        json.put("dnsFilteringRequested", dns.dnsFilteringRequested)
        json.put("dnsFilteringActual", dns.dnsFilteringActual)
        json.put("dnsFailSafeState", dns.dnsFailSafeState.name)
        json.put("dnsResolutionOk", dns.dnsResolutionOk)
        json.put("dotProviderReachable", dns.dotProviderReachable)
        json.put("currentNetworkType", dns.currentNetworkType.name)
        json.put("consecutiveDnsFailures", dns.consecutiveDnsFailures)
        json.put("lastDnsCheckAt", dns.lastDnsCheckAt)
        json.put("lastDnsModeChangeAt", dns.lastDnsModeChangeAt)
        json.put("lastRollbackAt", dns.lastRollbackAt)
        json.put("failureReason", dns.failureReason)
        json.put("previousDnsMode", dns.previousDnsMode?.name)
        // Only present when the customer flipped the DNS switch locally and
        // the server hasn't confirmed it yet (see Config.setDnsPendingCustomerRequest) -
        // absent on every other sync, same optional-field convention as the
        // rest of this file.
        Config.dnsPendingCustomerRequest(context)?.let { json.put("customerDnsToggleRequest", it) }

        return json
    }

    private fun appVersion(context: Context): Pair<Long, String?>? = try {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        info.longVersionCode to info.versionName
    } catch (e: Exception) {
        null
    }

    private fun batteryLevel(context: Context): Int? = try {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        level.takeIf { it in 0..100 }
    } catch (e: Exception) {
        null
    }

    private fun freeStorageBytes(): Long? = try {
        StatFs(Environment.getDataDirectory().path).availableBytes
    } catch (e: Exception) {
        null
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
