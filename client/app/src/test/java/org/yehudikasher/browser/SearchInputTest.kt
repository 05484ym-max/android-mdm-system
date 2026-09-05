package org.yehudikasher.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchInputTest {

    @Test
    fun `hebrew words become strict safe search query`() {
        assertEquals(
            "https://duckduckgo.com/?kp=1&kl=il-he&kc=-1&kac=-1&q=%D7%91%D7%A0%D7%A7+%D7%94%D7%A4%D7%95%D7%A2%D7%9C%D7%99%D7%9D",
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
    fun `bare domain with path becomes https url`() {
        assertEquals(
            "https://bankhapoalim.co.il/he/account",
            SearchInput.resolve("bankhapoalim.co.il/he/account")
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
    fun `explicit http is preserved for UrlPolicy to reject`() {
        assertEquals(
            "http://bankhapoalim.co.il",
            SearchInput.resolve("http://bankhapoalim.co.il")
        )
    }

    @Test
    fun `empty input stays empty`() {
        assertEquals("", SearchInput.resolve("   "))
    }

    @Test
    fun `web address detector rejects search text and accepts domain paths`() {
        assertFalse(SearchInput.looksLikeWebAddress("בנק הפועלים"))
        assertFalse(SearchInput.looksLikeWebAddress("bank hapoalim.co.il"))
        assertTrue(SearchInput.looksLikeWebAddress("bankhapoalim.co.il"))
        assertTrue(SearchInput.looksLikeWebAddress("bankhapoalim.co.il/he/account"))
    }
}
