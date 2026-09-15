package org.mdmopen.dpc

/** Pure matching rules kept separate from Android Accessibility objects so the
 * language/view-id fallbacks can be unit tested without an emulator.
 *
 * These rules intentionally avoid broad substring matching. A channel name or
 * status caption may contain words such as "status" or "channel" as ordinary
 * text; that must never be enough to eject the user from WhatsApp.
 * View-id fallback uses exact structural idTokens, never substring matching.
 */
object WhatsAppGuardTerms {
    private val statusWords = setOf("סטטוס", "status", "statuses")
    private val channelWords = setOf("ערוץ", "ערוצים", "channel", "channels")
    private val updatesWords = setOf("עדכונים", "updates")

    private val statusStructuralIds = setOf(
        "status_header", "status_section", "status_list", "status_item", "status_row", "status_ring",
    )
    private val channelStructuralIds = setOf(
        "channel_header", "channel_section", "channel_list", "channel_card", "channel_item", "channel_row",
    )
    private val updatesStructuralIds = setOf(
        "updates_tab", "update_tab", "status_tab",
    )

    private val channelContextWords = setOf(
        "עקוב", "עוקב", "עוקבים", "עקיבה", "במעקב",
        "follow", "following", "followers",
    )

    private val statusContextPrefixes = setOf(
        "עדכון סטטוס", "הסטטוס שלי", "סטטוס חדש",
        "status update", "my status", "new status",
    )

    fun isStatus(text: String?, viewId: String?): Boolean =
        matchesLabel(text, statusWords) || matchesStructuralId(viewId, statusStructuralIds)

    fun isChannel(text: String?, viewId: String?): Boolean =
        matchesLabel(text, channelWords) || matchesStructuralId(viewId, channelStructuralIds)

    fun isUpdates(text: String?, viewId: String?): Boolean =
        matchesLabel(text, updatesWords) || matchesStructuralId(viewId, updatesStructuralIds)

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

    fun isStatusContext(text: String?): Boolean {
        val normalized = normalizeText(text)
        if (normalized.isEmpty()) return false
        return statusContextPrefixes.any { prefix ->
            normalized == prefix || normalized.startsWith("$prefix ") || normalized.startsWith("$prefix,")
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

    private fun matchesStructuralId(viewId: String?, allowed: Set<String>): Boolean {
        val idName = normalizedId(viewId).substringAfterLast('/').substringAfterLast(':')
        return idName in allowed
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
