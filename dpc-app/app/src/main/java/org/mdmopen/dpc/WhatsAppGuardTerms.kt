package org.mdmopen.dpc

/** Pure matching rules kept separate from Android Accessibility objects so the
 * language/view-id fallbacks can be unit tested without an emulator. */
object WhatsAppGuardTerms {
    private val statusWords = setOf("סטטוס", "status", "statuses")
    private val channelWords = setOf("ערוץ", "ערוצים", "channel", "channels")
    private val updatesWords = setOf("עדכונים", "updates")

    fun isStatus(text: String?, viewId: String?): Boolean =
        matches(text, viewId, statusWords, setOf("status"))

    fun isChannel(text: String?, viewId: String?): Boolean =
        matches(text, viewId, channelWords, setOf("channel"))

    fun isUpdates(text: String?, viewId: String?): Boolean =
        matches(text, viewId, updatesWords, setOf("update", "status_tab"))

    private fun matches(
        text: String?,
        viewId: String?,
        words: Set<String>,
        idTokens: Set<String>,
    ): Boolean {
        val normalizedText = text?.trim()?.lowercase().orEmpty()
        if (normalizedText.isNotEmpty() && words.any { word ->
                normalizedText == word || normalizedText.contains(word)
            }) return true

        val id = viewId?.lowercase().orEmpty()
        if (id.isEmpty()) return false
        return idTokens.any(id::contains)
    }
}
