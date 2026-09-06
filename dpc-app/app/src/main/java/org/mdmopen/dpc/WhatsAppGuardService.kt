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

    override fun onServiceConnected() {
        super.onServiceConnected()
        overlays = WhatsAppOverlayController(this)
        engine = WhatsAppGuardEngine(this, overlays)
        // This is the earliest reliable point where Android has confirmed the
        // service is truly enabled. On Device Owner devices this locks the
        // accessibility settings against customer bypass and releases WhatsApp
        // again if it was suspended during the one-time setup step.
        WhatsAppGuardProtection.reconcile(this, WhatsAppGuardConfig.load(this))
        scheduleRender()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.packageName?.toString() != WHATSAPP_PACKAGE) {
            if (::overlays.isInitialized) overlays.clear()
            return
        }
        scheduleRender()
    }

    override fun onInterrupt() {
        if (::overlays.isInitialized) overlays.clear()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (::overlays.isInitialized) overlays.clear()
        super.onDestroy()
    }

    private fun scheduleRender() {
        if (!::engine.isInitialized || scheduled) return
        scheduled = true
        handler.postDelayed({
            scheduled = false
            val root = rootInActiveWindow
            if (root?.packageName?.toString() != WHATSAPP_PACKAGE) {
                overlays.clear()
                return@postDelayed
            }
            engine.render(root, WhatsAppGuardConfig.load(this))
        }, 35L)
    }

    companion object {
        const val WHATSAPP_PACKAGE = "com.whatsapp"
    }
}
