package org.mdmopen.devicelab.technician.protocol

import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.interfaces.RSAPublicKey
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AdbPublicKeyEncoderTest {
    private fun generate2048Key(): RSAPublicKey =
        KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.genKeyPair().public as RSAPublicKey

    @Test
    fun `struct has the exact documented mincrypt RSAPublicKey layout size`() {
        val pub = generate2048Key()
        val struct = AdbPublicKeyEncoder.encodeStruct(pub.modulus, pub.publicExponent)
        // 4 (words) + 4 (n0inv) + 256 (modulus) + 256 (rr) + 4 (exponent) = 524 bytes
        assertEquals(524, struct.size)
    }

    @Test
    fun `modulus_size_words field is 64 for a 2048-bit key`() {
        val pub = generate2048Key()
        val struct = AdbPublicKeyEncoder.encodeStruct(pub.modulus, pub.publicExponent)
        val words = (struct[0].toInt() and 0xFF) or ((struct[1].toInt() and 0xFF) shl 8) or
            ((struct[2].toInt() and 0xFF) shl 16) or ((struct[3].toInt() and 0xFF) shl 24)
        assertEquals(64, words)
    }

    @Test
    fun `n0inv satisfies its defining Montgomery identity, n times n0inv equals -1 mod 2^32`() {
        // This is the actual mathematical correctness proof for the trickiest field in the
        // struct: it does not depend on any adb reference implementation to check against.
        val pub = generate2048Key()
        val struct = AdbPublicKeyEncoder.encodeStruct(pub.modulus, pub.publicExponent)
        val n0invBytes = struct.copyOfRange(4, 8)
        val n0inv = (n0invBytes[0].toLong() and 0xFF) or ((n0invBytes[1].toLong() and 0xFF) shl 8) or
            ((n0invBytes[2].toLong() and 0xFF) shl 16) or ((n0invBytes[3].toLong() and 0xFF) shl 24)
        val r32 = BigInteger.ONE.shiftLeft(32)
        val n0 = pub.modulus.mod(r32)
        val product = n0.multiply(BigInteger.valueOf(n0inv)).mod(r32)
        assertEquals(r32.subtract(BigInteger.ONE), product) // n * n0inv == -1 (mod 2^32)
    }

    @Test
    fun `rr field equals R^2 mod n where R is 2^2048`() {
        val pub = generate2048Key()
        val struct = AdbPublicKeyEncoder.encodeStruct(pub.modulus, pub.publicExponent)
        val rrBytes = struct.copyOfRange(8 + 256, 8 + 256 + 256)
        val rrLittleEndian = rrBytes.reversedArray()
        val rr = BigInteger(1, rrLittleEndian)
        val r = BigInteger.ONE.shiftLeft(2048)
        assertEquals(r.modPow(BigInteger.TWO, pub.modulus), rr)
    }

    @Test
    fun `modulus field round trips back to the original modulus, little endian`() {
        val pub = generate2048Key()
        val struct = AdbPublicKeyEncoder.encodeStruct(pub.modulus, pub.publicExponent)
        val modulusBytes = struct.copyOfRange(8, 8 + 256)
        val roundTripped = BigInteger(1, modulusBytes.reversedArray())
        assertEquals(pub.modulus, roundTripped)
    }

    @Test
    fun `exponent field matches the public exponent`() {
        val pub = generate2048Key()
        val struct = AdbPublicKeyEncoder.encodeStruct(pub.modulus, pub.publicExponent)
        val expBytes = struct.copyOfRange(struct.size - 4, struct.size)
        val exponent = (expBytes[0].toLong() and 0xFF) or ((expBytes[1].toLong() and 0xFF) shl 8) or
            ((expBytes[2].toLong() and 0xFF) shl 16) or ((expBytes[3].toLong() and 0xFF) shl 24)
        assertEquals(pub.publicExponent.toLong(), exponent)
    }

    @Test
    fun `wire payload is valid base64 followed by a space, comment, and trailing NUL`() {
        val pub = generate2048Key()
        val wire = AdbPublicKeyEncoder.encodeWirePayload(pub.modulus, pub.publicExponent, "tech@device-lab")
        assertEquals(0, wire.last())
        val text = String(wire, 0, wire.size - 1, Charsets.US_ASCII)
        val parts = text.split(" ", limit = 2)
        assertEquals("tech@device-lab", parts[1])
        val decoded = Base64.getDecoder().decode(parts[0])
        assertEquals(524, decoded.size)
        assertTrue(decoded.contentEquals(AdbPublicKeyEncoder.encodeStruct(pub.modulus, pub.publicExponent)))
    }

    @Test
    fun `rejects a modulus that is not 2048 bits`() {
        val small = BigInteger.valueOf(65537)
        assertTrue(runCatching { AdbPublicKeyEncoder.encodeStruct(small, BigInteger.valueOf(65537)) }.isFailure)
    }
}
