package org.mdmopen.dpc

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import kotlin.math.abs

class WhatsAppGuardEngine(
    private val service: AccessibilityService,
    private val overlays: WhatsAppOverlayController,
) {
    private val statusWords = listOf("סטטוס", "status")
    private val channelWords = listOf("ערוצים", "channels", "channel")
    private val updatesWords = listOf("עדכונים", "updates")

    fun render(root: AccessibilityNodeInfo?, policy: WhatsAppGuardPolicy) {
        if (root == null || !policy.enabled) {
            overlays.clear()
            return
        }

        overlays.beginFrame()
        val screen = WhatsAppScreenClassifier.classify(root)
        val nodes = WhatsAppScreenClassifier.flatten(root)

        if (policy.hideProfilePhotos) {
            when (screen) {
                WhatsAppScreen.CHAT_LIST -> maskChatList(nodes, root)
                WhatsAppScreen.CHAT -> maskChatHeader(nodes, root)
                WhatsAppScreen.CONTACT_INFO -> maskContactInfo(nodes, root)
                else -> Unit
            }
        }

        if (policy.blockStatuses && policy.blockChannels) {
            findTextNode(nodes, updatesWords)?.let { blockNode(it, nodes, transparent = true) }
        } else {
            if (policy.blockStatuses) findTextNode(nodes, statusWords)?.let { blockNode(it, nodes, transparent = false) }
            if (policy.blockChannels) findTextNode(nodes, channelWords)?.let { blockNode(it, nodes, transparent = false) }
        }

        overlays.endFrame()
    }

    private fun maskChatList(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        val candidates = imageCandidates(nodes, 34, 78)
            .filter { it.top > screen.top + dp(64) && it.bottom < screen.bottom - dp(54) }
        val grouped = candidates.groupBy { it.centerX() / dp(18) }.maxByOrNull { it.value.size }?.value.orEmpty()
        if (grouped.size >= 2) {
            overlays.addMask(clamp(Rect(
                grouped.minOf { it.left } - dp(4),
                grouped.minOf { it.top } - dp(4),
                grouped.maxOf { it.right } + dp(4),
                grouped.maxOf { it.bottom } + dp(4),
            ), screen))
            return
        }
        val rtl = service.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
        val width = dp(68)
        val top = screen.top + dp(72)
        val bottom = screen.bottom - dp(64)
        overlays.addMask(if (rtl) Rect(screen.right - width, top, screen.right, bottom) else Rect(screen.left, top, screen.left + width, bottom))
    }

    private fun maskChatHeader(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        val candidates = imageCandidates(nodes, 30, 64)
            .filter { it.top <= screen.top + dp(116) }
            .sortedByDescending { edgeScore(it, screen) }
        candidates.firstOrNull()?.let {
            overlays.addMask(expand(it, dp(3), screen)); return
        }
        val rtl = service.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
        val size = dp(50)
        val top = screen.top + dp(28)
        val inset = dp(50)
        overlays.addMask(if (rtl) Rect(screen.right - inset - size, top, screen.right - inset, top + size) else Rect(screen.left + inset, top, screen.left + inset + size, top + size))
    }

    private fun maskContactInfo(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        imageCandidates(nodes, 80, 240)
            .filter { it.top < screen.top + screen.height() / 2 }
            .maxByOrNull { it.width() * it.height() }
            ?.let { overlays.addMask(expand(it, dp(4), screen)) }
    }

    private fun blockNode(node: AccessibilityNodeInfo, nodes: List<AccessibilityNodeInfo>, transparent: Boolean) {
        var target = node
        repeat(2) { target.parent?.let { target = it } }
        val bounds = nodeBounds(target)
        if (bounds.isEmpty) return
        val clamped = clamp(bounds, boundsUnion())
        if (transparent) overlays.addTransparentTouchBlocker(clamped) else overlays.addMask(clamped, touchable = true)
    }

    private fun findTextNode(nodes: List<AccessibilityNodeInfo>, words: List<String>): AccessibilityNodeInfo? =
        nodes.firstOrNull { node ->
            val text = WhatsAppScreenClassifier.nodeText(node)?.lowercase().orEmpty()
            words.any { text == it || text.contains(it) }
        }

    private fun imageCandidates(nodes: List<AccessibilityNodeInfo>, minDp: Int, maxDp: Int): List<Rect> {
        val min = dp(minDp); val max = dp(maxDp)
        return nodes.mapNotNull { node ->
            val cls = node.className?.toString().orEmpty()
            if (!cls.contains("Image", true) && !cls.endsWith("View")) return@mapNotNull null
            val r = nodeBounds(node)
            if (r.width() !in min..max || r.height() !in min..max) return@mapNotNull null
            if (abs(r.width() - r.height()) > dp(16)) return@mapNotNull null
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
}
