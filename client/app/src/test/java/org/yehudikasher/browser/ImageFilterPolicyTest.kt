package org.yehudikasher.browser

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageFilterPolicyTest {

    @Test
    fun blockDecision_isHidden() {
        assertTrue(ImageFilterPolicy.shouldHide(FilterLevel.HAREDI_STRICT, RemoteDecision.BLOCK))
    }

    @Test
    fun errorDecision_isHidden() {
        assertTrue(ImageFilterPolicy.shouldHide(FilterLevel.HAREDI_STRICT, RemoteDecision.ERROR))
    }

    @Test
    fun allowDecision_isNotHidden_imageLoads() {
        assertFalse(ImageFilterPolicy.shouldHide(FilterLevel.HAREDI_STRICT, RemoteDecision.ALLOW))
    }

    @Test
    fun everyLevel_currentlyAppliesTheSameFailClosedRule() {
        for (level in FilterLevel.entries) {
            assertTrue(ImageFilterPolicy.shouldHide(level, RemoteDecision.BLOCK))
            assertTrue(ImageFilterPolicy.shouldHide(level, RemoteDecision.ERROR))
            assertFalse(ImageFilterPolicy.shouldHide(level, RemoteDecision.ALLOW))
        }
    }
}
