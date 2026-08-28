package org.mdmopen.dpc

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
    private lateinit var topSubtitle: TextView

    private val BG = "#FAFAFA"
    private val CARD = "#FFFFFF"
    private val BORDER = "#EFEFF2"
    private val TEXT = "#111114"
    private val MUTED = "#8A8A94"
    private val ACCENT = "#4F46E5"
    private val ACCENT_DEEP = "#3730A3"

    private val heavyFont = Typeface.create("sans-serif-black", Typeface.NORMAL)
    private val mediumFont = Typeface.create("sans-serif-medium", Typeface.NORMAL)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        showAppStore()
    }

    private fun buildUi(): View {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(BG))
        }

        page.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor(CARD))
            setPadding(dp(24), dp(20), dp(24), dp(18))

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT
                addView(TextView(this@CustomerActivity).apply {
                    text = "יהודי כשר"
                    textSize = 21f
                    typeface = heavyFont
                    letterSpacing = 0.01f
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                })
                topSubtitle = TextView(this@CustomerActivity).apply {
                    text = "חנות האפליקציות"
                    textSize = 12.5f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(ACCENT))
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(3), 0, 0)
                }
                addView(topSubtitle)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            addView(TextView(this@CustomerActivity).apply {
                text = "י"
                textSize = 19f
                typeface = heavyFont
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                background = gradientBackground(dp(14).toFloat())
                layoutParams = LinearLayout.LayoutParams(dp(46), dp(46)).apply {
                    marginStart = dp(14)
                }
            })
        })

        page.addView(View(this).apply {
            setBackgroundColor(Color.parseColor(BORDER))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))

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
        val bar = LinearLayout(this)
        bar.apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor(CARD))
            minimumHeight = dp(80)

            addView(View(this@CustomerActivity).apply {
                setBackgroundColor(Color.parseColor(BORDER))
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))
        }

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(10), dp(12), dp(14))
        }

        row.addView(
            navButton("👤", "אזור אישי") { showPersonalArea() },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        row.addView(
            navButton("▦", "חנות אפליקציות") { showAppStore() },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        row.addView(
            navButton("🔒", "כניסת מנהל") { openAdminLogin() },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )

        bar.addView(row)
        return bar
    }

    private fun navButton(
        icon: String,
        label: String,
        action: () -> Unit
    ): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(4), dp(10), dp(4), dp(6))
            isClickable = true
            isFocusable = true

            addView(TextView(this@CustomerActivity).apply {
                text = icon
                textSize = 18f
                gravity = Gravity.CENTER
            })
            addView(TextView(this@CustomerActivity).apply {
                text = label
                textSize = 11f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(0, dp(4), 0, 0)
            })

            setOnClickListener { action() }
        }
    }


    private fun showAppStore() {
        topSubtitle.text = "חנות האפליקציות"
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

        contentArea.addView(primaryButton("פתיחת חנות האפליקציות") {
            startActivity(Intent(this@CustomerActivity, AppStoreActivity::class.java))
        })
    }

    private fun openAdminLogin() {
        val hasPin = Config.hasAdminPin(this)

        val input = EditText(this).apply {
            hint = if (hasPin) "הכנס קוד" else "הגדר קוד חדש"
            inputType =
                InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            setSingleLine()
        }

        AlertDialog.Builder(this)
            .setTitle(if (hasPin) "התחבר כמנהל" else "הגדר קוד מנהל")
            .setMessage(
                if (hasPin)
                    "הכנס קוד מנהל"
                else
                    "בחר קוד מנהל חדש של לפחות 4 ספרות"
            )
            .setView(input)
            .setNegativeButton("ביטול", null)
            .setPositiveButton(if (hasPin) "היכנס" else "שמור") { _, _ ->
                val pin = input.text.toString()

                if (!hasPin) {
                    if (pin.length < 4) {
                        Toast.makeText(
                            this,
                            "הקוד חייב להכיל לפחות 4 ספרות",
                            Toast.LENGTH_SHORT
                        ).show()
                        return@setPositiveButton
                    }

                    Config.setAdminPin(this, pin)

                    startActivity(
                        Intent(this, MainActivity::class.java)
                            .putExtra("admin_mode", true)
                    )
                } else if (Config.checkAdminPin(this, pin)) {
                    startActivity(
                        Intent(this, MainActivity::class.java)
                            .putExtra("admin_mode", true)
                    )
                } else {
                    Toast.makeText(
                        this,
                        "קוד שגוי",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
            .show()
    }

    private fun showPersonalArea() {
        topSubtitle.text = "האזור האישי שלך"
        contentArea.removeAllViews()

        contentArea.addView(sectionTitle("האזור האישי"))
        contentArea.addView(statusCard())

        contentArea.addView(
            Button(this).apply {
                text = "↻  סנכרון עכשיו"
                textSize = 15f
                isAllCaps = false
                typeface = mediumFont
                letterSpacing = 0.01f
                setTextColor(Color.WHITE)
                background = gradientBackground(dp(14).toFloat())
                setPadding(18, 14, 18, 14)

                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dp(58)
                ).apply {
                    setMargins(0, dp(8), 0, dp(18))
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
            setPadding(dp(26), dp(24), dp(26), dp(24))
            background = gradientBackground(dp(20).toFloat())

            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            lp.setMargins(0, 0, 0, dp(20))
            layoutParams = lp

            addView(TextView(this@CustomerActivity).apply {
                text = "המנוי שלך"
                textSize = 13.5f
                typeface = mediumFont
                letterSpacing = 0.02f
                setTextColor(Color.parseColor("#D8D5FB"))
                gravity = Gravity.RIGHT
            })

            addView(TextView(this@CustomerActivity).apply {
                text = "פעיל"
                textSize = 32f
                typeface = heavyFont
                setTextColor(Color.WHITE)
                gravity = Gravity.RIGHT
                setPadding(0, dp(8), 0, 0)
            })
        }
    }

    private fun sectionTitle(title: String): TextView {
        return TextView(this).apply {
            text = title
            textSize = 13.5f
            typeface = mediumFont
            letterSpacing = 0.04f
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.RIGHT
            setPadding(dp(2), dp(20), dp(2), dp(10))
        }
    }

    private fun infoCard(label: String, value: String): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(18), dp(22), dp(18))
            background = roundedCardWithBorder()

            val lp = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            lp.setMargins(0, 0, 0, dp(10))
            layoutParams = lp

            addView(TextView(this@CustomerActivity).apply {
                text = label
                textSize = 12.5f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
            })

            addView(TextView(this@CustomerActivity).apply {
                text = value
                textSize = 18f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
                setPadding(0, dp(6), 0, 0)
            })
        }
    }

    private fun primaryButton(label: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            text = label
            textSize = 15f
            isAllCaps = false
            typeface = mediumFont
            letterSpacing = 0.01f
            setTextColor(Color.WHITE)
            background = gradientBackground(dp(14).toFloat())
            setPadding(dp(18), dp(14), dp(18), dp(14))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(58)
            ).apply { setMargins(0, dp(6), 0, 0) }
            setOnClickListener { onClick() }
        }
    }

    private fun gradientBackground(radius: Float): GradientDrawable {
        return GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.parseColor(ACCENT), Color.parseColor(ACCENT_DEEP))
        ).apply {
            cornerRadius = radius
        }
    }

    private fun roundedCardWithBorder(): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(CARD))
            setStroke(dp(1), Color.parseColor(BORDER))
            cornerRadius = dp(14).toFloat()
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

}
