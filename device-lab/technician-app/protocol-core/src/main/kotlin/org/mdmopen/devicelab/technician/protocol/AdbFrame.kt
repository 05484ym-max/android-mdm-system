package org.mdmopen.devicelab.technician.protocol

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * ADB wire message header (24 bytes, little-endian): command, arg0, arg1, data_length,
 * data_crc32, magic(=command xor 0xFFFFFFFF). Verified against Google's own reference
 * implementation (openhtf's adb_message.py, struct format "<6I"): despite the name,
 * data_crc32 is NOT a real CRC32 - it's a plain sum of the payload bytes masked to 32 bits.
 * Getting this wrong (e.g. using a real CRC32 algorithm) would make every frame this app
 * sends rejected by a real adbd, so this is spelled out explicitly rather than assumed.
 */

private fun fourCc(a: Char, b: Char, c: Char, d: Char): Int =
    (a.code and 0xFF) or ((b.code and 0xFF) shl 8) or ((c.code and 0xFF) shl 16) or ((d.code and 0xFF) shl 24)

object AdbCommand {
    val SYNC = fourCc('S', 'Y', 'N', 'C')
    val CNXN = fourCc('C', 'N', 'X', 'N')
    val OPEN = fourCc('O', 'P', 'E', 'N')
    val OKAY = fourCc('O', 'K', 'A', 'Y')
    val CLSE = fourCc('C', 'L', 'S', 'E')
    val WRTE = fourCc('W', 'R', 'T', 'E')
    val AUTH = fourCc('A', 'U', 'T', 'H')
}

object AdbAuthType {
    const val TOKEN = 1
    const val SIGNATURE = 2
    const val RSAPUBLICKEY = 3
}

/** A_VERSION for the pre-features-negotiation handshake this client speaks. */
const val ADB_VERSION = 0x01000000
const val ADB_MAX_PAYLOAD = 256 * 1024
const val ADB_HEADER_SIZE = 24

private fun dataChecksum(data: ByteArray): Int {
    var sum = 0
    for (b in data) sum += (b.toInt() and 0xFF)
    return sum
}

/** A complete, checksum-valid ADB message ready to send or already received+validated. */
data class AdbFrame(
    val command: Int,
    val arg0: Int,
    val arg1: Int,
    val data: ByteArray = ByteArray(0)
) {
    /** 24-byte header followed by the payload, ready to hand to bulkTransfer(). */
    fun encode(): ByteArray {
        val header = ByteBuffer.allocate(ADB_HEADER_SIZE).order(ByteOrder.LITTLE_ENDIAN)
        header.putInt(command)
        header.putInt(arg0)
        header.putInt(arg1)
        header.putInt(data.size)
        header.putInt(dataChecksum(data))
        header.putInt(command.inv())
        return header.array() + data
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is AdbFrame) return false
        return command == other.command && arg0 == other.arg0 && arg1 == other.arg1 && data.contentEquals(other.data)
    }

    override fun hashCode(): Int = command * 31 + arg0 * 31 + arg1 * 31 + data.contentHashCode()
}

/** The 24-byte header only, before the payload has been read off the wire. */
data class AdbFrameHeader(val command: Int, val arg0: Int, val arg1: Int, val dataLength: Int, val dataCrc32: Int) {
    companion object {
        fun decode(headerBytes: ByteArray): AdbFrameHeader {
            require(headerBytes.size == ADB_HEADER_SIZE) {
                "ADB header must be exactly $ADB_HEADER_SIZE bytes, got ${headerBytes.size}"
            }
            val buf = ByteBuffer.wrap(headerBytes).order(ByteOrder.LITTLE_ENDIAN)
            val command = buf.int
            val arg0 = buf.int
            val arg1 = buf.int
            val dataLength = buf.int
            val dataCrc32 = buf.int
            val magic = buf.int
            require(magic == command.inv()) { "ADB frame magic mismatch: command=$command magic=$magic" }
            return AdbFrameHeader(command, arg0, arg1, dataLength, dataCrc32)
        }
    }

    /** Combines this header with its (already fully read) payload, validating the checksum. */
    fun withPayload(payload: ByteArray): AdbFrame {
        require(payload.size == dataLength) { "expected $dataLength payload bytes, got ${payload.size}" }
        val actual = dataChecksum(payload)
        require(actual == dataCrc32) { "ADB payload checksum mismatch: expected $dataCrc32 got $actual" }
        return AdbFrame(command, arg0, arg1, payload)
    }
}
