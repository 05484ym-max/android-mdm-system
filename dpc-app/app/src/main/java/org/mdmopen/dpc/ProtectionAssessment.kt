package org.mdmopen.dpc

/**
 * Human-facing protection summary derived only from capabilities verified on
 * the device. The server may request a stronger policy later, but this value
 * must never claim a level that was not actually observed locally.
 */
enum class UninstallProtection {
    NONE,
    BEST_EFFORT,
    ADMIN_GATED,
    DEVICE_OWNER_ENFORCED,
    SYSTEM_LEVEL,
}

data class ProtectionAssessment(
    val uninstallProtection: UninstallProtection,
    val defaultHomeVerified: Boolean,
    val accessibilityVerified: Boolean,
    val deviceAdminVerified: Boolean,
    val deviceOwnerVerified: Boolean,
    val privilegedAppVerified: Boolean,
    val rootObserved: Boolean,
) {
    /** Stable machine-readable summary for backend/panel display. */
    val achievedProfile: String
        get() = when (uninstallProtection) {
            UninstallProtection.SYSTEM_LEVEL -> "SYSTEM_LEVEL"
            UninstallProtection.DEVICE_OWNER_ENFORCED -> "DEVICE_OWNER"
            UninstallProtection.ADMIN_GATED -> "HARDENED_ADMIN"
            UninstallProtection.BEST_EFFORT -> "HARDENED"
            UninstallProtection.NONE -> "BASIC"
        }
}

object ProtectionAssessmentResolver {
    fun from(profile: DeviceProfile): ProtectionAssessment = from(profile.capabilities)

    fun from(capabilities: Set<DeviceCapability>): ProtectionAssessment {
        val defaultHome = DeviceCapability.DEFAULT_HOME in capabilities
        val accessibility = DeviceCapability.ACCESSIBILITY in capabilities
        val admin = DeviceCapability.DEVICE_ADMIN in capabilities
        val owner = DeviceCapability.DEVICE_OWNER in capabilities
        val privileged = DeviceCapability.PRIV_APP in capabilities
        val root = DeviceCapability.ROOT in capabilities

        // PRIV_APP means the package is actually observed under a privileged
        // system-app location. Root alone is deliberately NOT treated as
        // system-level enforcement; a su binary is only a capability hint.
        val uninstall = when {
            privileged -> UninstallProtection.SYSTEM_LEVEL
            owner -> UninstallProtection.DEVICE_OWNER_ENFORCED
            admin -> UninstallProtection.ADMIN_GATED
            defaultHome && accessibility -> UninstallProtection.BEST_EFFORT
            else -> UninstallProtection.NONE
        }

        return ProtectionAssessment(
            uninstallProtection = uninstall,
            defaultHomeVerified = defaultHome,
            accessibilityVerified = accessibility,
            deviceAdminVerified = admin,
            deviceOwnerVerified = owner,
            privilegedAppVerified = privileged,
            rootObserved = root,
        )
    }
}
