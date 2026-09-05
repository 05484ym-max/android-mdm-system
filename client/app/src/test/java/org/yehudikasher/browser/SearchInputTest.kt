package org.yehudikasher.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchInputTest {

    @Test
    fun `hebrew words become strict safe search query`() {
        assertEquals(
            "https://safe.duckduckgo.com/?kp=1&kl=il-he&kc=-1&kac=-1&q=%D7%91%D7%A0%D7%A7+%D7%94%D7%A4%D7%95%D7%A2%D7%9C%D7%99%D7%9D",
            SearchInput.resolve("בנק הפועלים")
        )
    }

    @Test
    fun `bare domain becomes https url`() {
        assertEquals(
            "https://bankhapoalim.co.il",
            SearchInput.resolve("bankhapoalim.co.il")
        )
    }

    @Test
    fun `explicit https url is preserved`() {
        assertEquals(
            "https://www.bankhapoalim.co.il/foo?q=1",
            SearchInput.resolve("https://www.bankhapoalim.co.il/foo?q=1")
        )
    }

    @Test
    fun `empty input stays empty`() {
        assertEquals("", SearchInput.resolve("   "))
    }

    @Test
    fun `host detector rejects search text and accepts domain`() {
        assertFalse(SearchInput.looksLikeHost("בנק הפועלים"))
        assertFalse(SearchInput.looksLikeHost("bank hapoalim.co.il"))
        assertTrue(SearchInput.looksLikeHost("bankhapoalim.co.il"))
    }
}
