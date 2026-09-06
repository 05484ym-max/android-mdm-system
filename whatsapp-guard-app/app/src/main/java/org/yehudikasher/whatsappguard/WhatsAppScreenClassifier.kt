package org.yehudikasher.whatsappguard

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

enum class WhatsAppScreen {
    CHAT_LIST,
    CHAT,
    UPDATES,
    CONTACT_INFO,
    UNKNOWN,
}

object WhatsAppScreenClassifier {
    private val updatesWords = setOf("עדכונים", "updates", "status", "סטטוס", "channels", "ערוצים")
    private val chatsWords = setOf("צ'אטים", "שיחות", "chats")
    private val infoWords = setOf("פרטי איש קשר", "contact info", "פרטי קבוצה", "group info")

    fun classify(root: AccessibilityNodeInfo?): WhatsAppScreen {
        if (root == null) return WhatsAppScreen.UNKNOWN
        val nodes = flatten(root)
        val texts = nodes.mapNotNull { nodeText(it) }.map { it.lowercase() }

        if (texts.any { text -> infoWords.any { text.contains(it) } }) {
            return WhatsAppScreen.CONTACT_INFO
        }
        if (texts.any { text -> updatesWords.any { text == it || text.contains(it) } }) {
            // Prefer CHAT when a composer is present: a conversation may contain
            // words such as "סטטוס" inside messages.
            if (nodes.any { isComposer(it) }) return WhatsAppScreen.CHAT
            return WhatsAppScreen.UPDATES
        }
        if (nodes.any { isComposer(it) }) return WhatsAppScreen.CHAT
        if (texts.any { text -> chatsWords.any { text == it || text.contains(it) } }) {
            return WhatsAppScreen.CHAT_LIST
        }

        // WhatsApp sometimes does not expose tab text. A list with many large
        // clickable rows and no text editor is a conservative chat-list fallback.
        val rowCount = nodes.count {
            val r = Rect()
            it.getBoundsInScreen(r)
            it.isClickable && r.height() >= 44 && r.width() >= 180
        }
        if (rowCount >= 4) return WhatsAppScreen.CHAT_LIST
        return WhatsAppScreen.UNKNOWN
    }

    fun flatten(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
        val out = ArrayList<AccessibilityNodeInfo>(128)
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        while (stack.isNotEmpty() && out.size < 400) {
            val node = stack.removeLast()
            out.add(node)
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let(stack::add)
            }
        }
        return out
    }

    fun nodeText(node: AccessibilityNodeInfo): String? {
        val t = node.text?.toString()?.trim().orEmpty()
        if (t.isNotEmpty()) return t
        val d = node.contentDescription?.toString()?.trim().orEmpty()
        return d.ifEmpty { null }
    }

    private fun isComposer(node: AccessibilityNodeInfo): Boolean {
        val className = node.className?.toString().orEmpty()
        if (className.contains("EditText", ignoreCase = true) && node.isEditable) return true
        val hint = node.hintText?.toString()?.lowercase().orEmpty()
        return hint.contains("הודעה") || hint.contains("message")
    }
}
