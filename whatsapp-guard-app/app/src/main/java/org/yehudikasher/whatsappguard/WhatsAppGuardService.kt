package org.yehudikasher.whatsappguard

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent

class WhatsAppGuardService : AccessibilityService() {
    private lateinit var overlays: OverlayController
    private lateinit var engine: WhatsAppGuardEngine
    private val handler = Handler(Looper.getMainLooper())
    private var scheduled = false

    override fun onServiceConnected() {
        super.onServiceConnected()
        overlays = OverlayController(this)
        engine = WhatsAppGuardEngine(this, overlays)
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
            val pkg = root?.packageName?.toString()
            if (pkg != WHATSAPP_PACKAGE) {
                overlays.clear()
                return@postDelayed
            }
            engine.render(root, GuardPolicy.load(this))
        }, 35L)
    }

    companion object {
        const val WHATSAPP_PACKAGE = "com.whatsapp"
    }
}
