package org.mdmopen.devicelab.technician.adb

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.mdmopen.devicelab.technician.protocol.AdbAuthSigner
import org.mdmopen.devicelab.technician.protocol.AdbPublicKeyEncoder
import org.mdmopen.devicelab.technician.protocol.AdbTokenSigning
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.RSAPublicKey

/**
 * EXPERIMENTAL / UNVERIFIED IN THIS SANDBOX: this class has never run against real hardware
 * or a real adbd (no Android device, no emulator, no Android SDK available in this cloud
 * environment). The signing math it depends on (AdbTokenSigning's DigestInfo prefix) IS
 * verified in protocol-core's unit tests via a byte-for-byte cross-check against the JDK's
 * standard SHA1withRSA. What is NOT verified here is whether AndroidKeyStore's own
 * "NONEwithRSA" implementation behaves identically to the plain JCE provider used in that
 * test - Keystore-backed raw RSA signing has known provider-specific quirks on some OEM
 * skins, so this must be validated against a real device before being trusted.
 *
 * Generates a persistent 2048-bit RSA key in AndroidKeyStore (hardware-backed where
 * available) the first time it's needed, and reuses it afterwards so a technician does not
 * have to re-approve "Allow USB debugging" on every target device every single scan.
 */
class KeystoreAdbAuthSigner private constructor(private val publicKey: RSAPublicKey) : AdbAuthSigner {

    override fun signRawPkcs1(prefixedDigest: ByteArray): ByteArray {
        val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
        val privateKey = keyStore.getKey(ALIAS, null) as java.security.PrivateKey
        // NONEwithRSA: sign the bytes as-is (already DigestInfo(SHA-1)-prefixed by the
        // caller via AdbTokenSigning) with no further hashing - see class doc above.
        return Signature.getInstance("NONEwithRSA").apply {
            initSign(privateKey)
            update(prefixedDigest)
        }.sign()
    }

    override fun publicKeyBlob(): ByteArray =
        AdbPublicKeyEncoder.encodeWirePayload(publicKey.modulus, publicKey.publicExponent)

    companion object {
        private const val PROVIDER = "AndroidKeyStore"
        private const val ALIAS = "device_lab_technician_adb_auth_key"

        fun getOrCreate(): KeystoreAdbAuthSigner {
            val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
            val existing = keyStore.getCertificate(ALIAS)?.publicKey as? RSAPublicKey
            val publicKey = existing ?: generateKey()
            return KeystoreAdbAuthSigner(publicKey)
        }

        private fun generateKey(): RSAPublicKey {
            val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, PROVIDER)
            val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                .setKeySize(2048)
                .setDigests(KeyProperties.DIGEST_NONE) // required for raw ("NONEwithRSA") signing
                .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                .build()
            generator.initialize(spec)
            return generator.generateKeyPair().public as RSAPublicKey
        }
    }
}
