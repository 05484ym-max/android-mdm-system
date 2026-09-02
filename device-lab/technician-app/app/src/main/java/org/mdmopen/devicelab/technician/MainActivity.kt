package org.mdmopen.devicelab.technician

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.usb.UsbManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.Space
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import org.mdmopen.devicelab.technician.adb.AdbHostConnection
import org.mdmopen.devicelab.technician.adb.KeystoreAdbAuthSigner
import org.mdmopen.devicelab.technician.fastboot.FastbootHostConnection
import org.mdmopen.devicelab.technician.net.DeviceLabApiClient
import org.mdmopen.devicelab.technician.net.TechnicianAuth
import org.mdmopen.devicelab.technician.protocol.ConnectionState
import org.mdmopen.devicelab.technician.protocol.DeviceEvidence
import org.mdmopen.devicelab.technician.protocol.DeviceProperties
import org.mdmopen.devicelab.technician.protocol.FastbootEvidence
import org.mdmopen.devicelab.technician.protocol.UsbEvidence
import org.mdmopen.devicelab.technician.protocol.UsbTransportGuess
import org.mdmopen.devicelab.technician.scan.ScanRepository
import org.mdmopen.devicelab.technician.usb.UsbTransportManager
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/**
 * RTL, Hebrew, single-screen MVP UI. Programmatic Views (no XML layouts / AppCompat), matching
 * the existing dpc-app module's own convention. Functionality first: this favors a simple,
 * always-correct polling loop over a more elaborate reactive USB event pipeline that could not
 * be tested here anyway.
 */
class MainActivity : Activity() {
    private lateinit var usbTransportManager: UsbTransportManager
    private lateinit var scanRepository: ScanRepository
    private lateinit var apiClient: DeviceLabApiClient
    private lateinit var stateLabel: TextView
    private lateinit var guidanceLabel: TextView
    private lateinit var resultArea: LinearLayout
    private val mainHandler = Handler(Looper.getMainLooper())
    private var polling = false
    private val ioExecutor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep startup resilient on OEM Android builds. A technician tool must never become
        // unusable because one optional UI/system-bar call or USB service init throws.
        try {
            usbTransportManager = UsbTransportManager(this)
            scanRepository = ScanRepository(this)
            // Base URL and technician login flow are out of scope for this MVP pass (see report);
            // a real deployment must not ship a hardcoded backend origin or a bearer token this
            // way. Wired to localhost only so the client compiles as a complete, callable unit.
            apiClient = DeviceLabApiClient("http://10.0.2.2:3100", TechnicianAuth(this))
        } catch (t: Throwable) {
            showStartupFallback("אתחול המערכת", t)
            return
        }

