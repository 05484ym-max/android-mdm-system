package org.mdmopen.dpc

import android.content.Context
import android.content.Intent

/**
 * Small orchestration layer used by future UI/admin flows. It recomputes the
 * device facts before every decision so a step completed in Settings is
 * immediately reflected when the app resumes.
 */
object NonDoSetupCoordinator {

    data class State(
        val snapshot: CapabilitySnapshot,
        val plan: NonDoSetupPlan,
        val nextStep: NonDoSetupStep?,
        val nextIntent: Intent?,
    )

    fun currentState(context: Context): State {
        val snapshot = CapabilitySnapshotStore.refresh(context)
        val plan = NonDoSetupPlanner.build(snapshot.profile, snapshot.adapterId)
        val next = plan.steps.firstOrNull { it != NonDoSetupStep.VERIFY_PROTECTION }
        val nextIntent = when (next) {
            NonDoSetupStep.OEM_BACKGROUND_SETUP ->
                OemSetupNavigator.firstResolvableIntent(context, snapshot.adapterId)
            null -> null
            else -> NonDoSetupIntents.forStep(context, next)
        }

        return State(
            snapshot = snapshot,
            plan = plan,
            nextStep = next,
            nextIntent = nextIntent,
        )
    }
}
