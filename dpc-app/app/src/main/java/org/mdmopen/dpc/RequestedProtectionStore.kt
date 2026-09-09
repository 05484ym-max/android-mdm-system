package org.mdmopen.dpc

import android.content.Context

/** Server-owned requested protection target cached locally for guidance only. */
data class RequestedProtectionTarget(
    val requestedProfile: String,
    val achievedProfile: String,
    val protectionSatisfied: Boolean,
    val missingCapabilities: List<String>,
    val nextActions: List<String>,
    val requiresReprovisioning: Boolean,
    val requiresSystemIntegration: Boolean,
)

object RequestedProtectionStore {
    private const val PREFS = "requested_protection_target"

    fun save(context: Context, target: RequestedProtectionTarget) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("requested_profile", target.requestedProfile)
            .putString("achieved_profile", target.achievedProfile)
            .putBoolean("satisfied", target.protectionSatisfied)
            .putStringSet("missing", target.missingCapabilities.toSet())
            .putStringSet("actions", target.nextActions.toSet())
            .putBoolean("requires_reprovisioning", target.requiresReprovisioning)
            .putBoolean("requires_system_integration", target.requiresSystemIntegration)
            .apply()
    }

    fun read(context: Context): RequestedProtectionTarget? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val requested = prefs.getString("requested_profile", null) ?: return null
        return RequestedProtectionTarget(
            requestedProfile = requested,
            achievedProfile = prefs.getString("achieved_profile", "BASIC") ?: "BASIC",
            protectionSatisfied = prefs.getBoolean("satisfied", false),
            missingCapabilities = prefs.getStringSet("missing", emptySet()).orEmpty().sorted(),
            nextActions = prefs.getStringSet("actions", emptySet()).orEmpty().sorted(),
            requiresReprovisioning = prefs.getBoolean("requires_reprovisioning", false),
            requiresSystemIntegration = prefs.getBoolean("requires_system_integration", false),
        )
    }
}
