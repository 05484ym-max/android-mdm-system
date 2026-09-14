package org.mdmopen.dpc

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
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
            if (statusTarget) return ejectBack()

            val channelTarget = policy.blockChannels && signals.any { (text, id) ->
                !WhatsAppGuardTerms.isUpdates(text, id) && WhatsAppGuardTerms.isChannel(text, id)
            }
            if (channelTarget) return ejectBack()
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
                WhatsAppScreen.CHAT_LIST -> maskAvatarCuts(nodes, root)
                WhatsAppScreen.CHAT -> maskChatHeader(nodes, root)
                WhatsAppScreen.CONTACT_INFO -> maskContactInfo(nodes, root)
                WhatsAppScreen.CONTACT_PICKER -> maskAvatarCuts(nodes, root, picker = true)
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
     * Draw only narrow cuts inside avatar rectangles that WhatsApp itself exposes.
     * There is no continuous rail and no screen-edge guess, so text, whitespace and
     * unrelated controls remain untouched on different screen sizes. If we cannot
     * identify at least two aligned avatar candidates with confidence, draw nothing.
     */
    private fun maskAvatarCuts(
        nodes: List<AccessibilityNodeInfo>,
        root: AccessibilityNodeInfo,
        picker: Boolean = false,
    ) {
        val screen = rootBounds(root)
        val listTop = screen.top + dp(if (picker) 72 else 54)
        val listBottom = screen.bottom - dp(if (picker) 56 else 48)
        if (listBottom <= listTop) return

        val candidates = imageCandidates(nodes, 30, if (picker) 92 else 84)
            .filter { it.centerY() in listTop..listBottom }
            .filter { it.left >= screen.left && it.right <= screen.right }
        if (candidates.size < 2) return

        val rtl = service.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
        val outerHalf = candidates.filter {
            if (rtl) it.centerX() >= screen.centerX() else it.centerX() <= screen.centerX()
        }
        if (outerHalf.size < 2) return

        val anchor = if (rtl) outerHalf.maxByOrNull { it.centerX() } else outerHalf.minByOrNull { it.centerX() }
            ?: return
        val tolerance = maxOf(dp(14), anchor.width() / 3)
        val column = outerHalf
            .filter { abs(it.centerX() - anchor.centerX()) <= tolerance }
            .sortedBy { it.top }
        if (column.size < 2) return

        val medianWidth = column.map { it.width() }.sorted().let { it[it.size / 2] }
        val sizeTolerance = maxOf(dp(8), medianWidth / 4)
        val verified = column.filter { abs(it.width() - medianWidth) <= sizeTolerance }
        if (verified.size < 2) return

        verified.forEach { avatar ->
            val cutWidth = (avatar.width() * 0.34f).toInt().coerceIn(dp(10), dp(26))
            val verticalInset = (avatar.height() * 0.08f).toInt().coerceAtLeast(1)
            val top = (avatar.top + verticalInset).coerceAtLeast(listTop)
            val bottom = (avatar.bottom - verticalInset).coerceAtMost(listBottom)
            if (bottom <= top) return@forEach

            val cut = if (rtl) {
                Rect((avatar.right - cutWidth).coerceAtLeast(avatar.left), top, avatar.right, bottom)
            } else {
                Rect(avatar.left, top, (avatar.left + cutWidth).coerceAtMost(avatar.right), bottom)
            }
            overlays.addMask(clamp(cut, screen))
        }
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

    private fun ejectBack(): Boolean {
        val now = SystemClock.uptimeMillis()
        if (now - lastEjectAt < EJECT_DEBOUNCE_MS) return true
        lastEjectAt = now
        overlays.clear()
        return service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
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
    }
}
