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
        // A click is classified from strong local evidence first. If the clicked card has
        // no explicit label, the visible Status/Channels section headers are used as
        // geometric anchors. Ambiguous clicks fail open rather than blocking the wrong item.
        if (event.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            val signals = clickSignals(event)

            val statusTarget = policy.blockStatuses && signals.any { (text, id) ->
                !WhatsAppGuardTerms.isUpdates(text, id) &&
                    (WhatsAppGuardTerms.isStatus(text, id) || WhatsAppGuardTerms.isStatusContext(text))
            }
            val channelTarget = policy.blockChannels && signals.any { (text, id) ->
                !WhatsAppGuardTerms.isUpdates(text, id) &&
                    (WhatsAppGuardTerms.isChannel(text, id) || WhatsAppGuardTerms.isChannelContext(text))
            }

            when {
                statusTarget && !channelTarget -> return ejectBack(WhatsAppBlockedActivity.KIND_STATUS)
                channelTarget && !statusTarget -> return ejectBack(WhatsAppBlockedActivity.KIND_CHANNEL)
                else -> when (classifyBySectionGeometry(event)) {
                    ClickKind.STATUS -> if (policy.blockStatuses) {
                        return ejectBack(WhatsAppBlockedActivity.KIND_STATUS)
                    }
                    ClickKind.CHANNEL -> if (policy.blockChannels) {
                        return ejectBack(WhatsAppBlockedActivity.KIND_CHANNEL)
                    }
                    ClickKind.UNKNOWN -> Unit
                }
            }
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

    private fun classifyBySectionGeometry(event: AccessibilityEvent): ClickKind {
        val root = service.rootInActiveWindow ?: return ClickKind.UNKNOWN
        if (root.packageName?.toString() != WHATSAPP_PACKAGE) return ClickKind.UNKNOWN

        val source = event.source ?: return ClickKind.UNKNOWN
        val clickBounds = Rect().also(source::getBoundsInScreen)
        if (clickBounds.isEmpty) return ClickKind.UNKNOWN
        val clickY = clickBounds.centerY()

        val nodes = WhatsAppScreenClassifier.flatten(root)
        val statusTop = sectionAnchorTop(nodes, ClickKind.STATUS)
        val channelTop = sectionAnchorTop(nodes, ClickKind.CHANNEL)
        val margin = dp(6)

        // The Channels heading is the strongest structural separator in the Updates tab.
        // Anything clearly below it belongs to the channels section, even when the channel
        // card itself only exposes the channel name and no literal "channel" text.
        if (channelTop != null && clickY > channelTop + margin) return ClickKind.CHANNEL

        // A status is accepted only when we can place the click below the Status heading
        // and, when Channels is visible, strictly above the Channels boundary.
        if (statusTop != null && clickY > statusTop + margin) {
            if (channelTop == null || clickY < channelTop - margin) return ClickKind.STATUS
        }

        return ClickKind.UNKNOWN
    }

    private fun sectionAnchorTop(
        nodes: List<AccessibilityNodeInfo>,
        kind: ClickKind,
    ): Int? {
        var bestNonClickable: Int? = null
        var bestAny: Int? = null
        for (node in nodes) {
            val text = WhatsAppScreenClassifier.nodeText(node)
            val id = node.viewIdResourceName
            if (WhatsAppGuardTerms.isUpdates(text, id)) continue
            val matches = when (kind) {
                ClickKind.STATUS -> WhatsAppGuardTerms.isStatus(text, id)
                ClickKind.CHANNEL -> WhatsAppGuardTerms.isChannel(text, id)
                ClickKind.UNKNOWN -> false
            }
            if (!matches) continue

            val bounds = Rect().also(node::getBoundsInScreen)
            if (bounds.isEmpty || bounds.top < 0) continue
            bestAny = minOfNullable(bestAny, bounds.top)
            if (!node.isClickable) bestNonClickable = minOfNullable(bestNonClickable, bounds.top)
        }
        return bestNonClickable ?: bestAny
    }

    private fun minOfNullable(current: Int?, value: Int): Int =
        if (current == null) value else minOf(current, value)

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

            // Newer WhatsApp builds often expose identifying text as a sibling
            // of the exact node that receives the click. Inspect only the
            // immediate card subtree so individual status/channel blocking can
            // see that local context without scanning unrelated rows.
            val card = source.parent
            addDescendants(card, 2)
            add(card?.parent)
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

    private fun dp(value: Int): Int =
        (value * service.resources.displayMetrics.density).toInt().coerceAtLeast(1)

    private enum class ClickKind { STATUS, CHANNEL, UNKNOWN }

    companion object {
        private const val WHATSAPP_PACKAGE = "com.whatsapp"
        private const val EJECT_DEBOUNCE_MS = 650L
        private const val BLOCKED_SCREEN_DELAY_MS = 90L
    }
}
