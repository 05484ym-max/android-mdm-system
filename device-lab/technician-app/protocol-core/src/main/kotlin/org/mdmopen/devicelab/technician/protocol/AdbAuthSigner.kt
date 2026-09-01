package org.mdmopen.devicelab.technician.protocol

import java.security.MessageDigest

/**
 * ADB's AUTH(TOKEN) step requires signing the 20-byte token adbd sends with RSA/PKCS#1v1.5,
 * but WITHOUT letting the signer hash the token again: adbd's token bytes are treated as an
 * already-computed SHA-1 digest, so the client must sign exactly
 * DigestInfo(SHA-1) || token
 * using raw ("NONEwithRSA") PKCS#1v1.5 padding - not the standard "SHA1withRSA" which would
 * hash the 20-byte token a second time and produce a signature adbd rejects.
 *
 * This interface exists so the Android app can plug in an AndroidKeyStore-backed
 * implementation (private key never leaves hardware-backed storage) while this module keeps
 * the digest-prefixing logic - the actual signing math - in one place that can be unit tested
 * on a plain JVM.
 */
interface AdbAuthSigner {
    /** RSA-PKCS1v1.5-signs [prefixedDigest] (already DigestInfo-prefixed) with no further hashing. */
    fun signRawPkcs1(prefixedDigest: ByteArray): ByteArray

    /** Mincrypt-format RSA public key blob (see [AdbPublicKeyEncoder]) matching this signer's key. */
    fun publicKeyBlob(): ByteArray
}

object AdbTokenSigning {
    // DER encoding of the SHA-1 DigestInfo AlgorithmIdentifier, per PKCS#1 v1.5 / RFC 3447
    // section 9.2, Note 1. This exact 15-byte prefix is what must precede the raw digest
    // before RSA signing - adbd's own auth.c prepends the identical bytes on its side.
    private val SHA1_DIGEST_INFO_PREFIX = byteArrayOf(
        0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b.toByte(), 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14
    )

    /** adbd sends a 20-byte token that IS the value to sign - it must not be re-hashed here. */
    fun buildSignaturePayload(token: ByteArray): ByteArray {
        require(token.size == 20) { "ADB auth token must be exactly 20 bytes (got ${token.size})" }
        return SHA1_DIGEST_INFO_PREFIX + token
    }

    /**
     * Reference/verification helper only (not used by the real signer): proves that
     * DigestInfo(SHA-1) || data, signed with raw PKCS#1v1.5 ("NONEwithRSA"), is
     * byte-for-byte identical to what java.security's own "SHA1withRSA" would produce for
     * the same [data] - i.e. the manual prefix above is the correct encoding, cross-checked
     * against the JDK's own standard-library implementation rather than trusted on its own.
     */
    fun sha1DigestInfoPrefixed(data: ByteArray): ByteArray {
        val digest = MessageDigest.getInstance("SHA-1").digest(data)
        return SHA1_DIGEST_INFO_PREFIX + digest
    }
}