        try {
            window.statusBarColor = Color.parseColor("#F2F1E6")
            window.navigationBarColor = Color.parseColor("#F2F1E6")
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                window.insetsController?.setSystemBarsAppearance(
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                )
            }
        } catch (_: Throwable) {
            // Cosmetic only; never fail app startup because an OEM rejects a system-bar call.
        }

        try {
            setContentView(buildUi())
        } catch (t: Throwable) {
            showStartupFallback("בניית המסך", t)
            return
        }

        try {
            startPolling()
        } catch (_: Throwable) {
            stateLabel.text = "⚠ בדיקת USB לא הופעלה"
            guidanceLabel.text = "האפליקציה פתוחה. נסה לחבר מחדש את הכבל."
        }
    }

    private fun showStartupFallback(stage: String, error: Throwable) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(24), dp(40), dp(24), dp(24))
            setBackgroundColor(Color.parseColor("#F2F1E6"))
        }
        root.addView(TextView(this).apply {
            text = "מעבדת מכשירים"
            textSize = 28f
            setTextColor(Color.parseColor("#1C1C1C"))
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.END
        })
        root.addView(TextView(this).apply {
            text = "האפליקציה עלתה במצב בטוח"
            textSize = 18f
            setTextColor(Color.parseColor("#4B6B45"))
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.END
            setPadding(0, dp(24), 0, dp(8))
        })
        root.addView(TextView(this).apply {
            text = "תקלה בשלב: " + stage + "\n" + error.javaClass.simpleName + ": " + error.message.orEmpty()
            textSize = 14f
            setTextColor(Color.parseColor("#6B6B66"))
            gravity = Gravity.END
        })
        setContentView(root)
    }

    override fun onDestroy() {
        polling = false
        mainHandler.removeCallbacksAndMessages(null)
        ioExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun buildUi(): View {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(20), dp(26), dp(20), dp(28))
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.parseColor("#F2F1E6"), Color.parseColor("#E7ECDD"))
            )
        }

        val title = TextView(this).apply {
            text = "מעבדת מכשירים"
            textSize = 30f
            setTextColor(Color.parseColor("#1C1C1C"))
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.END
        }
        val subtitle = TextView(this).apply {
            text = "ניהול, בדיקה ואבחון מכשירי Android"
            textSize = 15f
            setTextColor(Color.parseColor("#8C8C86"))
            gravity = Gravity.END
            setPadding(0, dp(4), 0, dp(22))
        }
        page.addView(title)
        page.addView(subtitle)

        val hero = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(20), dp(20), dp(20), dp(20))
            background = roundedGradient("#FFFFFF", "#FFFFFF", 24f, "#EAE8DC")
        }

        stateLabel = TextView(this).apply {
            textSize = 23f
            setTextColor(Color.parseColor("#B3432C"))
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.END
        }
        guidanceLabel = TextView(this).apply {
            textSize = 15f
            setTextColor(Color.parseColor("#1C1C1C"))
            gravity = Gravity.END
            setPadding(0, dp(10), 0, dp(18))
        }
        hero.addView(stateLabel)
        hero.addView(guidanceLabel)

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            weightSum = 2f
        }
        val scanButton = Button(this).apply {
            text = "סרוק מכשיר"
            textSize = 17f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            isAllCaps = false
            background = roundedGradient("#4B6B45", "#4B6B45", 18f, "#4B6B45")
            setOnClickListener { onScanClicked() }
        }
        val connectButton = Button(this).apply {
            text = "חבר מכשיר"
            textSize = 17f
            setTextColor(Color.parseColor("#4B6B45"))
            setTypeface(typeface, Typeface.BOLD)
            isAllCaps = false
            background = roundedGradient("#FFFFFF", "#FFFFFF", 18f, "#4B6B45")
            setOnClickListener {
                Toast.makeText(this@MainActivity, "חבר כבל OTG/USB ואשר הרשאת USB", Toast.LENGTH_SHORT).show()
            }
        }
        actions.addView(connectButton, LinearLayout.LayoutParams(0, dp(58), 1f).apply { marginEnd = dp(8) })
        actions.addView(scanButton, LinearLayout.LayoutParams(0, dp(58), 1f).apply { marginStart = dp(8) })
        hero.addView(actions)
        page.addView(hero, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val modeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(18), 0, dp(8))
            weightSum = 2f
        }
        modeRow.addView(infoCard("חיבור USB", "חיבור קווי באמצעות USB", "USB"), LinearLayout.LayoutParams(0, dp(100), 1f).apply { marginEnd = dp(6) })
        modeRow.addView(infoCard("Wireless ADB", "חיבור אלחוטי למכשיר", "Wi-Fi"), LinearLayout.LayoutParams(0, dp(100), 1f).apply { marginStart = dp(6) })
        page.addView(modeRow)

        page.addView(sectionCard("אבחון", "הרצת בדיקות מערכת ואיתור תקלות", "⌕"))
        page.addView(sectionCard("תוצאות תאימות", "בדיקת תאימות מערכת ואפליקציות", "✓"))
        page.addView(sectionCard("פרטי מכשיר", "מידע מלא על חומרה, תוכנה וסטטוס", "ⓘ"))

        resultArea = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(0, dp(8), 0, dp(6))
        }
        page.addView(resultArea)

        val tip = TextView(this).apply {
            text = "טיפ חי  •  ודא שהאפשרות לניפוי USB מורשית במכשיר הנשלט"
            textSize = 14f
            setTextColor(Color.parseColor("#4B6B45"))
            gravity = Gravity.END
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = roundedGradient("#E7ECDD", "#E7ECDD", 18f, "#6B8A65")
        }
        page.addView(tip, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(8)
        })

        return ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.parseColor("#F2F1E6"))
            addView(page)
        }
    }

    private fun infoCard(title: String, subtitle: String, badge: String): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = roundedGradient("#FFFFFF", "#FFFFFF", 20f, "#EAE8DC")
            addView(TextView(this@MainActivity).apply {
                text = title
                textSize = 17f
                setTextColor(Color.parseColor("#1C1C1C"))
                setTypeface(typeface, Typeface.BOLD)
                gravity = Gravity.END
            })
            addView(TextView(this@MainActivity).apply {
                text = "$badge  •  $subtitle"
                textSize = 12f
                setTextColor(Color.parseColor("#8C8C86"))
                gravity = Gravity.END
                setPadding(0, dp(6), 0, 0)
            })
        }

    private fun sectionCard(title: String, subtitle: String, symbol: String): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            background = roundedGradient("#FFFFFF", "#FFFFFF", 20f, "#EAE8DC")
            addView(TextView(this@MainActivity).apply {
                text = "$symbol   $title"
                textSize = 18f
                setTextColor(Color.parseColor("#1C1C1C"))
                setTypeface(typeface, Typeface.BOLD)
                gravity = Gravity.END
            })
            addView(TextView(this@MainActivity).apply {
                text = subtitle
                textSize = 13f
                setTextColor(Color.parseColor("#8C8C86"))
                gravity = Gravity.END
                setPadding(0, dp(4), 0, 0)
            })
        }.also {
            (it as View).layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(10) }
        }

    private fun roundedGradient(start: String, end: String, radiusDp: Float, stroke: String): GradientDrawable =
        GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.parseColor(start), Color.parseColor(end))).apply {
            cornerRadius = dp(radiusDp.toInt()).toFloat()
            setStroke(dp(1), Color.parseColor(stroke))
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun startPolling() {
        polling = true
        val tick = object : Runnable {
            override fun run() {
                if (!polling) return
                try {
                    refreshState()
                } catch (e: Exception) {
                    // USB stacks on some OEM builds can throw while roles are
                    // changing or a cable is being attached/detached. Never let
                    // a transient USB enumeration failure crash the whole app.
                    stateLabel.text = "⚠ שגיאת USB זמנית"
                    guidanceLabel.text = "נתק וחבר את הכבל מחדש ואז נסה שוב."
                }
                mainHandler.postDelayed(this, 1500)
            }
        }
        mainHandler.post(tick)
    }

    private fun refreshState() {
        if (isFinishing || isDestroyed) return
        val devices = usbTransportManager.currentDevices()
        val single = devices.singleOrNull()
        val state = usbTransportManager.currentState()
        if (single != null && !usbTransportManager.hasPermission(single)) {
            stateLabel.text = "🟠 נדרשת הרשאת USB"
            guidanceLabel.text = "לחץ סרוק מכשיר ואשר את הרשאת ה-USB."
        } else if (single != null && usbTransportManager.hasPermission(single) &&
            usbTransportManager.classifyTransport(single) == UsbTransportGuess.ADB
        ) {
            stateLabel.text = "🟡 ADB זוהה"
            guidanceLabel.text = "לחץ סרוק מכשיר כדי לבצע אימות ADB וקריאת מידע."
        } else {
            stateLabel.text = statusLine(state)
            guidanceLabel.text = state.guidanceHe
        }
    }

    private fun statusLine(state: ConnectionState): String = when (state) {
        ConnectionState.NoDevice -> "● לא זוהה מכשיר"
        ConnectionState.MultipleDevices -> "⚠ כמה מכשירים מחוברים"
        ConnectionState.UsbOnly -> "🟠 USB מחובר ללא ADB"
        ConnectionState.UnknownUsbMode -> "⚠ מצב USB לא מוכר"
        ConnectionState.AdbUnauthorized -> "🟠 נדרש אישור USB Debugging"
        ConnectionState.AdbOffline -> "🟠 ADB לא מגיב"
        ConnectionState.AdbReady -> "✅ מוכן לסריקה"
        ConnectionState.WirelessAdbReady -> "✅ Wireless ADB מחובר"
        ConnectionState.FastbootReady -> "🟡 Fastboot"
        ConnectionState.RecoveryAdb -> "🟡 Recovery ADB"
        ConnectionState.SideloadAdb -> "🟡 Sideload ADB"
        else -> "⚠ מצב לא ידוע"
    }

    private fun onScanClicked() {
        val devices = try {
            usbTransportManager.currentDevices()
        } catch (e: Exception) {
            Toast.makeText(this, "לא ניתן לקרוא כרגע את חיבור ה-USB. נתק וחבר מחדש.", Toast.LENGTH_LONG).show()
            return
        }
        val device = devices.singleOrNull()
        if (device == null) {
            Toast.makeText(this, "חבר מכשיר יחיד לסריקה", Toast.LENGTH_SHORT).show()
            return
        }
        if (!usbTransportManager.hasPermission(device)) {
            usbTransportManager.requestPermission(device) { granted ->
                Toast.makeText(this, if (granted) "הרשאת USB אושרה - לחץ סרוק שוב" else "הרשאת USB נדחתה", Toast.LENGTH_SHORT).show()
            }
            return
        }

        stateLabel.text = "סורק מכשיר..."
        stateLabel.setTextColor(Color.parseColor("#4B6B45"))
        guidanceLabel.text = "קורא מידע מהמכשיר. אין לנתק את הכבל."
        ioExecutor.execute {
            // Real USB/ADB/Fastboot I/O throws constantly in the field - a cable pulled
            // mid-scan, a timeout, a malformed frame (AdbFrameHeader.decode()'s require()
            // calls). This runs on a background executor thread, so an exception that
            // escapes it is an UNCAUGHT exception on that thread - which crashes the whole
            // app by default, not just this one scan. Never let a bad scan take down the app.
            try {
                val usbManager = getSystemService(USB_SERVICE) as UsbManager
                val transport = usbTransportManager.classifyTransport(device)
                val evidence = when (transport) {
                    UsbTransportGuess.ADB -> scanViaAdb(usbManager, device)
                    UsbTransportGuess.FASTBOOT -> scanViaFastboot(usbManager, device)
                    else -> null
                }
                if (evidence == null) {
                    runOnUiThread {
                        Toast.makeText(this, "לא ניתן היה לסרוק את המכשיר במצב הנוכחי", Toast.LENGTH_SHORT).show()
                        refreshState()
                    }
                } else {
                    submitOrQueue(evidence)
                }
            } catch (t: Throwable) {
                runOnUiThread {
                    Toast.makeText(this, "הסריקה נכשלה: ${t.javaClass.simpleName}. נתק וחבר מחדש ונסה שוב.", Toast.LENGTH_LONG).show()
                    refreshState()
                }
            }
        }
    }

    private fun scanViaAdb(usbManager: UsbManager, device: android.hardware.usb.UsbDevice): DeviceEvidence? {
        val signer = KeystoreAdbAuthSigner.getOrCreate()
        val connection = AdbHostConnection.open(usbManager, device, signer) ?: return null
        connection.use {
            val handshake = it.handshake()
            if (handshake !is AdbHostConnection.HandshakeResult.Ready) return null

            fun getprop(name: String) = it.shell("getprop $name")?.trim()?.takeIf { v -> v.isNotEmpty() }
            val props = DeviceProperties(
                manufacturer = getprop("ro.product.manufacturer"), brand = getprop("ro.product.brand"),
                model = getprop("ro.product.model"), product = getprop("ro.product.name"),
                device = getprop("ro.product.device"), board = getprop("ro.product.board"),
                hardware = getprop("ro.hardware"), platform = getprop("ro.board.platform"),
                cpuAbi = getprop("ro.product.cpu.abi"), androidVersion = getprop("ro.build.version.release"),
                apiLevel = getprop("ro.build.version.sdk"), buildFingerprint = getprop("ro.build.fingerprint"),
                buildId = getprop("ro.build.id"), buildIncremental = getprop("ro.build.version.incremental"),
                securityPatch = getprop("ro.build.version.security_patch"), bootloader = getprop("ro.bootloader"),
                verifiedBootState = getprop("ro.boot.verifiedbootstate"), flashLocked = getprop("ro.boot.flash.locked"),
                slotSuffix = getprop("ro.boot.slot_suffix"), dynamicPartitions = getprop("ro.boot.dynamic_partitions")
            )
            val ownersRaw = it.shell("dpm list owners")
            return DeviceEvidence(
                capturedAt = isoNow(),
                properties = props,
                deviceOwner = ownersRaw,
                usb = UsbEvidence(
                    vid = String.format("%04x", device.vendorId), pid = String.format("%04x", device.productId)
                )
            )
        }
    }

    private fun scanViaFastboot(usbManager: UsbManager, device: android.hardware.usb.UsbDevice): DeviceEvidence? {
        val connection = FastbootHostConnection.open(usbManager, device) ?: return null
        connection.use {
            val fastboot = FastbootEvidence(
                product = it.getVar("product"), unlocked = it.getVar("unlocked"),
                secure = it.getVar("secure"), currentSlot = it.getVar("current-slot")
            )
            return DeviceEvidence(
                capturedAt = isoNow(),
                fastboot = fastboot,
                usb = UsbEvidence(
                    vid = String.format("%04x", device.vendorId), pid = String.format("%04x", device.productId)
                )
            )
        }
    }

    /** Called on ioExecutor only: local file I/O + network I/O never block the UI thread. */
    private fun submitOrQueue(evidence: DeviceEvidence) {
        val evidenceJson = apiClient.evidenceToJson(evidence)
        val entry = scanRepository.saveOffline(evidence, evidenceJson)
        val result = apiClient.submitScan(evidence)

        runOnUiThread {
            when (result) {
                is DeviceLabApiClient.Result.Success -> {
                    scanRepository.markSynced(entry.localId, result.scanId, result.bodyJson.optJSONObject("decision"))
                    renderResult(result.bodyJson)
                }
                is DeviceLabApiClient.Result.HttpError -> {
                    Toast.makeText(this, "השרת דחה את הסריקה (${result.status})", Toast.LENGTH_LONG).show()
                }
                is DeviceLabApiClient.Result.NetworkError -> {
                    Toast.makeText(this, "אין חיבור - הסריקה נשמרה מקומית וממתינה לסנכרון", Toast.LENGTH_LONG).show()
                }
            }
            refreshState()
        }
    }

    private fun renderResult(bodyJson: JSONObject) {
        resultArea.removeAllViews()
        val decision = bodyJson.optJSONObject("decision")
        val status = decision?.optString("status") ?: "UNKNOWN_BUILD"
        val confidence = decision?.optString("confidence") ?: "LOW"
        val line = TextView(this).apply {
            text = "${statusBadge(status)}   •   רמת ודאות: $confidence"
            textSize = 17f
            setTextColor(Color.parseColor("#4B6B45"))
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.END
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = roundedGradient("#E7ECDD", "#E7ECDD", 18f, "#4B6B45")
        }
        resultArea.addView(line)
    }

    private fun statusBadge(status: String): String = when (status) {
        "SUPPORTED_NO_FLASH" -> "✅ מוכן ל-MDM"
        "SUPPORTED_NEEDS_PROVISIONING" -> "🟠 דורש Provisioning"
        "SUPPORTED_NEEDS_FLASH" -> "🟡 דורש צריבה"
        "UNKNOWN_BUILD" -> "⚠ ROM לא מוכר"
        "FLASH_BLOCKED", "UNSUPPORTED" -> "⛔ לא לצרוב כרגע"
        else -> "⚠ לא ידוע"
    }

    private fun isoNow(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())
}
