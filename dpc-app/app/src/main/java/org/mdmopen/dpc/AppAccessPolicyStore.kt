package org.mdmopen.dpc

import android.content.Context

object AppAccessPolicyStore {
    private const val PREFS = "dpc_app_access_policy"
    private const val KEY_BLOCKED_PACKAGES = "blocked_packages"

    fun blockedPackages(context: Context): Set<String> =
        prefs(context).getStringSet(KEY_BLOCKED_PACKAGES, emptySet()).orEmpty().toSet()

    fun setBlockedPackages(context: Context, packages: Collection<String>) {
        val normalized = packages.asSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toSet()
        check(prefs(context).edit().putStringSet(KEY_BLOCKED_PACKAGES, normalized).commit()) {
            "Could not persist blocked packages"
        }
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
