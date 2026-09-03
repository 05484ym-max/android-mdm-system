package org.yehudikasher.browser

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Only exercises placeholderImageSvg() - the pure string builder - not
 * placeholderImage()/empty(), which construct a real android.webkit.
 * WebResourceResponse and so need a real Android runtime (this module has
 * no Robolectric dependency, consistent with every other test in it). */
class BlockedResponseTest {

    @Test
    fun placeholderSvg_containsTheRequiredUserFacingMessage_andNothingTechnical() {
        val svg = BlockedResponse.placeholderImageSvg()

        assertTrue(svg.contains("התמונה הוסתרה לפי מדיניות הסינון"))
        // Never leak a reason code, a host, or any other technical detail
        // into what the customer actually sees.
        assertFalse(svg.contains("BLOCK"))
        assertFalse(svg.contains("ERROR"))
        assertFalse(svg.contains("reason"))
    }

    @Test
    fun placeholderSvg_isWellFormedSvgMarkup() {
        val svg = BlockedResponse.placeholderImageSvg()
        assertTrue(svg.trim().startsWith("<svg"))
        assertTrue(svg.trim().endsWith("</svg>"))
    }
}
