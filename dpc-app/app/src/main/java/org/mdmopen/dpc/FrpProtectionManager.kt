package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.app.admin.FactoryResetProtectionPolicy
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.util.Log

/**
 * Official Android FRP management for Device Owner devices.
 *
 * Safety rules:
 * - Never invent or guess FRP account identifiers.
 * - Never enable FRP with an empty allow-list through this manager.
 * - Never clear an existing FRP policy merely because remote config is absent.
 * - Unsupported / non-Device-Owner devices are reported, not force-modified.
 */
object FrpProtectionManager {
    private const val TAG = "MdmFrpProtection"

    data class DesiredPolicy(
        val enabled: Boolean,
        val accountIds: List<String>,
    )

    data class Status(
        val apiSupported: Boolean,
        val deviceOwner: Boolean,
        val policyReadable: Boolean,
        val enabled: Boolean?,
        val accountCount: Int?,
        val matchesDesired: Boolean?,
        val error: String? = null,
    )

    fun reconcile(context: Context, desired: DesiredPolicy?): Status {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val isOwner = dpm.isDeviceOwnerApp(context.packageName)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return Status(false, isOwner, false, null, null, null, "API_UNSUPPORTED")
        }
        if (!isOwner) {
            return Status(true, false, false, null, null, null, "NOT_DEVICE_OWNER")
        }

        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)

        // Null means the server has not supplied an explicit FRP policy yet.
        // Observe only; do not accidentally clear or replace an existing policy.
        if (desired == null) return inspect(context)

        val normalizedAccounts = desired.accountIds
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()

        if (desired.enabled && normalizedAccounts.isEmpty()) {
            return inspect(context).copy(
                matchesDesired = false,
                error = "ENABLED_WITHOUT_ACCOUNTS_REJECTED",
            )
        }

        return try {
            val policy = FactoryResetProtectionPolicy.Builder()
                .setFactoryResetProtectionEnabled(desired.enabled)
                .setFactoryResetProtectionAccounts(normalizedAccounts)
                .build()
            dpm.setFactoryResetProtectionPolicy(admin, policy)
            inspect(context, desired.copy(accountIds = normalizedAccounts))
        } catch (e: UnsupportedOperationException) {
            Status(true, true, false, null, null, false, "FRP_NOT_SUPPORTED_BY_DEVICE")
        } catch (e: SecurityException) {
            Status(true, true, false, null, null, false, "FRP_SECURITY_EXCEPTION")
        } catch (e: Exception) {
            Log.w(TAG, "FRP reconcile failed", e)
            Status(true, true, false, null, null, false, "FRP_RECONCILE_FAILED")
        }
    }

    fun inspect(context: Context, desired: DesiredPolicy? = null): Status {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val isOwner = dpm.isDeviceOwnerApp(context.packageName)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return Status(false, isOwner, false, null, null, null, "API_UNSUPPORTED")
        }
        if (!isOwner) {
            return Status(true, false, false, null, null, null, "NOT_DEVICE_OWNER")
        }

        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        return try {
            val policy = dpm.getFactoryResetProtectionPolicy(admin)
            if (policy == null) {
                Status(true, true, true, false, 0, desired?.let { !it.enabled }, null)
            } else {
                val enabled = policy.isFactoryResetProtectionEnabled
                val accounts = policy.factoryResetProtectionAccounts.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
                val matches = desired?.let {
                    val wanted = it.accountIds.map(String::trim).filter(String::isNotEmpty).distinct().sorted()
                    enabled == it.enabled && accounts.sorted() == wanted
                }
                Status(true, true, true, enabled, accounts.size, matches, null)
            }
        } catch (e: UnsupportedOperationException) {
            Status(true, true, false, null, null, false, "FRP_NOT_SUPPORTED_BY_DEVICE")
        } catch (e: SecurityException) {
            Status(true, true, false, null, null, false, "FRP_SECURITY_EXCEPTION")
        } catch (e: Exception) {
            Log.w(TAG, "FRP inspect failed", e)
            Status(true, true, false, null, null, false, "FRP_INSPECT_FAILED")
        }
    }
}
