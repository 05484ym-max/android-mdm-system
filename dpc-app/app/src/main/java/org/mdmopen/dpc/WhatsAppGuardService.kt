package org.mdmopen.dpc

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent

class WhatsAppGuardService : AccessibilityService() {
    private lateinit var overlays: WhatsAppOverlayController
    private lateinit var engine: WhatsAppGuardEngine
    private val handler = Handler(Looper.getMainLooper())
    private var scheduled = false
    private var lastRenderAt = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        overlays = WhatsAppOverlayController(this)
        engine = WhatsAppGuardEngine(this, overlays)
        WhatsAppGuardProtection.reconcile(this, WhatsAppGuardConfig.load(this))
        try {
            // The accessibility service actually connecting is the earliest,
            // most authoritative signal that setup succeeded - end the setup
            // window immediately instead of waiting for the Activity to resume.
            val enforcer = PolicyEnforcer(applicationContext)
            if (enforcer.isDeviceOwner()) {
                enforcer.markAccessibilitySetupComplete()
                // Keep the relock explicit here as a belt-and-suspenders call and
                // so the production invariant continues to verify the service itself.
                enforcer.allowManagedAccessibilityService()
            }
        } catch (_: Exception) {
            // The bounded WorkManager failsafe will retry the local relock.
        }
        scheduleRender(immediate = true)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.packageName?.toString() != WHATSAPP_PACKAGE) {
            if (::overlays.isInitialized) overlays.clear()
            return
        }
        // Window topology/state changes and clicks should react immediately.
        // High-volume content/scroll events are coalesced to avoid flicker.
        val immediate = when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOWS_CHANGED,
            AccessibilityEvent.TYPE_VIEW_CLICKED -> true
            else -> false
        }
        scheduleRender(immediate)
    }

    override fun onInterrupt() {
        if (::overlays.isInitialized) overlays.clear()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (::overlays.isInitialized) overlays.clear()
        super.onDestroy()
    }

    private fun scheduleRender(immediate: Boolean = false) {
        if (!::engine.isInitialized) return
        val now = android.os.SystemClock.uptimeMillis()
        if (immediate && now - lastRenderAt >= MIN_RENDER_INTERVAL_MS) {
            handler.removeCallbacksAndMessages(RENDER_TOKEN)
            scheduled = false
            renderNow()
            return
        }
        if (scheduled) return
        scheduled = true
        handler.postAtTime({
            scheduled = false
            renderNow()
        }, RENDER_TOKEN, now + COALESCE_DELAY_MS)
    }

    private fun renderNow() {
        lastRenderAt = android.os.SystemClock.uptimeMillis()
        val root = rootInActiveWindow
        if (root?.packageName?.toString() != WHATSAPP_PACKAGE) {
            overlays.clear()
            return
        }
        engine.render(root, WhatsAppGuardConfig.load(this))
    }

    companion object {
        const val WHATSAPP_PACKAGE = "com.whatsapp"
        private const val COALESCE_DELAY_MS = 50L
        private const val MIN_RENDER_INTERVAL_MS = 24L
        private val RENDER_TOKEN = Any()
    }
}
