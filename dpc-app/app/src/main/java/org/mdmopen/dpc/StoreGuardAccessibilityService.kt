package org.mdmopen.dpc

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

/**
 * Kicks the customer back to the home screen if the Play Store comes to the
 * foreground on its own. The store stays installed and reachable by
 * CommandExecutor (for an admin-approved install), but browsing it directly
 * is not allowed - see Config.playStoreAllowedUntil for the brief window
 * during which a store launch we triggered ourselves is left alone.
 */
class StoreGuardAccessibilityService : AccessibilityService() {

    companion object {
        const val ALLOW_WINDOW_MS = 20_000L
        private const val GUARDED_PACKAGE = "com.android.vending"
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        if (event.packageName?.toString() != GUARDED_PACKAGE) return

        val allowedUntil = Config.playStoreAllowedUntil(applicationContext)
        if (System.currentTimeMillis() > allowedUntil) {
            performGlobalAction(GLOBAL_ACTION_HOME)
        }
    }

    override fun onInterrupt() {}
}
