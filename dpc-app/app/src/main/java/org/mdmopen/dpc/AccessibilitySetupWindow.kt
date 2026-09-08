package org.mdmopen.dpc

/**
 * Pure decision rule for the Samsung accessibility setup-window invariant, kept
 * free of Context/DevicePolicyManager so it is directly unit-testable: while a
 * setup window is active, only a forced (finish/failsafe) restore may re-lock
 * the accessibility allowlist - a normal PolicySync/apply call must not.
 */
object AccessibilitySetupWindow {
    fun shouldRestoreAllowlist(setupActive: Boolean, force: Boolean): Boolean =
        force || !setupActive
}
