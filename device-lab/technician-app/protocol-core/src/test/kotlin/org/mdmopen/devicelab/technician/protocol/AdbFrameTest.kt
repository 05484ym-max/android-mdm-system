package org.mdmopen.devicelab.technician.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AdbFrameTest {
    @Test
    fun `command bytes spell literal ASCII on the wire`() {
        val encoded = AdbFrame(AdbCommand.CNXN, 0, 0).encode()
        assertEquals("CNXN", String(encoded.copyOfRange(0, 4), Charsets.US_ASCII))
    }

    @Test
    fun `magic is command xor 0xFFFFFFFF`() {
        val encoded = AdbFrame(AdbCommand.OPEN, 1, 0).encode()
        val commandBytes = encoded.copyOfRange(0, 4)
        val magicBytes = encoded.copyOfRange(20, 24)
        for (i in 0..3) assertEquals((commandBytes[i].toInt() xor 0xFF).toByte(), magicBytes[i])
    }

    @Test
    fun `checksum is a plain byte sum, not a real CRC32`() {
        val data = byteArrayOf(1, 2, 3, 4, 5)
        val frame = AdbFrame(AdbCommand.WRTE, 1, 2, data)
        val encoded = frame.encode()
        val checksumBytes = encoded.copyOfRange(16, 20)
        val checksum = (checksumBytes[0].toInt() and 0xFF) or
            ((checksumBytes[1].toInt() and 0xFF) shl 8) or
            ((checksumBytes[2].toInt() and 0xFF) shl 16) or
            ((checksumBytes[3].toInt() and 0xFF) shl 24)
        assertEquals(1 + 2 + 3 + 4 + 5, checksum)
    }

    @Test
    fun `header decode then payload attach round trips a full frame`() {
        val original = AdbFrame(AdbCommand.WRTE, 7, 9, "hello".toByteArray())
        val encoded = original.encode()
        val header = AdbFrameHeader.decode(encoded.copyOfRange(0, ADB_HEADER_SIZE))
        val payload = encoded.copyOfRange(ADB_HEADER_SIZE, encoded.size)
        val decoded = header.withPayload(payload)
        assertEquals(original, decoded)
    }

    @Test
    fun `corrupted magic is rejected`() {
        val encoded = AdbFrame(AdbCommand.OKAY, 0, 0).encode()
        encoded[20] = (encoded[20] + 1).toByte() // flip a magic byte
        assertFailsWith<IllegalArgumentException> { AdbFrameHeader.decode(encoded.copyOfRange(0, ADB_HEADER_SIZE)) }
    }

    @Test
    fun `corrupted payload checksum is rejected`() {
        val encoded = AdbFrame(AdbCommand.WRTE, 0, 0, "payload".toByteArray()).encode()
        val header = AdbFrameHeader.decode(encoded.copyOfRange(0, ADB_HEADER_SIZE))
        val tamperedPayload = "PAYLOAD".toByteArray() // same length, different bytes/checksum
        assertTrue(tamperedPayload.size == header.dataLength)
        assertFailsWith<IllegalArgumentException> { header.withPayload(tamperedPayload) }
    }
}
