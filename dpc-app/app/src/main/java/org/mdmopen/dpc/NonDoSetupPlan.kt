package org.mdmopen.dpc

/**
 * Ordered, non-destructive setup plan for stock devices that are not Device Owner.
 *
 * This planner never claims that a step is complete from the model name alone;
 * it consumes the runtime capabilities detected by DeviceCapabilityDetector.
 * It also deliberately contains no flashing, bootloader-unlock, root or wipe
 * operations. Those require a separate technician-controlled provisioning path.
 */
enum class NonDoSetupStep {
    SET_DEFAULT_HOME,
    ENABLE_ACCESSIBILITY,
    ACTIVATE_DEVICE_ADMIN,
    OEM_BACKGROUND_SETUP,
    VERIFY_PROTECTION,
}

data class NonDoSetupPlan(
    val adapterId: String,
    val steps: List<NonDoSetupStep>,
    val alreadyDeviceOwner: Boolean,
    val achieved: ProtectionAssessment,
)

object NonDoSetupPlanner {
    fun build(profile: DeviceProfile, adapterId: String): NonDoSetupPlan {
        val capabilities = profile.capabilities
        val achieved = ProtectionAssessment.from(capabilities)

        if (DeviceCapability.DEVICE_OWNER in capabilities) {
            return NonDoSetupPlan(
                adapterId = adapterId,
                steps = listOf(NonDoSetupStep.VERIFY_PROTECTION),
                alreadyDeviceOwner = true,
                achieved = achieved,
            )
        }

        val steps = buildList {
            if (DeviceCapability.DEFAULT_HOME !in capabilities) {
                add(NonDoSetupStep.SET_DEFAULT_HOME)
            }
            if (DeviceCapability.ACCESSIBILITY !in capabilities) {
                add(NonDoSetupStep.ENABLE_ACCESSIBILITY)
            }
            if (DeviceCapability.DEVICE_ADMIN !in capabilities) {
                add(NonDoSetupStep.ACTIVATE_DEVICE_ADMIN)
            }

            // Samsung/Xiaomi/Qin all have OEM-specific background/settings
            // behavior worth verifying even after the three Android-level
            // capabilities above are active. Generic AOSP skips this extra step.
            if (adapterId != "aosp.generic") {
                add(NonDoSetupStep.OEM_BACKGROUND_SETUP)
            }

            add(NonDoSetupStep.VERIFY_PROTECTION)
        }

        return NonDoSetupPlan(
            adapterId = adapterId,
            steps = steps.distinct(),
            alreadyDeviceOwner = false,
            achieved = achieved,
        )
    }
}
