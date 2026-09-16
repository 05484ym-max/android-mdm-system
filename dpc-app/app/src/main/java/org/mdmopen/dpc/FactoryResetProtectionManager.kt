package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.app.admin.FactoryResetProtectionPolicy
import android.content.ComponentName
import android.content.Context
import android.os.Build

/**
 * Android's official Factory Reset Protection (FRP) policy API is available from API 30.
 *
 * Important safety invariant: we never write an enabled FRP policy with an empty recovery
 * account list. On OEM FRP agents that could leave no known administrative recovery path.
 * Callers must provide account identifiers understood by the device's FRP management agent.
 */
class FactoryResetProtectionManager(private val context: Context) {

    private val dpm =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)

    fun applyRecoveryAccounts(rawAccounts: List<String>): String {
        check(dpm.isDeviceOwnerApp(context.packageName)) { "Not device owner" }
        check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            "Factory Reset Protection policy requires Android 11 (API 30) or newer"
        }

        val accounts = normalizeAccounts(rawAccounts)
        require(accounts.isNotEmpty()) {
            "Refusing to enable managed FRP without at least one recovery account"
        }

        val policy = FactoryResetProtectionPolicy.Builder()
            .setFactoryResetProtectionEnabled(true)
            .setFactoryResetProtectionAccounts(accounts)
            .build()

        try {
            dpm.setFactoryResetProtectionPolicy(admin, policy)
            val applied = dpm.getFactoryResetProtectionPolicy(admin)
                ?: error("FRP policy write returned no readable policy")
            check(applied.isFactoryResetProtectionEnabled) {
                "FRP policy verification failed: policy is disabled"
            }
            check(applied.factoryResetProtectionAccounts.toSet() == accounts.toSet()) {
                "FRP policy verification failed: recovery accounts do not match"
            }
        } catch (e: UnsupportedOperationException) {
            throw IllegalStateException("Factory Reset Protection is not supported by this device", e)
        }

        return "FRP enabled with ${accounts.size} recovery account(s)"
    }

    /**
     * Release must not leave behind a management policy that the former owner can no longer
     * administer. Clearing is best-effort only for unsupported pre-API-30 / non-FRP devices;
     * genuine security/state failures are surfaced and abort release.
     */
    fun clearManagedPolicyForRelease() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        check(dpm.isDeviceOwnerApp(context.packageName)) { "Not device owner" }
        try {
            dpm.setFactoryResetProtectionPolicy(admin, null)
            check(dpm.getFactoryResetProtectionPolicy(admin) == null) {
                "FRP policy did not clear before Device Owner release"
            }
        } catch (_: UnsupportedOperationException) {
            // This device has no supported FRP management agent, so there is no managed
            // FRP state for this DPC to clean up.
        }
    }

    companion object {
        internal fun normalizeAccounts(rawAccounts: List<String>): List<String> {
            val normalized = rawAccounts
                .map(String::trim)
                .filter(String::isNotEmpty)
                .distinct()

            require(normalized.size <= MAX_RECOVERY_ACCOUNTS) {
                "Too many FRP recovery accounts (max $MAX_RECOVERY_ACCOUNTS)"
            }
            normalized.forEach { account ->
                require(account.length <= MAX_ACCOUNT_ID_LENGTH) {
                    "FRP recovery account identifier is too long"
                }
            }
            return normalized
        }

        private const val MAX_RECOVERY_ACCOUNTS = 10
        private const val MAX_ACCOUNT_ID_LENGTH = 320
    }
}
