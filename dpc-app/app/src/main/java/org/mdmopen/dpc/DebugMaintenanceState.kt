package org.mdmopen.dpc

import android.content.Context

/**
 * Persists the admin-only temporary debugging window independently from normal policy.
 * OPEN_DEBUGGING_TEMP opens it; the next normal policy apply consumes it and restores
 * DISALLOW_DEBUGGING_FEATURES. Accessibility setup may inspect it so Samsung does not
 * tear adb down while we are intentionally collecting a crash log.
 */
object DebugMaintenanceState {
    private const val PREFS = "dpc_config"
    private const val KEY_ACTIVE = "debug_maintenance_active"

    fun isActive(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_ACTIVE, false)

    fun setActive(context: Context, active: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_ACTIVE, active)
            .apply()
    }
}
