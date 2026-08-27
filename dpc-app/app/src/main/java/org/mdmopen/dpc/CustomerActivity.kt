package org.mdmopen.dpc

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

class CustomerActivity : Activity() {

    private lateinit var contentArea: LinearLayout

    private val BG = "#F5F7FA"
    private val CARD = "#FFFFFF"
    private val TEXT = "#1A1A1A"
    private val MUTED = "#888888"
    private val GOLD = "#8B7A4A"
    private val NAVY = "#1A2A4A"
    private val NAVY_DARK = "#0F1820"
    private val BLUE = "#5B7A9B"
    private val BORDER = "#E5E5E5"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        showPersonalArea()
    }

    private fun buildUi(): View {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(BG))
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 54, 36, 24)
        }

        header.addView(TextView(this).apply {
            text = "האזור שלי"
            textSize = 27f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
        })

        header.addView(TextView(this).apply {
            text = "ניהול המנוי והאפליקציות שלך"
            textSize = 14f
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.RIGHT
            setPadding(0, 8, 0, 0)
        })

        page.addView(header)

        contentArea = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 10, 32, 24)
        }

        val scroll = ScrollView(this).apply {
            addView(contentArea)
        }

        page.addView(
            scroll,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )

        page.addView(buildBottomBar())

        return page
    }

    private fun buildBottomBar(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(
                dp(8),
                dp(8),
                dp(8),
                dp(14)
            )

            setBackgroundColor(Color.WHITE)
            elevation = dp(12).toFloat()
            minimumHeight = dp(88)

            addView(
                navButton("👤\nאזור אישי") {
                    showPersonalArea()
                },
                LinearLayout.LayoutParams(
                    0,
                    dp(74),
                    1f
                )
            )

            addView(
                navButton("▦\nחנות אפליקציות") {
                    showAppStore()
                },
                LinearLayout.LayoutParams(
                    0,
                    dp(74),
                    1f
                )
            )

            addView(
                navButton("🔒\nכניסת מנהל") {
                    openAdminLogin()
                },
                LinearLayout.LayoutParams(
                    0,
                    dp(74),
                    1f
                )
            )
        }
    }

    private fun navButton(
        label: String,
        action: () -> Unit
    ): Button {
        return Button(this).apply {
            text = label
            textSize = 12f
            isAllCaps = false
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor(NAVY))
            setBackgroundColor(Color.TRANSPARENT)
            setPadding(
                dp(4),
                dp(4),
                dp(4),
                dp(4)
            )
            minimumHeight = dp(68)
            setOnClickListener { action() }
        }
    }


    private fun showAppStore() {
        contentArea.removeAllViews()

        contentArea.addView(
            sectionTitle("חנות האפליקציות")
        )

        contentArea.addView(
            infoCard(
                "חנות יהודי כשר",
                "כאן יוצגו האפליקציות המאושרות למכשיר"
            )
        )

        contentArea.addView(
            Button(this).apply {
                text = "פתיחת חנות האפליקציות"
                textSize = 15f
                isAllCaps = false
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor(NAVY))

                setOnClickListener {
                    startActivity(
                        Intent(
                            this@CustomerActivity,
                            AppStoreActivity::class.java
                        )
                    )
                }
            }
        )
    }

    private fun openAdminLogin() {
        val input = EditText(this).apply {
            hint = "קוד מנהל"
            inputType =
                InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            setSingleLine()
        }

        AlertDialog.Builder(this)
            .setTitle("כניסת מנהל")
            .setMessage("הזן קוד מנהל")
            .setView(input)
            .setNegativeButton("ביטול", null)
            .setPositiveButton("כניסה") { _, _ ->
                val pin = input.text.toString()
                if (Config.checkAdminPin(this, pin)) {
                    startActivity(
                        Intent(this, MainActivity::class.java)
                            .putExtra("admin_mode", true)
                    )
                }
            }
            .show()
    }

    private fun showPersonalArea() {
        contentArea.removeAllViews()

        contentArea.addView(statusCard())

        contentArea.addView(
            Button(this).apply {
                text = "↻  סנכרון עכשיו"
                textSize = 15f
                isAllCaps = false
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor(NAVY))
                setPadding(18, 14, 18, 14)

                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dp(58)
                ).apply {
                    setMargins(0, 8, 0, 18)
                }

                setOnClickListener {
                    isEnabled = false
                    text = "מסנכרן..."

                    Thread {
                        try {
                            val result = PolicySync.run(applicationContext)

                            // Also check whether a newer APK exists.
                            AutoUpdater.check(applicationContext)

                            runOnUiThread {
                                text = "✓ הסנכרון הושלם"
                                Toast.makeText(
                                    this@CustomerActivity,
                                    "המכשיר סונכרן בהצלחה",
                                    Toast.LENGTH_SHORT
                                ).show()

                                postDelayed({
                                    text = "↻  סנכרון עכשיו"
                                    isEnabled = true
                                }, 1800)
                            }

                        } catch (e: Exception) {
                            runOnUiThread {
                                text = "↻  נסה שוב"
                                isEnabled = true

                                Toast.makeText(
                                    this@CustomerActivity,
                                    "הסנכרון נכשל",
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        }
                    }.start()
                }
            }
        )

        contentArea.addView(sectionTitle("פרטי המנוי"))

        contentArea.addView(infoCard("סטטוס המנוי", "פעיל"))
        contentArea.addView(infoCard("מחיר חודשי", "טרם הוגדר"))
        contentArea.addView(infoCard("תאריך הצטרפות", "טרם הוגדר"))
        contentArea.addView(infoCard("תוקף המנוי", "טרם הוגדר"))

        contentArea.addView(sectionTitle("המכשיר שלי"))

        contentArea.addView(
            infoCard(
                "מזהה מכשיר",
                Config.deviceId(this).take(12) + "..."
            )
        )
    }

    private fun statusCard(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(30, 28, 30, 28)
            setBackgroundColor(Color.parseColor(CARD))
            elevation = 4f

            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            lp.setMargins(0, 0, 0, 24)
            layoutParams = lp

            addView(TextView(this@CustomerActivity).apply {
                text = "המנוי שלך"
                textSize = 15f
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
            })

            addView(TextView(this@CustomerActivity).apply {
                text = "פעיל"
                textSize = 30f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(GOLD))
                gravity = Gravity.RIGHT
                setPadding(0, 8, 0, 0)
            })
        }
    }

    private fun sectionTitle(title: String): TextView {
        return TextView(this).apply {
            text = title
            textSize = 17f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
            setPadding(0, 22, 0, 14)
        }
    }

    private fun infoCard(label: String, value: String): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(26, 22, 26, 22)
            setBackgroundColor(Color.parseColor(CARD))
            elevation = 2f

            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            lp.setMargins(0, 0, 0, 14)
            layoutParams = lp

            addView(TextView(this@CustomerActivity).apply {
                text = label
                textSize = 13f
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
            })

            addView(TextView(this@CustomerActivity).apply {
                text = value
                textSize = 19f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
                setPadding(0, 7, 0, 0)
            })
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

}
