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

            // Partial blocking must never make the Updates navigation item itself look
            // like content from the final section in the screen tree.
            if (signals.any { (text, id) -> WhatsAppGuardTerms.isUpdates(text, id) }) return false

            // Primary classifier: rebuild a short-lived snapshot of the visible clickable
            // rows and assign every row to the Status or Channels section from its exact
            // structural child path between the two section headers. The clicked source is
            // first promoted to its real row/container, so a child icon or title inherits
            // the section of its row instead of being guessed from pixels or keywords.
            when (classifyByVisibleRowSnapshot(event)) {
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

            // Secondary classifier: strong evidence from the clicked card only. This is
            // intentionally local; text elsewhere on Updates must not classify this row.
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

            // Geometry is never allowed to decide a partial Status-vs-Channel policy.
            // If the structure is ambiguous we fail open for that row instead of blocking
            // an allowed item. Geometry remains only as a last resort when both areas are
            // blocked, where confusing one blocked area with the other cannot open content.
            if (policy.blockStatuses && policy.blockChannels) {
                when (classifyBySectionGeometry(event)) {
                    ClickKind.STATUS -> return ejectBack(WhatsAppBlockedActivity.KIND_STATUS)
                    ClickKind.CHANNEL -> return ejectBack(WhatsAppBlockedActivity.KIND_CHANNEL)
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

    private fun classifyByVisibleRowSnapshot(event: AccessibilityEvent): ClickKind {
        val root = service.rootInActiveWindow ?: return ClickKind.UNKNOWN
        if (root.packageName?.toString() != WHATSAPP_PACKAGE) return ClickKind.UNKNOWN
        val source = event.source ?: return ClickKind.UNKNOWN

        val traversal = collectTraversal(root)
        if (traversal.isEmpty()) return ClickKind.UNKNOWN

        val statusHeader = findSectionHeader(traversal, ClickKind.STATUS)
        val channelHeader = findSectionHeader(traversal, ClickKind.CHANNEL)
        if (statusHeader == null && channelHeader == null) return ClickKind.UNKNOWN

        val row = findClickedRow(source) ?: return ClickKind.UNKNOWN
        val rowPath = traversal.firstOrNull { it.node == row }?.path ?: return ClickKind.UNKNOWN

        val snapshot = buildVisibleRowSnapshot(traversal, statusHeader, channelHeader)
        return snapshot.firstOrNull { samePath(it.path, rowPath) }?.kind ?: ClickKind.UNKNOWN
    }

    private fun buildVisibleRowSnapshot(
        traversal: List<PathNode>,
        statusHeader: PathNode?,
        channelHeader: PathNode?,
    ): List<RowSection> {
        val rows = traversal.filter { isLikelyClickableRow(it.node) }
        if (rows.isEmpty()) return emptyList()

        // The normal WhatsApp Updates structure is Status -> Channels. If both headers
        // are present but the structural order disagrees, do not manufacture a mapping.
        if (statusHeader != null && channelHeader != null &&
            comparePaths(statusHeader.path, channelHeader.path) >= 0
        ) {
            return emptyList()
        }

        return rows.mapNotNull { row ->
            val kind = when {
                statusHeader != null && channelHeader != null &&
                    comparePaths(row.path, statusHeader.path) > 0 &&
                    comparePaths(row.path, channelHeader.path) < 0 -> ClickKind.STATUS

                channelHeader != null && comparePaths(row.path, channelHeader.path) > 0 ->
                    ClickKind.CHANNEL

                else -> ClickKind.UNKNOWN
            }
            if (kind == ClickKind.UNKNOWN) null else RowSection(row.path, kind)
        }
    }

    private fun collectTraversal(root: AccessibilityNodeInfo): List<PathNode> {
        val out = ArrayList<PathNode>(160)

        fun walk(node: AccessibilityNodeInfo, path: IntArray) {
            if (out.size >= MAX_TREE_NODES) return
            out += PathNode(node, path)
            for (index in 0 until node.childCount) {
                val child = node.getChild(index) ?: continue
                walk(child, path + index)
                if (out.size >= MAX_TREE_NODES) return
            }
        }

        walk(root, intArrayOf())
        return out
    }

    private fun findSectionHeader(
        traversal: List<PathNode>,
        kind: ClickKind,
    ): PathNode? {
        var firstAny: PathNode? = null
        for (entry in traversal) {
            val node = entry.node
            val text = WhatsAppScreenClassifier.nodeText(node)
            val id = node.viewIdResourceName
            if (WhatsAppGuardTerms.isUpdates(text, id)) continue
            val matches = when (kind) {
                ClickKind.STATUS -> WhatsAppGuardTerms.isStatus(text, id)
                ClickKind.CHANNEL -> WhatsAppGuardTerms.isChannel(text, id)
                ClickKind.UNKNOWN -> false
            }
            if (!matches) continue
            if (firstAny == null) firstAny = entry
            if (!node.isClickable) return entry
        }
        return firstAny
    }

    private fun findClickedRow(source: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = source
        var depth = 0
        var largeFallback: AccessibilityNodeInfo? = null
        while (current != null && depth < MAX_SOURCE_ANCESTORS) {
            val bounds = Rect().also(current::getBoundsInScreen)
            if (!bounds.isEmpty && bounds.width() >= dp(MIN_ROW_WIDTH_DP) &&
                bounds.height() >= dp(MIN_ROW_HEIGHT_DP)
            ) {
                if (largeFallback == null) largeFallback = current
                if (current.isClickable) return current
            }
            current = current.parent
            depth++
        }
        return largeFallback
    }

    private fun isLikelyClickableRow(node: AccessibilityNodeInfo): Boolean {
        if (!node.isClickable) return false
        val bounds = Rect().also(node::getBoundsInScreen)
        return !bounds.isEmpty &&
            bounds.width() >= dp(MIN_ROW_WIDTH_DP) &&
            bounds.height() >= dp(MIN_ROW_HEIGHT_DP)
    }

    private fun comparePaths(left: IntArray, right: IntArray): Int {
        val common = minOf(left.size, right.size)
        for (index in 0 until common) {
            if (left[index] != right[index]) return left[index].compareTo(right[index])
        }
        return left.size.compareTo(right.size)
    }

    private fun samePath(left: IntArray, right: IntArray): Boolean = left.contentEquals(right)

    private fun classifyByTreeSection(event: AccessibilityEvent): ClickKind =
        classifyByVisibleRowSnapshot(event)

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

    private data class PathNode(
        val node: AccessibilityNodeInfo,
        val path: IntArray,
    )

    private data class RowSection(
        val path: IntArray,
        val kind: ClickKind,
    )

    private enum class ClickKind { STATUS, CHANNEL, UNKNOWN }

    companion object {
        private const val WHATSAPP_PACKAGE = "com.whatsapp"
        private const val EJECT_DEBOUNCE_MS = 650L
        private const val BLOCKED_SCREEN_DELAY_MS = 90L
        private const val MAX_SOURCE_ANCESTORS = 12
        private const val MAX_TREE_NODES = 500
        private const val MIN_ROW_WIDTH_DP = 120
        private const val MIN_ROW_HEIGHT_DP = 36
    }
}
