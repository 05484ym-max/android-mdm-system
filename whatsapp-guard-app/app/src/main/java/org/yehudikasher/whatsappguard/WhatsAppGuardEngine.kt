package org.yehudikasher.whatsappguard

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import kotlin.math.abs

class WhatsAppGuardEngine(
    private val service: AccessibilityService,
    private val overlays: OverlayController,
) {
    private val statusWords = listOf("סטטוס", "status")
    private val channelWords = listOf("ערוצים", "channels", "channel")
    private val updatesWords = listOf("עדכונים", "updates")

    fun render(root: AccessibilityNodeInfo?, policy: GuardPolicy) {
        overlays.clear()
        if (root == null) return
        val screen = WhatsAppScreenClassifier.classify(root)
        val nodes = WhatsAppScreenClassifier.flatten(root)

        if (policy.hideProfilePhotos) {
            when (screen) {
                WhatsAppScreen.CHAT_LIST -> maskChatListAvatars(nodes, root)
                WhatsAppScreen.CHAT -> maskChatHeaderAvatar(nodes, root)
                WhatsAppScreen.CONTACT_INFO -> maskContactInfoAvatar(nodes, root)
                else -> Unit
            }
        }

        when {
            policy.blockStatuses && policy.blockChannels -> blockWholeUpdatesEntry(nodes)
            else -> {
                if (policy.blockStatuses) blockSection(nodes, statusWords)
                if (policy.blockChannels) blockSection(nodes, channelWords)
            }
        }
    }

    private fun maskChatListAvatars(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        val candidates = imageCandidates(nodes, minDp = 34, maxDp = 78)
            .filter { it.top > screen.top + dp(70) && it.bottom < screen.bottom - dp(60) }
        val clustered = candidates.groupBy { it.centerX() / dp(16) }
            .maxByOrNull { it.value.size }
            ?.value
            .orEmpty()
            .filter { candidates.size < 3 || true }

        if (clustered.size >= 2) {
            val left = clustered.minOf { it.left } - dp(4)
            val right = clustered.maxOf { it.right } + dp(4)
            val top = clustered.minOf { it.top } - dp(6)
            val bottom = clustered.maxOf { it.bottom } + dp(6)
            overlays.addMask(clamp(Rect(left, top, right, bottom), screen))
            return
        }

        // Fallback for WhatsApp builds that do not expose ImageView nodes.
        // In RTL the avatar rail is on the right, in LTR on the left.
        val rtl = service.resources.configuration.layoutDirection == android.view.View.LAYOUT_DIRECTION_RTL
        val width = dp(66)
        val top = screen.top + dp(72)
        val bottom = screen.bottom - dp(66)
        val bounds = if (rtl) {
            Rect(screen.right - width, top, screen.right, bottom)
        } else {
            Rect(screen.left, top, screen.left + width, bottom)
        }
        overlays.addMask(bounds)
    }

    private fun maskChatHeaderAvatar(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        val candidates = imageCandidates(nodes, minDp = 30, maxDp = 62)
            .filter { it.top <= screen.top + dp(110) }
            .sortedByDescending { edgeScore(it, screen) }
        val chosen = candidates.firstOrNull()
        if (chosen != null) {
            overlays.addMask(expand(chosen, dp(3), screen), radiusLikeCircle = true)
            return
        }

        val rtl = service.resources.configuration.layoutDirection == android.view.View.LAYOUT_DIRECTION_RTL
        val size = dp(48)
        val top = screen.top + dp(30)
        val horizontalInset = dp(52)
        val bounds = if (rtl) {
            Rect(screen.right - horizontalInset - size, top, screen.right - horizontalInset, top + size)
        } else {
            Rect(screen.left + horizontalInset, top, screen.left + horizontalInset + size, top + size)
        }
        overlays.addMask(bounds)
    }

    private fun maskContactInfoAvatar(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        val candidates = imageCandidates(nodes, minDp = 80, maxDp = 220)
            .filter { it.top < screen.top + screen.height() / 2 }
            .sortedByDescending { it.width() * it.height() }
        candidates.firstOrNull()?.let { overlays.addMask(expand(it, dp(4), screen), radiusLikeCircle = true) }
    }

    private fun blockWholeUpdatesEntry(nodes: List<AccessibilityNodeInfo>) {
        val node = findTextNode(nodes, updatesWords) ?: return
        val bounds = nodeBounds(node)
        if (!bounds.isEmpty) overlays.addTouchBlocker(expand(bounds, dp(10), boundsUnion(nodes)))
    }

    private fun blockSection(nodes: List<AccessibilityNodeInfo>, words: List<String>) {
        val node = findTextNode(nodes, words) ?: return
        val screen = boundsUnion(nodes)
        var section: AccessibilityNodeInfo = node
        repeat(2) {
            val p = section.parent
            if (p != null) section = p
        }
        val bounds = nodeBounds(section)
        if (!bounds.isEmpty) overlays.addSectionBlock(clamp(bounds, screen))
    }

    private fun findTextNode(nodes: List<AccessibilityNodeInfo>, words: List<String>): AccessibilityNodeInfo? {
        return nodes.firstOrNull { node ->
            val text = WhatsAppScreenClassifier.nodeText(node)?.lowercase().orEmpty()
            words.any { text == it || text.contains(it) }
        }
    }

    private fun imageCandidates(nodes: List<AccessibilityNodeInfo>, minDp: Int, maxDp: Int): List<Rect> {
        val min = dp(minDp)
        val max = dp(maxDp)
        return nodes.mapNotNull { node ->
            val cls = node.className?.toString().orEmpty()
            if (!cls.contains("Image", ignoreCase = true) && !cls.endsWith("View")) return@mapNotNull null
            val r = nodeBounds(node)
            if (r.width() !in min..max || r.height() !in min..max) return@mapNotNull null
            if (abs(r.width() - r.height()) > dp(16)) return@mapNotNull null
            r
        }.distinctBy { listOf(it.left / 3, it.top / 3, it.right / 3, it.bottom / 3) }
    }

    private fun edgeScore(r: Rect, screen: Rect): Int =
        maxOf(abs(r.centerX() - screen.left), abs(screen.right - r.centerX()))

    private fun rootBounds(root: AccessibilityNodeInfo): Rect = nodeBounds(root).let {
        if (!it.isEmpty) it else Rect(0, 0, service.resources.displayMetrics.widthPixels, service.resources.displayMetrics.heightPixels)
    }

    private fun boundsUnion(nodes: List<AccessibilityNodeInfo>): Rect {
        val result = Rect(0, 0, service.resources.displayMetrics.widthPixels, service.resources.displayMetrics.heightPixels)
        return result
    }

    private fun nodeBounds(node: AccessibilityNodeInfo): Rect = Rect().also(node::getBoundsInScreen)

    private fun expand(r: Rect, amount: Int, limit: Rect): Rect =
        clamp(Rect(r.left - amount, r.top - amount, r.right + amount, r.bottom + amount), limit)

    private fun clamp(r: Rect, limit: Rect): Rect = Rect(
        r.left.coerceAtLeast(limit.left),
        r.top.coerceAtLeast(limit.top),
        r.right.coerceAtMost(limit.right),
        r.bottom.coerceAtMost(limit.bottom),
    )

    private fun dp(value: Int): Int = (value * service.resources.displayMetrics.density).toInt()
}
