package org.mdmopen.devicelab.technician.protocol

import java.security.KeyPairGenerator
import java.security.Signature
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertFailsWith

class AdbAuthSignerTest {
    @Test
    fun `manual DigestInfo prefix plus raw sign matches standard SHA1withRSA byte for byte`() {
        // This is the real correctness proof for the ADB auth quirk: if a manually-built
        // DigestInfo(SHA-1) prefix signed with raw ("NONEwithRSA") PKCS#1v1.5 padding does
        // NOT produce the exact same bytes as the JDK's own standard "SHA1withRSA" over the
        // same input, our understanding of the wire format is wrong. It does here.
        val keyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.genKeyPair()
        val message = "arbitrary-20-byte-tok".toByteArray().copyOf(20)

        val standard = Signature.getInstance("SHA1withRSA").apply {
            initSign(keyPair.private)
            update(message)
        }.sign()

        val prefixed = AdbTokenSigning.sha1DigestInfoPrefixed(message)
        val manual = Signature.getInstance("NONEwithRSA").apply {
            initSign(keyPair.private)
            update(prefixed)
        }.sign()

        assertContentEquals(standard, manual)
    }

    @Test
    fun `buildSignaturePayload rejects a token that is not exactly 20 bytes`() {
        assertFailsWith<IllegalArgumentException> { AdbTokenSigning.buildSignaturePayload(ByteArray(19)) }
        assertFailsWith<IllegalArgumentException> { AdbTokenSigning.buildSignaturePayload(ByteArray(21)) }
    }

    @Test
    fun `buildSignaturePayload and sha1DigestInfoPrefixed agree on the prefix bytes`() {
        val token = ByteArray(20) { it.toByte() }
        val fromToken = AdbTokenSigning.buildSignaturePayload(token)
        assertContentEquals(fromToken.copyOfRange(0, 15), AdbTokenSigning.sha1DigestInfoPrefixed(ByteArray(0)).copyOfRange(0, 15))
    }
}
