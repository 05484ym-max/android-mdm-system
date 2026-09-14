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
                WhatsAppScreen.CONTACT_PICKER -> maskContactPicker(nodes, root)
                WhatsAppScreen.UPDATES,
                WhatsAppScreen.UNKNOWN -> Unit
            }
        }

        // Do not rely only on the top-level screen classifier. WhatsApp changes
        // its accessibility hierarchy often, while the visible section labels
        // and resource ids remain useful signals. If a status/channel section
        // is present, block that section directly.
        if (policy.blockStatuses) {
            findBestSectionNode(nodes, WhatsAppGuardTerms::isStatus)?.let { blockNode(it) }
        }
        if (policy.blockChannels) {
            findBestSectionNode(nodes, WhatsAppGuardTerms::isChannel)?.let { blockNode(it) }
        }

        overlays.endFrame()
    }

    private fun maskChatList(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        val candidates = imageCandidates(nodes, 34, 78)
            .filter { it.top > screen.top + dp(64) && it.bottom < screen.bottom - dp(54) }
        val grouped = candidates.groupBy { it.centerX() / dp(18) }.maxByOrNull { it.value.size }?.value.orEmpty()
        if (grouped.size >= 2) {
            grouped.forEach { overlays.addMask(expand(it, dp(3), screen)) }
            return
        }
        val rtl = service.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
        val width = dp(68)
        val top = screen.top + dp(72)
        val bottom = screen.bottom - dp(64)
        overlays.addMask(if (rtl) Rect(screen.right - width, top, screen.right, bottom) else Rect(screen.left, top, screen.left + width, bottom))
    }

    private fun maskContactPicker(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        val candidates = imageCandidates(nodes, 34, 82)
            .filter { it.top > screen.top + dp(72) && it.bottom < screen.bottom - dp(36) }

        if (candidates.isNotEmpty()) {
            candidates.forEach { overlays.addMask(expand(it, dp(3), screen)) }
            return
        }

        // Fallback for WhatsApp builds that expose contact avatars as generic
        // non-image Views: cover only the avatar rail, not the contact text.
        val rtl = service.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
        val width = dp(72)
        val top = screen.top + dp(88)
        val bottom = screen.bottom - dp(40)
        overlays.addMask(
            if (rtl) Rect(screen.right - width, top, screen.right, bottom)
            else Rect(screen.left, top, screen.left + width, bottom),
        )
    }

    private fun maskChatHeader(nodes: List<AccessibilityNodeInfo>, root: AccessibilityNodeInfo) {
        val screen = rootBounds(root)
        val candidates = imageCandidates(nodes, 30, 72)
            .filter { it.top <= screen.top + dp(132) }
            .sortedByDescending { edgeScore(it, screen) }
        candidates.firstOrNull()?.let {
            overlays.addMask(expand(it, dp(4), screen)); return
        }

        // Conservative header-only fallback. This intentionally never reaches
        // message content, so photos sent in the conversation remain usable.
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

        // Contact-info pages may expose the large avatar as a generic View.
        // Keep the fallback limited to the upper centre area.
        val size = dp(132)
        val cx = screen.centerX()
        val top = screen.top + dp(72)
        overlays.addMask(clamp(Rect(cx - size / 2, top, cx + size / 2, top + size), screen))
    }

    private fun blockNode(node: AccessibilityNodeInfo) {
        val target = bestBlockingAncestor(node)
        val bounds = nodeBounds(target)
        if (bounds.isEmpty) return
        val clamped = clamp(bounds, boundsUnion())
        if (clamped.isEmpty) return
        overlays.addMask(clamped, touchable = true)
    }

    private fun bestBlockingAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo {
        var current = node
        var best = node
        repeat(4) {
            val parent = current.parent ?: return@repeat
            val r = nodeBounds(parent)
            // Prefer a row/section container. Avoid climbing into a near-full
            // screen root, which would block the whole WhatsApp Updates page.
            if (!r.isEmpty && r.width() >= dp(120) && r.height() in dp(36)..dp(260)) {
                best = parent
            }
            current = parent
        }
        return best
    }

    private fun findBestSectionNode(
        nodes: List<AccessibilityNodeInfo>,
        matcher: (String?, String?) -> Boolean,
    ): AccessibilityNodeInfo? {
        val candidates = nodes.filter { node ->
            matcher(WhatsAppScreenClassifier.nodeText(node), node.viewIdResourceName)
        }
        if (candidates.isEmpty()) return null

        return candidates.maxByOrNull { node ->
            val r = nodeBounds(node)
            var score = 0
            if (node.isClickable) score += 100
            if (node.isImportantForAccessibility) score += 30
            if (!r.isEmpty) score += 20
            if (r.height() in dp(24)..dp(180)) score += 10
            if (r.width() >= dp(120)) score += 10
            score
        }
    }

    private fun imageCandidates(nodes: List<AccessibilityNodeInfo>, minDp: Int, maxDp: Int): List<Rect> {
        val min = dp(minDp); val max = dp(maxDp)
        return nodes.mapNotNull { node ->
            val cls = node.className?.toString().orEmpty()
            val description = node.contentDescription?.toString().orEmpty()
            val id = node.viewIdResourceName.orEmpty()
            val looksLikeImage = cls.contains("Image", true) ||
                cls.endsWith("View") ||
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
}
