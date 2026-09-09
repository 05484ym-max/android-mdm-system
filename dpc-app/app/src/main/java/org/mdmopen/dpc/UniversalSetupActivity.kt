package org.mdmopen.dpc

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * Guided, non-destructive setup surface for enrolled devices that are not
 * Device Owner. Requested protection remains server-owned; achieved protection
 * is recomputed from runtime capabilities every time this Activity resumes.
 */
class UniversalSetupActivity : Activity() {

    private lateinit var content: LinearLayout
    private var targetRefreshInFlight = false

    private val BG = "#F7F2E8"
    private val CARD = "#FFFDFC"
    private val CARD_SOFT = "#FBF8F0"
    private val BORDER = "#E8E1D4"
    private val TEXT = "#1C231D"
    private val MUTED = "#85867E"
    private val ACCENT = "#245E38"
    private val ACCENT_DARK = "#17472B"
    private val ACCENT_TINT = "#EEF2E1"
    private val GOLD = "#BFA15B"
    private val OK = "#2F7A48"

    private val heavyFont = Typeface.create("sans-serif-black", Typeface.NORMAL)
    private val mediumFont = Typeface.create("sans-serif-medium", Typeface.NORMAL)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Config.deviceToken(this) == null) {
            openAndFinish(MainActivity::class.java)
            return
        }
        if (PolicyEnforcer(this).isDeviceOwner()) {
            openAndFinish(CustomerActivity::class.java)
            return
        }

        setContentView(buildShell())
        refreshTargetAndRender()
    }

    override fun onResume() {
        super.onResume()
        if (::content.isInitialized && Config.deviceToken(this) != null) {
            RequestedProtectionStore.read(this)?.let { render(it) }
        }
    }

    private fun buildShell(): View {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setBackgroundColor(Color.parseColor(BG))
        }

        page.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(14), dp(18), dp(12))

            addView(ImageView(this@UniversalSetupActivity).apply {
                setImageResource(R.mipmap.ic_launcher)
                scaleType = ImageView.ScaleType.CENTER_CROP
            }, LinearLayout.LayoutParams(dp(38), dp(38)).apply { marginEnd = dp(10) })

            addView(TextView(this@UniversalSetupActivity).apply {
                text = "הגנת המכשיר"
                textSize = 20f
                typeface = heavyFont
                setTextColor(Color.parseColor(ACCENT_DARK))
                gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
            }, LinearLayout.LayoutParams(0, dp(48), 1f))
        })

        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(18), dp(4), dp(18), dp(28))
        }

        page.addView(ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
            addView(content)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        return page
    }

    private fun refreshTargetAndRender() {
        RequestedProtectionStore.read(this)?.let { render(it) } ?: renderLoading()
        if (targetRefreshInFlight) return

        val token = Config.deviceToken(this) ?: return
        val serverUrl = Config.serverUrl(this)
        val deviceId = Config.deviceId(this)
        targetRefreshInFlight = true

        Thread {
            try {
                val target = ApiClient(serverUrl, token).fetchProtectionTarget(deviceId)
                RequestedProtectionStore.save(applicationContext, target)
                runOnUiThread { render(target) }
            } catch (_: Exception) {
                runOnUiThread {
                    if (RequestedProtectionStore.read(this) == null) renderUnavailable()
                }
            } finally {
                targetRefreshInFlight = false
            }
        }.start()
    }

    private fun renderLoading() {
        content.removeAllViews()
        content.addView(statusHero("מעדכן את רמת ההגנה…", "מתבצע אימות מול השרת והמכשיר", false))
    }

    private fun renderUnavailable() {
        content.removeAllViews()
        content.addView(statusHero(
            "לא ניתן לטעון כרגע את יעד ההגנה",
            "המסלול הרגיל של המכשיר נשאר פעיל. אפשר לנסות שוב בלי לבצע איפוס או שינוי מערכת.",
            false,
        ))
        content.addView(primaryButton("נסה שוב") { refreshTargetAndRender() })
        content.addView(secondaryButton("המשך לאפליקציה") { openAndFinish(CustomerActivity::class.java) })
    }

    private fun render(target: RequestedProtectionTarget) {
        val profile = DeviceCapabilityDetector.detect(this)
        val adapter = DeviceAdapterResolver.resolve(profile)
        val plan = TargetedNonDoSetupPlanner.build(profile, adapter.adapterId, target.requestedProfile)
        val achieved = plan.achieved.achievedProfile
        val satisfied = profileRank(achieved) >= profileRank(plan.requestedProfile)
        val actionableStep = plan.steps.firstOrNull {
            it == NonDoSetupStep.SET_DEFAULT_HOME ||
                it == NonDoSetupStep.ENABLE_ACCESSIBILITY ||
                it == NonDoSetupStep.ACTIVATE_DEVICE_ADMIN
        }

        content.removeAllViews()
        content.addView(statusHero(
            if (satisfied) "ההגנה שנבחרה הושגה" else "נשארו שלבים להשלמת ההגנה",
            if (satisfied) {
                "הרמה שמוצגת כאן מבוססת על יכולות שנבדקו בפועל במכשיר."
            } else {
                "נמשיך רק בפעולות ידניות ובטוחות שהמכשיר באמת תומך בהן."
            },
            satisfied,
        ))

        content.addView(sectionTitle("מצב ההגנה"))
        content.addView(detailsCard(listOf(
            Triple("◎", "רמת יעד", profileLabel(plan.requestedProfile)),
            Triple("✓", "רמה שהושגה", profileLabel(achieved)),
            Triple("◈", "סוג מכשיר", adapterLabel(adapter.adapterId)),
        )))

        val missing = localMissing(plan)
        content.addView(sectionTitle("מה חסר כדי להגיע לרמה שנבחרה"))
        content.addView(detailsCard(
            if (missing.isEmpty()) {
                listOf(Triple("✓", "מצב", "לא חסרה יכולת מאומתת"))
            } else {
                missing.map { Triple("•", "נדרש", it) }
            }
        ))

        content.addView(sectionTitle("הנחיות למכשיר הזה"))
        content.addView(guidanceCard(adapter.adapterId, profile))

        when {
            actionableStep != null -> {
                content.addView(primaryButton("המשך") { launchStep(actionableStep, adapter.adapterId) })
            }
            plan.requiresReprovisioning -> {
                content.addView(infoCard(
                    "Device Owner דורש Provisioning מחדש",
                    "לא מתבצע כאן איפוס ולא Provisioning אוטומטי. זה נשאר מסלול טכנאי נפרד ומפורש.",
                ))
                content.addView(primaryButton("המשך לאפליקציה") { openAndFinish(CustomerActivity::class.java) })
            }
            plan.requiresSystemIntegration -> {
                content.addView(infoCard(
                    "נדרשת אינטגרציית מערכת אמיתית",
                    "לא מתבצעים root, פתיחת bootloader או flashing אוטומטי. SYSTEM_LEVEL יוצג רק לאחר PRIV_APP מאומת בפועל.",
                ))
                content.addView(primaryButton("המשך לאפליקציה") { openAndFinish(CustomerActivity::class.java) })
            }
            else -> {
                content.addView(primaryButton(if (satisfied) "המשך לאפליקציה" else "בדיקה מחדש") {
                    if (satisfied) {
                        openAndFinish(CustomerActivity::class.java)
                    } else {
                        refreshTargetAndRender()
                    }
                })
            }
        }
    }

    private fun launchStep(step: NonDoSetupStep, adapterId: String) {
        val intent = when (step) {
            NonDoSetupStep.OEM_BACKGROUND_SETUP ->
                OemSetupNavigator.firstResolvableIntent(this, adapterId)
            else -> NonDoSetupIntents.forStep(this, step)
        }
        if (intent == null || intent.resolveActivity(packageManager) == null) {
            Toast.makeText(this, "לא נמצאה הגדרה מתאימה במכשיר הזה", Toast.LENGTH_LONG).show()
            return
        }
        try {
            startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(this, "לא ניתן לפתוח את ההגדרה במכשיר הזה", Toast.LENGTH_LONG).show()
        }
    }

    private fun localMissing(plan: TargetedNonDoSetupPlan): List<String> {
        val missing = mutableListOf<String>()
        if (NonDoSetupStep.SET_DEFAULT_HOME in plan.steps) missing += "הגדרת יהודי כשר כאפליקציית הבית"
        if (NonDoSetupStep.ENABLE_ACCESSIBILITY in plan.steps) missing += "הפעלת נגישות עבור יהודי כשר — הגנת WhatsApp"
        if (NonDoSetupStep.ACTIVATE_DEVICE_ADMIN in plan.steps) missing += "הפעלת מנהל מכשיר"
        if (plan.requiresReprovisioning) missing += "Provisioning ידני ל־Device Owner"
        if (plan.requiresSystemIntegration) missing += "PRIV_APP מאומת דרך אינטגרציית מערכת"
        return missing
    }

    private fun guidanceCard(adapterId: String, profile: DeviceProfile): LinearLayout {
        val guidance = when {
            adapterId == "samsung.oneui" -> listOf(
                "ודאו שהאפליקציה נשארת ברירת המחדל למסך הבית.",
                "ודאו ששירות הנגישות נשאר פעיל גם לאחר אתחול.",
                "בדקו שהגבלות סוללה/רקע של One UI לא סוגרות את ההגנה.",
            )
            adapterId.startsWith("xiaomi.") -> listOf(
                "ודאו Autostart עבור יהודי כשר אם האפשרות קיימת.",
                "הסירו הגבלת סוללה שמפסיקה שירותי הגנה ברקע.",
                "בדקו שוב Home ונגישות לאחר אתחול.",
            )
            adapterId.startsWith("qin.") -> listOf(
                "זהות Qin מקבלת קדימות על זיהוי Xiaomi כשפרטי הדגם מצביעים על Qin.",
                "יש לאמת build/firmware מדויק לפני כל מסלול מתקדם יותר.",
                "אין להסיק root, bootloader פתוח או הרשאת מערכת רק משם הדגם.",
            )
            else -> listOf(
                "השלימו רק הגדרות Android שהמכשיר מציג בפועל.",
                "אין כאן פעולות אוטומטיות של root, flash, unlock או wipe.",
            )
        }
        return detailsCard(guidance.map { Triple("◈", "הנחיה", it) }).apply {
            addView(TextView(this@UniversalSetupActivity).apply {
                text = "${profile.model} · Android ${profile.androidRelease}"
                textSize = 11.5f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                setPadding(dp(6), dp(8), dp(6), dp(4))
            })
        }
    }

    private fun statusHero(title: String, subtitle: String, success: Boolean): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(if (success) ACCENT_TINT else CARD_SOFT, 18, BORDER)
            setPadding(dp(16), dp(16), dp(16), dp(16))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(8); bottomMargin = dp(16) }

            addView(TextView(this@UniversalSetupActivity).apply {
                text = if (success) "✓" else "◈"
                textSize = 24f
                typeface = heavyFont
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                background = circle(if (success) OK else ACCENT_DARK)
            }, LinearLayout.LayoutParams(dp(54), dp(54)).apply { marginEnd = dp(13) })

            addView(LinearLayout(this@UniversalSetupActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT
                addView(TextView(this@UniversalSetupActivity).apply {
                    text = title
                    textSize = 17f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@UniversalSetupActivity).apply {
                    text = subtitle
                    textSize = 12.5f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(MUTED))
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(4), 0, 0)
                })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }

    private fun detailsCard(rows: List<Triple<String, String, String>>): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(CARD, 16, BORDER)
            setPadding(dp(12), dp(5), dp(12), dp(5))
            rows.forEachIndexed { index, (icon, label, value) ->
                addView(LinearLayout(this@UniversalSetupActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(4), dp(9), dp(4), dp(9))
                    addView(TextView(this@UniversalSetupActivity).apply {
                        text = icon
                        textSize = 14f
                        typeface = heavyFont
                        setTextColor(Color.parseColor(ACCENT_DARK))
                        gravity = Gravity.CENTER
                        background = circle(ACCENT_TINT)
                    }, LinearLayout.LayoutParams(dp(38), dp(38)).apply { marginEnd = dp(11) })
                    addView(LinearLayout(this@UniversalSetupActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        gravity = Gravity.RIGHT
                        addView(TextView(this@UniversalSetupActivity).apply {
                            text = label
                            textSize = 11.5f
                            typeface = mediumFont
                            setTextColor(Color.parseColor(MUTED))
                            gravity = Gravity.RIGHT
                        })
                        addView(TextView(this@UniversalSetupActivity).apply {
                            text = value
                            textSize = 14.5f
                            typeface = heavyFont
                            setTextColor(Color.parseColor(TEXT))
                            gravity = Gravity.RIGHT
                        })
                    }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                })
                if (index < rows.lastIndex) {
                    addView(View(this@UniversalSetupActivity).apply {
                        setBackgroundColor(Color.parseColor(BORDER))
                    }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
                        marginStart = dp(49)
                    })
                }
            }
        }

    private fun infoCard(title: String, body: String): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(CARD_SOFT, 16, BORDER)
            setPadding(dp(16), dp(14), dp(16), dp(14))
            addView(TextView(this@UniversalSetupActivity).apply {
                text = title
                textSize = 15f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
            })
            addView(TextView(this@UniversalSetupActivity).apply {
                text = body
                textSize = 12.5f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                setPadding(0, dp(5), 0, 0)
            })
        }

    private fun sectionTitle(title: String): TextView = TextView(this).apply {
        text = title
        textSize = 16f
        typeface = heavyFont
        setTextColor(Color.parseColor(TEXT))
        gravity = Gravity.RIGHT
        setPadding(dp(4), dp(16), dp(4), dp(9))
    }

    private fun primaryButton(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        textSize = 15f
        isAllCaps = false
        typeface = heavyFont
        setTextColor(Color.WHITE)
        background = rounded(ACCENT, 14)
        setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)).apply {
            topMargin = dp(16)
        }
    }

    private fun secondaryButton(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        textSize = 14f
        isAllCaps = false
        typeface = heavyFont
        setTextColor(Color.parseColor(ACCENT_DARK))
        background = rounded(CARD, 14, BORDER)
        setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply {
            topMargin = dp(10)
        }
    }

    private fun rounded(fill: String, radiusDp: Int, stroke: String? = null): GradientDrawable =
        GradientDrawable().apply {
            setColor(Color.parseColor(fill))
            cornerRadius = dp(radiusDp).toFloat()
            stroke?.let { setStroke(dp(1), Color.parseColor(it)) }
        }

    private fun circle(fill: String): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor(fill))
    }

    private fun profileLabel(profile: String): String = when (profile) {
        "BASIC" -> "בסיסית"
        "HARDENED" -> "מחוזקת"
        "HARDENED_ADMIN" -> "מחוזקת + מנהל מכשיר"
        "DEVICE_OWNER" -> "Device Owner"
        "SYSTEM_LEVEL" -> "רמת מערכת"
        else -> profile
    }

    private fun adapterLabel(adapterId: String): String = when {
        adapterId == "samsung.oneui" -> "Samsung One UI"
        adapterId == "xiaomi.hyperos" -> "Xiaomi HyperOS"
        adapterId == "xiaomi.miui" -> "Xiaomi MIUI"
        adapterId == "qin.f21pro" -> "Qin F21 Pro"
        adapterId == "qin.f22pro" -> "Qin F22 Pro"
        adapterId == "qin.3ultra" -> "Qin 3 Ultra"
        adapterId == "qin.generic" -> "Qin"
        else -> "Android"
    }

    private fun profileRank(profile: String): Int = when (profile) {
        "BASIC" -> 0
        "HARDENED" -> 1
        "HARDENED_ADMIN" -> 2
        "DEVICE_OWNER" -> 3
        "SYSTEM_LEVEL" -> 4
        else -> -1
    }

    private fun <T : Activity> openAndFinish(activity: Class<T>) {
        startActivity(Intent(this, activity))
        finish()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
