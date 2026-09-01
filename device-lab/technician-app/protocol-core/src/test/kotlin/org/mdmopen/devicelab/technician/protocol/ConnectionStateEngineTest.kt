package org.mdmopen.devicelab.technician.protocol

import kotlin.test.Test
import kotlin.test.assertEquals

class ConnectionStateEngineTest {
    private fun snapshot(
        count: Int = 1,
        granted: Boolean = true,
        guess: UsbTransportGuess? = UsbTransportGuess.ADB,
        handshake: AdbHandshakeResult = AdbHandshakeResult.NOT_ATTEMPTED,
        wireless: Boolean = false,
        recovery: Boolean = false,
        sideload: Boolean = false
    ) = UsbSnapshot(count, granted, guess, handshake, wireless, recovery, sideload)

    @Test
    fun `no device attached and no wireless session`() {
        assertEquals(ConnectionState.NoDevice, ConnectionStateEngine.classify(snapshot(count = 0)))
    }

    @Test
    fun `wireless adb already connected with nothing on usb`() {
        assertEquals(ConnectionState.WirelessAdbReady, ConnectionStateEngine.classify(snapshot(count = 0, wireless = true)))
    }

    @Test
    fun `more than one usb device is ambiguous, refuse to guess`() {
        assertEquals(ConnectionState.MultipleDevices, ConnectionStateEngine.classify(snapshot(count = 2)))
    }

    @Test
    fun `permission not yet granted shows usb-only guidance regardless of transport guess`() {
        assertEquals(ConnectionState.UsbOnly, ConnectionStateEngine.classify(snapshot(granted = false, guess = UsbTransportGuess.ADB)))
    }

    @Test
    fun `fastboot interface detected`() {
        assertEquals(ConnectionState.FastbootReady, ConnectionStateEngine.classify(snapshot(guess = UsbTransportGuess.FASTBOOT)))
    }

    @Test
    fun `adb interface present but handshake not yet attempted reads as usb-only`() {
        assertEquals(ConnectionState.UsbOnly, ConnectionStateEngine.classify(snapshot(guess = UsbTransportGuess.ADB, handshake = AdbHandshakeResult.NOT_ATTEMPTED)))
    }

    @Test
    fun `adb handshake ready`() {
        assertEquals(ConnectionState.AdbReady, ConnectionStateEngine.classify(snapshot(handshake = AdbHandshakeResult.READY)))
    }

    @Test
    fun `adb handshake unauthorized`() {
        assertEquals(ConnectionState.AdbUnauthorized, ConnectionStateEngine.classify(snapshot(handshake = AdbHandshakeResult.UNAUTHORIZED)))
    }

    @Test
    fun `adb handshake offline`() {
        assertEquals(ConnectionState.AdbOffline, ConnectionStateEngine.classify(snapshot(handshake = AdbHandshakeResult.OFFLINE)))
    }

    @Test
    fun `unrecognized usb interface shape`() {
        assertEquals(ConnectionState.UnknownUsbMode, ConnectionStateEngine.classify(snapshot(guess = UsbTransportGuess.USB_ONLY_UNKNOWN)))
    }

    @Test
    fun `null transport guess with permission granted still falls back to usb-only, never a guessed ready state`() {
        assertEquals(ConnectionState.UsbOnly, ConnectionStateEngine.classify(snapshot(guess = null)))
    }

    @Test
    fun `recovery adb takes priority once permission is granted`() {
        assertEquals(ConnectionState.RecoveryAdb, ConnectionStateEngine.classify(snapshot(recovery = true)))
    }

    @Test
    fun `sideload adb takes priority once permission is granted`() {
        assertEquals(ConnectionState.SideloadAdb, ConnectionStateEngine.classify(snapshot(sideload = true)))
    }

    @Test
    fun `multiple devices wins even over an existing wireless session`() {
        assertEquals(ConnectionState.MultipleDevices, ConnectionStateEngine.classify(snapshot(count = 2, wireless = true)))
    }
}
