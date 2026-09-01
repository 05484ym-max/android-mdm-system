package org.mdmopen.devicelab.technician.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FastbootProtocolTest {
    @Test
    fun `getVarCommand builds the plain getvar colon name form`() {
        assertEquals("getvar:product", String(FastbootProtocol.getVarCommand("product"), Charsets.US_ASCII))
    }

    @Test
    fun `parses OKAY response`() {
        val r = FastbootProtocol.parseResponse("OKAYa12nsxx".toByteArray())
        assertTrue(r is FastbootProtocol.Response.Okay)
        assertEquals("a12nsxx", r.value)
        assertFalse(FastbootProtocol.isContinuation(r))
    }

    @Test
    fun `parses FAIL response`() {
        val r = FastbootProtocol.parseResponse("FAILunknown variable".toByteArray())
        assertTrue(r is FastbootProtocol.Response.Fail)
        assertEquals("unknown variable", r.reason)
    }

    @Test
    fun `parses INFO response as a continuation`() {
        val r = FastbootProtocol.parseResponse("INFOsome status line".toByteArray())
        assertTrue(FastbootProtocol.isContinuation(r))
    }

    @Test
    fun `unrecognized prefix is Malformed, never silently treated as success`() {
        val r = FastbootProtocol.parseResponse("garbage".toByteArray())
        assertTrue(r is FastbootProtocol.Response.Malformed)
    }
}
