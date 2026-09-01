package org.mdmopen.devicelab.technician.protocol

/**
 * Minimal read-only fastboot USB protocol: plain ASCII command sent as one bulk-OUT packet
 * ("getvar:product"), plain 4-byte-prefixed ASCII responses read back over bulk-IN:
 *   OKAY<value>   - success, <value> is the final answer
 *   FAIL<reason>  - command failed
 *   INFO<message> - informational line, more packets follow, keep reading
 *   DATA<hex-size>- only relevant to transfers this app never performs (flashing/upload)
 * This app only ever sends "getvar:<name>" commands - never flash/erase/boot/reboot/unlock.
 */
object FastbootProtocol {
    fun getVarCommand(name: String): ByteArray = "getvar:$name".toByteArray(Charsets.US_ASCII)

    sealed class Response {
        data class Okay(val value: String) : Response()
        data class Fail(val reason: String) : Response()
        data class Info(val message: String) : Response()
        data class Data(val sizeHex: String) : Response()
        data class Malformed(val raw: String) : Response()
    }

    fun parseResponse(bytes: ByteArray): Response {
        val text = String(bytes, Charsets.US_ASCII)
        return when {
            text.startsWith("OKAY") -> Response.Okay(text.removePrefix("OKAY"))
            text.startsWith("FAIL") -> Response.Fail(text.removePrefix("FAIL"))
            text.startsWith("INFO") -> Response.Info(text.removePrefix("INFO"))
            text.startsWith("DATA") -> Response.Data(text.removePrefix("DATA"))
            else -> Response.Malformed(text)
        }
    }

    /** True if [response] means "keep reading, more packets are coming" (only INFO does). */
    fun isContinuation(response: Response): Boolean = response is Response.Info
}
