package org.mdmopen.dpc

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

enum class WhatsAppScreen { CHAT_LIST, CHAT, UPDATES, CONTACT_INFO, UNKNOWN }

object WhatsAppScreenClassifier {
    private val updatesWords = setOf("עדכונים", "updates", "status", "סטטוס", "channels", "ערוצים")
    private val chatsWords = setOf("צ'אטים", "שיחות", "chats")
    private val infoWords = setOf("פרטי איש קשר", "contact info", "פרטי קבוצה", "group info")

    fun classify(root: AccessibilityNodeInfo?): WhatsAppScreen {
        if (root == null) return WhatsAppScreen.UNKNOWN
        val nodes = flatten(root)
        val texts = nodes.mapNotNull(::nodeText).map(String::lowercase)
        if (texts.any { text -> infoWords.any(text::contains) }) return WhatsAppScreen.CONTACT_INFO
        if (nodes.any(::isComposer)) return WhatsAppScreen.CHAT
        if (texts.any { text -> updatesWords.any { text == it || text.contains(it) } }) return WhatsAppScreen.UPDATES
        if (texts.any { text -> chatsWords.any { text == it || text.contains(it) } }) return WhatsAppScreen.CHAT_LIST
        val rowCount = nodes.count {
            val r = Rect(); it.getBoundsInScreen(r)
            it.isClickable && r.height() >= 44 && r.width() >= 180
        }
        return if (rowCount >= 4) WhatsAppScreen.CHAT_LIST else WhatsAppScreen.UNKNOWN
    }

    fun flatten(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
        val out = ArrayList<AccessibilityNodeInfo>(128)
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        while (stack.isNotEmpty() && out.size < 500) {
            val node = stack.removeLast(); out.add(node)
            for (i in 0 until node.childCount) node.getChild(i)?.let(stack::add)
        }
        return out
    }

    fun nodeText(node: AccessibilityNodeInfo): String? {
        val text = node.text?.toString()?.trim().orEmpty()
        if (text.isNotEmpty()) return text
        return node.contentDescription?.toString()?.trim()?.ifEmpty { null }
    }

    private fun isComposer(node: AccessibilityNodeInfo): Boolean {
        val cls = node.className?.toString().orEmpty()
        if (cls.contains("EditText", true) && node.isEditable) return true
        val hint = node.hintText?.toString()?.lowercase().orEmpty()
        return hint.contains("הודעה") || hint.contains("message")
    }
}
