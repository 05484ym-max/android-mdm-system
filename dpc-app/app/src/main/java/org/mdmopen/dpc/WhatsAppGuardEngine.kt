package org.mdmopen.dpc

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlin.math.abs

class WhatsAppGuardEngine(
    private val service: AccessibilityService,
    private val overlays: WhatsAppOverlayController,
) {
    private var lastEjectAt = 0L
    private val mainHandler = Handler(Looper.getMainLooper())

    fun handleEvent(event: AccessibilityEvent?, policy: WhatsAppGuardPolicy): Boolean {
        if (event == null || !policy.enabled) return false

        // Status/Channel blocking is deliberately event-driven and target-specific.
        // WhatsApp often reports the clicked row/container rather than the child label,
        // so inspect only the clicked node's small local subtree and its own ancestors.
        // Never inspect the whole active window here: uncertain clicks must fail open.
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

        val screen = WhatsAppScreenClassifier.classify(root)
        overlays.beginFrame()
        val nodes = WhatsAppScreenClassifier.flatten(root)

        if (policy.hideProfilePhotos) {
            when (screen) {
                WhatsAppScreen.CHAT_LIST -> maskAvatarAreasPerChatRow(nodes, root)
                WhatsAppScreen.CHAT -> maskChatHeader(nodes, root)
                WhatsAppScreen.CONTACT_INFO -> maskContactInfo(nodes, root)
                WhatsAppScreen.CONTACT_PICKER -> maskAvatarAreasPerChatRow(nodes, root, picker = true)
                WhatsAppScreen.UPDATES,
                WhatsAppScreen.UNKNOWN -> Unit
            }
        }

        // Status/Channels intentionally have no overlay fallback. They are
        // handled only by target-specific click ejection above.
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

    /**
     * Hides the full avatar slot from the geometry of each verified chat/contact row.
     * The avatar image itself is never required as a signal, so a late-loaded image
     * cannot briefly defeat placement. All geometry is derived from the row bounds;
     * there are no fixed screen-edge coordinates or device-specific dimensions.
     *
     * Detection is intentionally conservative. A node must look like a repeated,
     * full-width row with textual descendants and must agree with the dominant row
     * height on the current screen. If confidence is insufficient we draw nothing
     * rather than cover unrelated WhatsApp controls.
     */
    private fun maskAvatarAreasPerChatRow(
        nodes: List<AccessibilityNodeInfo>,
        root: AccessibilityNodeInfo,
        picker: Boolean = false,
    ) {
        val screen = rootBounds(root)
        if (screen.width() <= 0 || screen.height() <= 0) return

        val raw = nodes.mapNotNull { node ->
            val bounds = nodeBounds(node)
            if (!looksLikeChatRow(node, bounds, screen, picker)) return@mapNotNull null
            RowCandidate(node, bounds, rowConfidence(node, bounds, screen))
        }
        if (raw.size < 2) return

        val deNested = raw.filter { candidate ->
            raw.none { other ->
                other !== candidate &&
                    other.bounds.top >= candidate.bounds.top &&
                    other.bounds.bottom <= candidate.bounds.bottom &&
                    other.bounds.height() < candidate.bounds.height() &&
                    verticalOverlapRatio(candidate.bounds, other.bounds) > 0.70f
            }
        }
        if (deNested.size < 2) return

        val heights = deNested.map { it.bounds.height() }.sorted()
        val medianHeight = heights[heights.size / 2]
        if (medianHeight <= 0) return
        val heightTolerance = (medianHeight * 0.24f).toInt().coerceAtLeast(1)

        val verified = deNested
            .filter { abs(it.bounds.height() - medianHeight) <= heightTolerance }
            .filter { it.confidence >= 0.72f }
            .sortedBy { it.bounds.top }
        if (verified.size < 2) return

        val rtl = service.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
        verified.forEach { row ->
            avatarRectForRow(row.bounds, screen, rtl)?.let(overlays::addMask)
        }
    }

    private data class RowCandidate(
        val node: AccessibilityNodeInfo,
        val bounds: Rect,
        val confidence: Float,
    )

    private fun looksLikeChatRow(
        node: AccessibilityNodeInfo,
        bounds: Rect,
        screen: Rect,
        picker: Boolean,
    ): Boolean {
        if (bounds.width() <= 0 || bounds.height() <= 0) return false

        val widthRatio = bounds.width().toFloat() / screen.width().toFloat()
        val heightRatio = bounds.height().toFloat() / screen.height().toFloat()
        val minHeightRatio = if (picker) 0.045f else 0.050f
        val maxHeightRatio = if (picker) 0.145f else 0.155f
        if (widthRatio < 0.70f || heightRatio !in minHeightRatio..maxHeightRatio) return false

        val centerRatio = (bounds.centerY() - screen.top).toFloat() / screen.height().toFloat()
        if (centerRatio < 0.10f || centerRatio > 0.93f) return false

        val textCount = descendantTextCount(node, depth = 3)
        if (textCount < 1) return false

        val cls = node.className?.toString().orEmpty()
        val id = node.viewIdResourceName.orEmpty()
        val containerSignal =
            node.childCount >= 2 ||
                cls.contains("Layout", ignoreCase = true) ||
                cls.contains("ViewGroup", ignoreCase = true) ||
                id.contains("row", ignoreCase = true) ||
                id.contains("cell", ignoreCase = true)
        return containerSignal
    }

    private fun rowConfidence(node: AccessibilityNodeInfo, bounds: Rect, screen: Rect): Float {
        var score = 0f
        val widthRatio = bounds.width().toFloat() / screen.width().toFloat()
        val textCount = descendantTextCount(node, depth = 3)
        val childCount = node.childCount
        val cls = node.className?.toString().orEmpty()
        val id = node.viewIdResourceName.orEmpty()

        if (widthRatio >= 0.85f) score += 0.30f else if (widthRatio >= 0.75f) score += 0.20f
        if (textCount >= 2) score += 0.30f else if (textCount == 1) score += 0.15f
        if (childCount >= 2) score += 0.15f
        if (cls.contains("Layout", true) || cls.contains("ViewGroup", true)) score += 0.10f
        if (id.contains("row", true) || id.contains("cell", true) || id.contains("item", true)) score += 0.10f

        val edgeSlack = screen.width() * 0.08f
        if (bounds.left <= screen.left + edgeSlack && bounds.right >= screen.right - edgeSlack) score += 0.10f
        return score.coerceAtMost(1f)
    }

    private fun descendantTextCount(node: AccessibilityNodeInfo, depth: Int): Int {
        if (depth < 0) return 0
        var count = 0
        val ownText = node.text?.toString().orEmpty()
        val ownDescription = node.contentDescription?.toString().orEmpty()
        if (ownText.isNotBlank() || ownDescription.isNotBlank()) count++
        if (depth == 0) return count
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            count += descendantTextCount(child, depth - 1)
            if (count >= 3) return count
        }
        return count
    }

    private fun avatarRectForRow(row: Rect, screen: Rect, rtl: Boolean): Rect? {
        val rowHeight = row.height()
        if (rowHeight <= 0) return null

        val avatarSize = (rowHeight * 0.72f).toInt().coerceAtLeast(1)
        val horizontalInset = (rowHeight * 0.10f).toInt().coerceAtLeast(1)
        val top = row.centerY() - avatarSize / 2
        val bottom = top + avatarSize

        val rect = if (rtl) {
            val right = row.right - horizontalInset
            Rect(right - avatarSize, top, right, bottom)
        } else {
            val left = row.left + horizontalInset
            Rect(left, top, left + avatarSize, bottom)
        }

        val clippedToRow = Rect(
            rect.left.coerceAtLeast(row.left),
            rect.top.coerceAtLeast(row.top),
            rect.right.coerceAtMost(row.right),
            rect.bottom.coerceAtMost(row.bottom),
        )
        val clipped = clamp(clippedToRow, screen)
        return clipped.takeIf { it.width() > 1 && it.height() > 1 }
    }

    private fun verticalOverlapRatio(a: Rect, b: Rect): Float {
        val overlap = (minOf(a.bottom, b.bottom) - maxOf(a.top, b.top)).coerceAtLeast(0)
        val smaller = minOf(a.height(), b.height()).coerceAtLeast(1)
        return overlap.toFloat() / smaller.toFloat()
    }

    private fun maskChatHeader(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        val candidates = imageCandidates(nodes, 30, 72)
            .filter { it.top <= screen.top + dp(132) }
            .sortedByDescending { edgeScore(it, screen) }
        candidates.firstOrNull()?.let {
            overlays.addMask(expand(it, dp(4), screen)); return
        }

        val rtl = service.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
        val size = dp(54)
        val top = screen.top + dp(24)
        val inset = dp(46)
        overlays.addMask(
            if (rtl) Rect(screen.right - inset - size, top, screen.right - inset, top + size)
            else Rect(screen.left + inset, top, screen.left + inset + size, top + size),
        )
    }

    private fun maskContactInfo(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        imageCandidates(nodes, 72, 260)
            .filter { it.top < screen.top + screen.height() / 2 }
            .maxByOrNull { it.width() * it.height() }
            ?.let { overlays.addMask(expand(it, dp(4), screen)); return }

        val size = dp(132)
        val cx = screen.centerX()
        val top = screen.top + dp(72)
        overlays.addMask(clamp(Rect(cx - size / 2, top, cx + size / 2, top + size), screen))
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
            // Blocking already succeeded through GLOBAL_ACTION_BACK. If Android refuses
            // the informational activity, never trap or suspend WhatsApp as a fallback.
        }
    }

    private fun imageCandidates(nodes: List<AccessibilityNodeInfo>, minDp: Int, maxDp: Int): List<Rect> {
        val min = dp(minDp); val max = dp(maxDp)
        return nodes.mapNotNull { node ->
            val cls = node.className?.toString().orEmpty()
            val description = node.contentDescription?.toString().orEmpty()
            val id = node.viewIdResourceName.orEmpty()
            val looksLikeImage = cls.contains("Image", true) ||
                description.contains("profile", true) ||
                description.contains("photo", true) ||
                description.contains("תמונת", true) ||
                id.contains("avatar", true) ||
                id.contains("profile", true)
            if (!looksLikeImage) return@mapNotNull null
            val r = nodeBounds(node)
            if (r.width() !in min..max || r.height() !in min..max) return@mapNotNull null
            if (abs(r.width() - r.height()) > dp(18)) return@mapNotNull null
            r
        }.distinctBy { listOf(it.left / 3, it.top / 3, it.right / 3, it.bottom / 3) }
    }

    private fun edgeScore(r: Rect, screen: Rect) = maxOf(abs(r.centerX() - screen.left), abs(screen.right - r.centerX()))
    private fun rootBounds(root: AccessibilityNodeInfo): Rect = nodeBounds(root).let { if (!it.isEmpty) it else boundsUnion() }
    private fun boundsUnion() = Rect(0, 0, service.resources.displayMetrics.widthPixels, service.resources.displayMetrics.heightPixels)
    private fun nodeBounds(node: AccessibilityNodeInfo) = Rect().also(node::getBoundsInScreen)
    private fun expand(r: Rect, amount: Int, limit: Rect) = clamp(Rect(r.left - amount, r.top - amount, r.right + amount, r.bottom + amount), limit)
    private fun clamp(r: Rect, limit: Rect) = Rect(r.left.coerceAtLeast(limit.left), r.top.coerceAtLeast(limit.top), r.right.coerceAtMost(limit.right), r.bottom.coerceAtMost(limit.bottom))
    private fun dp(value: Int) = (value * service.resources.displayMetrics.density).toInt().coerceAtLeast(1)

    companion object {
        private const val EJECT_DEBOUNCE_MS = 650L
        private const val BLOCKED_SCREEN_DELAY_MS = 90L
    }
}
