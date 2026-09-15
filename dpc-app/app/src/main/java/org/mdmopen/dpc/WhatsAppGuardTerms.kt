package org.mdmopen.dpc

/** Pure matching rules kept separate from Android Accessibility objects so the
 * language/view-id fallbacks can be unit tested without an emulator.
 *
 * These rules intentionally avoid broad substring matching. A channel name or
 * status caption may contain words such as "status" or "channel" as ordinary
 * text; that must never be enough to eject the user from WhatsApp.
 */
object WhatsAppGuardTerms {
    private val statusWords = setOf("סטטוס", "status", "statuses")
    private val channelWords = setOf("ערוץ", "ערוצים", "channel", "channels")
    private val updatesWords = setOf("עדכונים", "updates")

    private val channelContextWords = setOf(
        "עקוב", "עוקב", "עוקבים", "עקיבה",
        "follow", "following", "followers",
    )

    fun isStatus(text: String?, viewId: String?): Boolean =
        matchesLabel(text, statusWords) || hasIdToken(viewId, setOf("status"))

    fun isChannel(text: String?, viewId: String?): Boolean =
        matchesLabel(text, channelWords) || hasIdToken(viewId, setOf("channel"))

    fun isUpdates(text: String?, viewId: String?): Boolean =
        matchesLabel(text, updatesWords) || hasIdToken(viewId, setOf("update")) ||
            normalizedId(viewId).contains("status_tab")

    /** Extra local evidence that is characteristic of a channel card. */
    fun isChannelContext(text: String?): Boolean {
        val normalized = normalizeText(text)
        if (normalized.isEmpty()) return false
        return channelContextWords.any { word ->
            normalized == word ||
                normalized.startsWith("$word ") ||
                normalized.endsWith(" $word") ||
                normalized.contains(" $word ")
        }
    }

    private fun matchesLabel(text: String?, words: Set<String>): Boolean {
        val normalized = normalizeText(text)
        if (normalized.isEmpty()) return false
        return words.any { word ->
            normalized == word ||
                normalized == "$word:" ||
                normalized.startsWith("$word, ") ||
                normalized.startsWith("$word: ")
        }
    }

    private fun hasIdToken(viewId: String?, tokens: Set<String>): Boolean {
        val id = normalizedId(viewId)
        if (id.isEmpty()) return false
        val parts = id.split('_', '-', '.', '/', ':').filter(String::isNotBlank)
        return tokens.any(parts::contains)
    }

    private fun normalizedId(viewId: String?): String =
        viewId?.trim()?.lowercase().orEmpty()

    private fun normalizeText(text: String?): String =
        text
            ?.replace("\u200e", "")
            ?.replace("\u200f", "")
            ?.trim()
            ?.lowercase()
            ?.replace(Regex("\\s+"), " ")
            .orEmpty()
}
