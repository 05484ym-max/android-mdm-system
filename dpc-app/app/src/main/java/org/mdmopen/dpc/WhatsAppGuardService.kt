package org.mdmopen.dpc

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent

class WhatsAppGuardService : AccessibilityService() {
    private lateinit var overlays: WhatsAppOverlayController
    private lateinit var engine: WhatsAppGuardEngine
    private val handler = Handler(Looper.getMainLooper())
    private var scheduled = false
    private var lastRenderAt = 0L
    private var lastUpdatesEjectAt = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        overlays = WhatsAppOverlayController(this)
        engine = WhatsAppGuardEngine(this, overlays)
        WhatsAppGuardProtection.reconcile(this, WhatsAppGuardConfig.load(this))
        try {
            val enforcer = PolicyEnforcer(applicationContext)
            if (enforcer.isDeviceOwner()) {
                enforcer.markAccessibilitySetupComplete()
                enforcer.allowManagedAccessibilityService()
            }
        } catch (_: Exception) {
        }
        scheduleRender(immediate = true)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.packageName?.toString() != WHATSAPP_PACKAGE) {
            if (::overlays.isInitialized) overlays.clear()
            return
        }

        val policy = WhatsAppGuardConfig.load(this)

        // Navigation blocking remains immediate; render throttling below never delays it.
        if (event.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED && shouldBlockUpdatesClick(event, policy)) {
            blockUpdatesNavigation()
            return
        }

        if (::engine.isInitialized && engine.handleEvent(event, policy)) {
            return
        }

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

    private fun shouldBlockUpdatesClick(event: AccessibilityEvent, policy: WhatsAppGuardPolicy): Boolean {
        if (!policy.enabled || (!policy.blockStatuses && !policy.blockChannels)) return false
        val source = event.source
        val text = source?.let(WhatsAppScreenClassifier::nodeText)
            ?: event.text?.joinToString(" ")
        val id = source?.viewIdResourceName
        return WhatsAppGuardTerms.isUpdates(text, id)
    }

    private fun blockUpdatesNavigation() {
        val now = SystemClock.uptimeMillis()
        if (now - lastUpdatesEjectAt < UPDATES_EJECT_DEBOUNCE_MS) return
        lastUpdatesEjectAt = now
        if (::overlays.isInitialized) overlays.clear()

        val backedOut = performGlobalAction(GLOBAL_ACTION_BACK)
        if (!backedOut) return

        handler.postDelayed({
            val intent = Intent(this, WhatsAppBlockedActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(WhatsAppBlockedActivity.EXTRA_KIND, WhatsAppBlockedActivity.KIND_UPDATES)
            }
            try {
                startActivity(intent)
            } catch (_: Exception) {
                // The navigation block already succeeded through GLOBAL_ACTION_BACK.
            }
        }, BLOCKED_SCREEN_DELAY_MS)
    }

    private fun scheduleRender(immediate: Boolean = false) {
        if (!::engine.isInitialized) return
        val now = SystemClock.uptimeMillis()
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
        lastRenderAt = SystemClock.uptimeMillis()
        val root = rootInActiveWindow
        if (root?.packageName?.toString() != WHATSAPP_PACKAGE) {
            overlays.clear()
            return
        }
        engine.render(root, WhatsAppGuardConfig.load(this))
    }

    companion object {
        const val WHATSAPP_PACKAGE = "com.whatsapp"
        // Accessibility can emit dozens of content-change events per second while
        // lists animate/scroll. 80 ms keeps masks visually responsive (~12.5 fps)
        // while avoiding repeated full accessibility-tree scans at ~40 fps.
        private const val COALESCE_DELAY_MS = 80L
        private const val MIN_RENDER_INTERVAL_MS = 80L
        private const val UPDATES_EJECT_DEBOUNCE_MS = 650L
        private const val BLOCKED_SCREEN_DELAY_MS = 90L
        private val RENDER_TOKEN = Any()
    }
}
