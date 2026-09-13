package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.UserManager
import android.util.Log

data class ResetProtectionState(
    val deviceOwner: Boolean,
    val factoryResetBlocked: Boolean,
    val safeBootBlocked: Boolean,
    val debuggingBlocked: Boolean,
    val dpcUninstallBlocked: Boolean,
) {
    val fullyEnforced: Boolean
        get() = deviceOwner && factoryResetBlocked && safeBootBlocked && debuggingBlocked && dpcUninstallBlocked
}

/**
 * Re-asserts the anti-reset/anti-escape policy that must remain true for every
 * Device Owner device, independently of network availability or the latest
 * server policy. This deliberately does not claim to block a hardware recovery
 * wipe; Android's normal Device Owner restrictions protect the running OS path.
 */
object ResetProtection {
    private const val TAG = "ResetProtection"

    fun enforce(context: Context): ResetProtectionState {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) {
            return snapshot(context)
        }

        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        runCatching { dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET) }
            .onFailure { Log.w(TAG, "Could not enforce factory-reset restriction", it) }
        runCatching { dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT) }
            .onFailure { Log.w(TAG, "Could not enforce safe-boot restriction", it) }
        runCatching { dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES) }
            .onFailure { Log.w(TAG, "Could not enforce debugging restriction", it) }
        runCatching { dpm.setUninstallBlocked(admin, context.packageName, true) }
            .onFailure { Log.w(TAG, "Could not enforce DPC uninstall block", it) }

        return snapshot(context)
    }

    fun snapshot(context: Context): ResetProtectionState {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val userManager = context.getSystemService(UserManager::class.java)
        val owner = runCatching { dpm.isDeviceOwnerApp(context.packageName) }.getOrDefault(false)
        if (!owner) {
            return ResetProtectionState(
                deviceOwner = false,
                factoryResetBlocked = false,
                safeBootBlocked = false,
                debuggingBlocked = false,
                dpcUninstallBlocked = false,
            )
        }

        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        return ResetProtectionState(
            deviceOwner = true,
            factoryResetBlocked = runCatching {
                userManager.hasUserRestriction(UserManager.DISALLOW_FACTORY_RESET)
            }.getOrDefault(false),
            safeBootBlocked = runCatching {
                userManager.hasUserRestriction(UserManager.DISALLOW_SAFE_BOOT)
            }.getOrDefault(false),
            debuggingBlocked = runCatching {
                userManager.hasUserRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES)
            }.getOrDefault(false),
            dpcUninstallBlocked = runCatching {
                dpm.isUninstallBlocked(admin, context.packageName)
            }.getOrDefault(false),
        )
    }
}
