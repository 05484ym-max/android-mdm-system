package org.mdmopen.dpc

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsAppGuardTermsRegressionTest {
    @Test fun channelContextRecognizesNewWhatsAppHebrewFollowing() {
        assertTrue(WhatsAppGuardTerms.isChannelContext("במעקב"))
        assertTrue(WhatsAppGuardTerms.isChannelContext("123 עוקבים"))
    }

    @Test fun statusContextRecognizesStatusCardDescriptions() {
        assertTrue(WhatsAppGuardTerms.isStatusContext("עדכון סטטוס מאת יוסי"))
        assertTrue(WhatsAppGuardTerms.isStatusContext("Status update from Joe"))
        assertTrue(WhatsAppGuardTerms.isStatusContext("הסטטוס שלי"))
    }

    @Test fun ordinaryChatTextDoesNotBecomeContext() {
        assertFalse(WhatsAppGuardTerms.isStatusContext("דיברנו על סטטוס אתמול"))
        assertFalse(WhatsAppGuardTerms.isChannelContext("ערוץ הספורט"))
    }
}
