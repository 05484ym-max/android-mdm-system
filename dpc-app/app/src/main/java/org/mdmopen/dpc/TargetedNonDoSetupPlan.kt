package org.mdmopen.dpc

data class TargetedNonDoSetupPlan(
    val requestedProfile: String,
    val adapterId: String,
    val steps: List<NonDoSetupStep>,
    val requiresReprovisioning: Boolean,
    val requiresSystemIntegration: Boolean,
    val achieved: ProtectionAssessment,
)

object TargetedNonDoSetupPlanner {
    private val allowedProfiles = setOf(
        "BASIC", "HARDENED", "HARDENED_ADMIN", "DEVICE_OWNER", "SYSTEM_LEVEL"
    )

    fun build(profile: DeviceProfile, adapterId: String, requestedProfile: String): TargetedNonDoSetupPlan {
        val requested = requestedProfile.takeIf { it in allowedProfiles } ?: "HARDENED_ADMIN"
        val capabilities = profile.capabilities
        val achieved = ProtectionAssessmentResolver.from(capabilities)
        val owner = DeviceCapability.DEVICE_OWNER in capabilities
        val systemEnforcement = DeviceCapability.SYSTEM_ENFORCEMENT in capabilities

        if (requested == "SYSTEM_LEVEL") {
            return TargetedNonDoSetupPlan(
                requestedProfile = requested,
                adapterId = adapterId,
                steps = listOf(NonDoSetupStep.VERIFY_PROTECTION),
                requiresReprovisioning = false,
                requiresSystemIntegration = !systemEnforcement,
                achieved = achieved,
            )
        }

        if (requested == "DEVICE_OWNER") {
            return TargetedNonDoSetupPlan(
                requestedProfile = requested,
                adapterId = adapterId,
                steps = listOf(NonDoSetupStep.VERIFY_PROTECTION),
                requiresReprovisioning = !owner,
                requiresSystemIntegration = false,
                achieved = achieved,
            )
        }

        val needsHardened = requested == "HARDENED"
        val needsAdmin = requested == "HARDENED_ADMIN"
        val steps = buildList {
            if (needsHardened && DeviceCapability.DEFAULT_HOME !in capabilities) add(NonDoSetupStep.SET_DEFAULT_HOME)
            if (needsHardened && DeviceCapability.ACCESSIBILITY !in capabilities) add(NonDoSetupStep.ENABLE_ACCESSIBILITY)
            if (needsAdmin && DeviceCapability.DEVICE_ADMIN !in capabilities) add(NonDoSetupStep.ACTIVATE_DEVICE_ADMIN)
            if ((needsHardened || needsAdmin) && adapterId != "aosp.generic") add(NonDoSetupStep.OEM_BACKGROUND_SETUP)
            add(NonDoSetupStep.VERIFY_PROTECTION)
        }.distinct()

        return TargetedNonDoSetupPlan(
            requestedProfile = requested,
            adapterId = adapterId,
            steps = steps,
            requiresReprovisioning = false,
            requiresSystemIntegration = false,
            achieved = achieved,
        )
    }
}
