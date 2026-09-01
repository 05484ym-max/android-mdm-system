package org.mdmopen.devicelab.technician.net

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Technician auth token storage. Deliberately NOT the same secret as LAB_ADMIN_KEY: that key
 * grants full admin-panel access (create/approve flash profiles, link MDM devices) and must
 * never be embedded in an APK that leaves the office. This class only stores whatever
 * short-lived technician token the backend issues after a real login - the backend-side
 * technician-auth endpoint itself is out of scope for this MVP pass (see report) and must be
 * built before this app talks to anything beyond localhost/dev.
 *
 * Encrypts the token at rest with an AndroidKeyStore-backed AES-256-GCM key (hardware-backed
 * where available) before writing it to SharedPreferences, rather than adding an external
 * androidx.security:security-crypto dependency this sandbox has no way to verify resolves.
 */
class TechnicianAuth(context: Context) {
    private val prefs = context.getSharedPreferences("technician_auth", Context.MODE_PRIVATE)

    fun getToken(): String? {
        val ivB64 = prefs.getString(KEY_IV, null) ?: return null
        val cipherB64 = prefs.getString(KEY_TOKEN, null) ?: return null
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(ivB64, Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(cipherB64, Base64.NO_WRAP)), Charsets.UTF_8)
    }

    fun setToken(token: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(KEY_TOKEN, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    companion object {
        private const val PROVIDER = "AndroidKeyStore"
        private const val ALIAS = "device_lab_technician_token_key"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val KEY_IV = "iv"
        private const val KEY_TOKEN = "token"
    }
}
