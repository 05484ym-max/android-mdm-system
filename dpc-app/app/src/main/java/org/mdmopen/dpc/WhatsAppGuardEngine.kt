package org.mdmopen.dpc

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class WhatsAppGuardEngine(
    private val service: AccessibilityService,
    private val overlays: WhatsAppOverlayController,
) {
    private var lastEjectAt = 0L
    private val mainHandler = Handler(Looper.getMainLooper())

    fun handleEvent(event: AccessibilityEvent?, policy: WhatsAppGuardPolicy): Boolean {
        if (event == null || !policy.enabled) return false

        // Status/Channel blocking stays completely separate from profile-photo masking.
        // Only a local click target can trigger GLOBAL_ACTION_BACK.
        if (event.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            val signals = clickSignals(event)

            val statusTarget = policy.blockStatuses && signals.any { (text, id) ->
                !WhatsAppGuardTerms.isUpdates(text, id) && WhatsAppGuardTerms.isStatus(text, id)
            }
            if (statusTarget) return ejectBack(WhatsAppBlockedActivity.KIND_STATUS)

            val channelTarget = policy.blockChannels && signals.any { (text, id) ->
                !WhatsAppGuardTerms.isUpdates(text, id) && WhatsAppGuardTerms.isChannel(text, id)
            }
            if (channelTarget) return ejectBack(WhatsAppBlockedActivity.KIND_CHANNEL)
        }
        return false
    }

    fun render(root: AccessibilityNodeInfo?, policy: WhatsAppGuardPolicy) {
        if (root == null || !policy.enabled) {
            overlays.clear()
            return
        }

        overlays.beginFrame()

        if (policy.hideProfilePhotos) {
            val screen = WhatsAppScreenClassifier.classify(root)
            val target = WhatsAppMaskCalibrationStore.targetFor(screen)
            if (target != null) {
                // Manual calibration is authoritative. We deliberately do not fall back
                // to momentary ImageView/row detection: if a screen has not been calibrated,
                // draw nothing rather than placing inaccurate grey boxes over WhatsApp.
                WhatsAppMaskCalibrationStore.get(service, target)?.let { calibration ->
                    overlays.addMask(calibration.toScreenRect(displayBounds()))
                }
            }
        }

        // Status/Channels intentionally have no overlay fallback. They are handled only
        // by target-specific click ejection above and by Updates navigation in the service.
        overlays.endFrame()
    }

    private fun clickSignals(event: AccessibilityEvent): List<Pair<String?, String?>> {
        val out = mutableListOf<Pair<String?, String?>>()
        val seen = mutableSetOf<AccessibilityNodeInfo>()

        fun add(node: AccessibilityNodeInfo?) {
            if (node == null || !seen.add(node)) return
            out += WhatsAppScreenClassifier.nodeText(node) to node.viewIdResourceName
        }

        fun addDescendants(node: AccessibilityNodeInfo?, depth: Int) {
            if (node == null || depth < 0) return
            add(node)
            if (depth == 0) return
            for (i in 0 until node.childCount) {
                addDescendants(node.getChild(i), depth - 1)
            }
        }

        val source = event.source
        if (source != null) {
            addDescendants(source, 2)
            var parent = source.parent
            repeat(2) {
                add(parent)
                parent = parent?.parent
            }
        }

        event.text?.joinToString(" ")?.takeIf { it.isNotBlank() }?.let { out += it to null }
        event.contentDescription?.toString()?.takeIf { it.isNotBlank() }?.let { out += it to null }
        return out
    }

    private fun ejectBack(kind: String): Boolean {
        val now = SystemClock.uptimeMillis()
        if (now - lastEjectAt < EJECT_DEBOUNCE_MS) return true
        lastEjectAt = now
        overlays.clear()
        val backedOut = service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
        if (backedOut) {
            mainHandler.postDelayed({ showBlockedScreen(kind) }, BLOCKED_SCREEN_DELAY_MS)
        }
        return backedOut
    }

    private fun showBlockedScreen(kind: String) {
        val intent = Intent(service, WhatsAppBlockedActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(WhatsAppBlockedActivity.EXTRA_KIND, kind)
        }
        try {
            service.startActivity(intent)
        } catch (_: Exception) {
            // Blocking already succeeded through GLOBAL_ACTION_BACK. Never suspend
            // WhatsApp merely because the informational screen could not be shown.
        }
    }

    private fun displayBounds(): Rect = Rect(
        0,
        0,
        service.resources.displayMetrics.widthPixels,
        service.resources.displayMetrics.heightPixels,
    )

    companion object {
        private const val EJECT_DEBOUNCE_MS = 650L
        private const val BLOCKED_SCREEN_DELAY_MS = 90L
    }
}
