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

        if (event.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED) {
            val signals = clickSignals(event)

            // The bottom navigation Updates tab must always stay reachable for a partial
            // policy. It can appear after the Channels section in traversal order, so
            // exclude it before any section classifier runs.
            if (signals.any { (text, id) -> WhatsAppGuardTerms.isUpdates(text, id) }) return false

            // Primary classifier: use the Accessibility tree order between the actual
            // Status and Channels section headings. This is independent of screen Y,
            // row height, font scaling and the distance between the first channel and
            // the status area. Once a click is structurally inside a known section,
            // that answer is authoritative even when the opposite section is blocked.
            when (classifyByTreeSection(event)) {
                ClickKind.STATUS -> {
                    return if (policy.blockStatuses) {
                        ejectBack(WhatsAppBlockedActivity.KIND_STATUS)
                    } else {
                        false
                    }
                }
                ClickKind.CHANNEL -> {
                    return if (policy.blockChannels) {
                        ejectBack(WhatsAppBlockedActivity.KIND_CHANNEL)
                    } else {
                        false
                    }
                }
                ClickKind.UNKNOWN -> Unit
            }

            // Secondary classifier: use only the clicked card's local accessibility
            // context. This handles WhatsApp layouts where one of the section headings
            // is not exposed to Accessibility at all.
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
            }

            // Last-resort fallback for unusual WhatsApp builds whose accessibility tree
            // does not expose stable sibling order. Geometry is deliberately last so a
            // channel adjacent to the Status block cannot be misclassified merely by Y.
            when (classifyBySectionGeometry(event)) {
                ClickKind.STATUS -> if (policy.blockStatuses) {
                    return ejectBack(WhatsAppBlockedActivity.KIND_STATUS)
                }
                ClickKind.CHANNEL -> if (policy.blockChannels) {
                    return ejectBack(WhatsAppBlockedActivity.KIND_CHANNEL)
                }
                ClickKind.UNKNOWN -> Unit
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
                WhatsAppMaskCalibrationStore.get(service, target)?.let { calibration ->
                    overlays.addMask(calibration.toScreenRect(displayBounds()))
                }
            }
        }

        // Status/Channels intentionally have no overlay fallback. They are enforced by
        // click ejection only, so a classification miss fails open instead of covering
        // unrelated WhatsApp content with a stale mask.
        overlays.endFrame()
    }

    private fun classifyByTreeSection(event: AccessibilityEvent): ClickKind {
        val root = service.rootInActiveWindow ?: return ClickKind.UNKNOWN
        if (root.packageName?.toString() != WHATSAPP_PACKAGE) return ClickKind.UNKNOWN
        val source = event.source ?: return ClickKind.UNKNOWN

        val nodes = WhatsAppScreenClassifier.flatten(root)
        if (nodes.isEmpty()) return ClickKind.UNKNOWN

        val channelIndex = sectionAnchorIndex(nodes, ClickKind.CHANNEL)
        val statusIndex = sectionAnchorIndex(nodes, ClickKind.STATUS, beforeIndex = channelIndex)
        if (channelIndex == null && statusIndex == null) return ClickKind.UNKNOWN

        val sourceIndex = sourceTreeIndex(nodes, source) ?: return ClickKind.UNKNOWN

        // In WhatsApp Updates the sections are exposed in document/tree order:
        // Status heading + status rows, then Channels heading + channel rows. We classify
        // by that structural boundary instead of pixel coordinates or the channel name.
        if (channelIndex != null && sourceIndex > channelIndex) return ClickKind.CHANNEL
        if (statusIndex != null && sourceIndex > statusIndex &&
            (channelIndex == null || sourceIndex < channelIndex)
        ) {
            return ClickKind.STATUS
        }
        return ClickKind.UNKNOWN
    }

    private fun sectionAnchorIndex(
        nodes: List<AccessibilityNodeInfo>,
        kind: ClickKind,
        beforeIndex: Int? = null,
    ): Int? {
        var firstAny: Int? = null
        for ((index, node) in nodes.withIndex()) {
            if (beforeIndex != null && index >= beforeIndex) break
            val text = WhatsAppScreenClassifier.nodeText(node)
            val id = node.viewIdResourceName
            if (WhatsAppGuardTerms.isUpdates(text, id)) continue
            val matches = when (kind) {
                ClickKind.STATUS -> WhatsAppGuardTerms.isStatus(text, id)
                ClickKind.CHANNEL -> WhatsAppGuardTerms.isChannel(text, id)
                ClickKind.UNKNOWN -> false
            }
            if (!matches) continue
            if (firstAny == null) firstAny = index
            // Section headings are normally non-clickable. Prefer them over cards whose
            // content happens to contain the same word.
            if (!node.isClickable) return index
        }
        return firstAny
    }

    private fun sourceTreeIndex(
        nodes: List<AccessibilityNodeInfo>,
        source: AccessibilityNodeInfo,
    ): Int? {
        var current: AccessibilityNodeInfo? = source
        var depth = 0
        while (current != null && depth < MAX_SOURCE_ANCESTORS) {
            val index = nodes.indexOfFirst { it == current }
            if (index >= 0) return index
            current = current.parent
            depth++
        }
        return null
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

        if (channelTop != null && clickY > channelTop + margin) return ClickKind.CHANNEL

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
        private const val MAX_SOURCE_ANCESTORS = 12
    }
}
