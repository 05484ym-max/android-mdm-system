package org.yehudikasher.browser

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageSchemeHardeningTest {

    @Test
    fun dataAndBlobImagesAreForbidden() {
        assertTrue(ImageSchemeHardening.isForbiddenImageUrl("data:image/png;base64,AAAA"))
        assertTrue(ImageSchemeHardening.isForbiddenImageUrl(" blob:https://example.com/id "))
    }

    @Test
    fun normalHttpsImageIsNotForbidden() {
        assertFalse(ImageSchemeHardening.isForbiddenImageUrl("https://example.com/photo.jpg"))
    }

    @Test
    fun caseIsNormalized() {
        assertTrue(ImageSchemeHardening.isForbiddenImageUrl("DATA:image/jpeg;base64,AAAA"))
        assertTrue(ImageSchemeHardening.isForbiddenImageUrl("BLOB:https://example.com/id"))
    }

    @Test
    fun emptyIsNotMistakenForInlineImage() {
        assertFalse(ImageSchemeHardening.isForbiddenImageUrl(null))
        assertFalse(ImageSchemeHardening.isForbiddenImageUrl(""))
    }
}
