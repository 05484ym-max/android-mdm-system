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

    private data class NavItem(val container: LinearLayout, val icon: TextView, val label: TextView)

    private lateinit var contentArea: LinearLayout
    private lateinit var personalNavItem: NavItem
    private lateinit var storeNavItem: NavItem

    private val BG = "#F2F1E6"
    private val CARD = "#FFFFFF"
    private val BORDER = "#EAE8DC"
    private val TEXT = "#1C1C1C"
    private val MUTED = "#8C8C86"
    private val ACCENT = "#4B6B45"
    private val ACCENT_BADGE = "#5A7A54"
    private val ACCENT_TINT = "#E7ECDD"

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
            setPadding(dp(24), dp(22), dp(24), dp(14))

            addView(TextView(this@CustomerActivity).apply {
                text = "יהודי כשר"
                textSize = 21f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            addView(TextView(this@CustomerActivity).apply {
                text = "✓"
                textSize = 15f
                typeface = heavyFont
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT)
                layoutParams = LinearLayout.LayoutParams(dp(34), dp(34))
            })
        })

        contentArea = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(4), dp(20), dp(24))
        }

        val scroll = ScrollView(this).apply { addView(contentArea) }

        page.addView(
            scroll,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
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

        personalNavItem = navButton("👤", "אזור אישי") { showPersonalArea() }
        storeNavItem = navButton("▦", "חנות אפליקציות") { showAppStore() }
        val adminNavItem = navButton("🔒", "כניסת מנהל") { openAdminLogin() }

        row.addView(
            personalNavItem.container,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        row.addView(
            storeNavItem.container,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        row.addView(
            adminNavItem.container,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )

        bar.addView(row)
        return bar
    }

    private fun navButton(icon: String, label: String, action: () -> Unit): NavItem {
        val iconView = TextView(this).apply {
            text = icon
            textSize = 18f
            gravity = Gravity.CENTER
        }
        val labelView = TextView(this).apply {
            text = label
            textSize = 11f
            typeface = mediumFont
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, 0)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(10), dp(10), dp(6))
            isClickable = true
            isFocusable = true
            addView(iconView)
            addView(labelView)
            setOnClickListener { action() }
        }
        return NavItem(container, iconView, labelView)
    }

    private fun setActiveNav(active: NavItem) {
        for (item in listOf(personalNavItem, storeNavItem)) {
            val isActive = item === active
            item.icon.alpha = if (isActive) 1f else 0.5f
            item.label.typeface = if (isActive) heavyFont else mediumFont
            item.label.setTextColor(Color.parseColor(if (isActive) ACCENT else MUTED))
            item.container.background =
                if (isActive) flatRounded(ACCENT_TINT, dp(14).toFloat()) else null
        }
    }

    private fun showAppStore() {
        setActiveNav(storeNavItem)
        contentArea.removeAllViews()

        contentArea.addView(identityCard("חנות האפליקציות שלך"))
        contentArea.addView(sectionTitle("חנות האפליקציות"))
        contentArea.addView(
            infoRowCard(
                listOf(Triple("◆", "חנות יהודי כשר", "כאן יוצגו האפליקציות המאושרות למכשיר"))
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
        setActiveNav(personalNavItem)
        contentArea.removeAllViews()

        contentArea.addView(identityCard("האזור האישי שלך"))
        contentArea.addView(statusCard())
        contentArea.addView(syncButton())

        contentArea.addView(sectionTitle("פרטי המנוי"))
        contentArea.addView(
            infoRowCard(
                listOf(
                    Triple("✓", "סטטוס המנוי", "פעיל"),
                    Triple("₪", "מחיר חודשי", "טרם הוגדר"),
                    Triple("▤", "תאריך הצטרפות", "טרם הוגדר"),
                )
            )
        )

        contentArea.addView(sectionTitle("המכשיר שלי"))
        contentArea.addView(
            infoRowCard(
                listOf(Triple("#", "מזהה מכשיר", Config.deviceId(this).take(12) + "..."))
            )
        )
    }

    private fun identityCard(subtitle: String): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(18))
            background = roundedCardWithBorder()
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, dp(10), 0, dp(16)) }

            addView(TextView(this@CustomerActivity).apply {
                text = "י"
                textSize = 18f
                typeface = heavyFont
                setTextColor(Color.parseColor(ACCENT))
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT_TINT)
                layoutParams = LinearLayout.LayoutParams(dp(46), dp(46)).apply {
                    marginStart = dp(14)
                }
            })

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT
                addView(TextView(this@CustomerActivity).apply {
                    text = "יהודי כשר"
                    textSize = 16f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@CustomerActivity).apply {
                    text = subtitle
                    textSize = 12.5f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(MUTED))
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(2), 0, 0)
                })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
    }

    private fun statusCard(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
            background = roundedCardWithBorder()
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, dp(14)) }

            addView(TextView(this@CustomerActivity).apply {
                text = "✓"
                textSize = 24f
                typeface = heavyFont
                setTextColor(Color.parseColor(ACCENT))
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT_TINT)
                layoutParams = LinearLayout.LayoutParams(dp(56), dp(56)).apply {
                    marginStart = dp(16)
                }
            })

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT
                addView(TextView(this@CustomerActivity).apply {
                    text = "המנוי שלך"
                    textSize = 13f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(MUTED))
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@CustomerActivity).apply {
                    text = "פעיל"
                    textSize = 26f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(4), 0, 0)
                })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
    }

    private fun syncButton(): LinearLayout {
        lateinit var titleView: TextView
        lateinit var subtitleView: TextView

        val button = LinearLayout(this)
        button.apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(16))
            background = flatRounded(ACCENT, dp(16).toFloat())
            isClickable = true
            isFocusable = true
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, dp(20)) }

            addView(TextView(this@CustomerActivity).apply {
                text = "↻"
                textSize = 20f
                typeface = heavyFont
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT_BADGE)
                layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)).apply {
                    marginStart = dp(14)
                }
            })

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT

                titleView = TextView(this@CustomerActivity).apply {
                    text = "סנכרון עכשיו"
                    textSize = 16f
                    typeface = heavyFont
                    setTextColor(Color.WHITE)
                    gravity = Gravity.RIGHT
                }
                addView(titleView)

                subtitleView = TextView(this@CustomerActivity).apply {
                    text = lastSyncLabel()
                    textSize = 12f
                    typeface = mediumFont
                    setTextColor(Color.parseColor("#D6E3D2"))
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(2), 0, 0)
                }
                addView(subtitleView)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            setOnClickListener {
                isClickable = false
                titleView.text = "מסנכרן..."

                Thread {
                    try {
                        PolicySync.run(applicationContext)
                        AutoUpdater.check(applicationContext)
                        Config.setLastSyncNow(applicationContext)

                        runOnUiThread {
                            titleView.text = "✓ הסתיים"
                            subtitleView.text = lastSyncLabel()
                            Toast.makeText(
                                this@CustomerActivity,
                                "המכשיר סונכרן בהצלחה",
                                Toast.LENGTH_SHORT
                            ).show()

                            postDelayed({
                                titleView.text = "סנכרון עכשיו"
                                isClickable = true
                            }, 1800)
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            titleView.text = "נסה שוב"
                            isClickable = true
                            Toast.makeText(
                                this@CustomerActivity,
                                "הסנכרון נכשל: ${e.message}",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    }
                }.start()
            }
        }

        return button
    }

    private fun lastSyncLabel(): String {
        val last = Config.lastSyncAt(this)
        if (last == 0L) return "טרם סונכרן"
        val minutes = ((System.currentTimeMillis() - last) / 60000).toInt()
        return when {
            minutes < 1 -> "עדכון אחרון: הרגע"
            minutes < 60 -> "עדכון אחרון: לפני $minutes דקות"
            else -> "עדכון אחרון: לפני ${minutes / 60} שעות"
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
            setPadding(dp(2), dp(18), dp(2), dp(10))
        }
    }

    /** Icon, label, value triples rendered as rows inside one shared card. */
    private fun infoRowCard(rows: List<Triple<String, String, String>>): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedCardWithBorder()
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 0, 0, dp(4)) }

            rows.forEachIndexed { index, (icon, label, value) ->
                addView(infoRow(icon, label, value))
                if (index < rows.size - 1) {
                    addView(View(this@CustomerActivity).apply {
                        setBackgroundColor(Color.parseColor(BORDER))
                    }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
                        marginStart = dp(20)
                        marginEnd = dp(20)
                    })
                }
            }
        }
    }

    private fun infoRow(icon: String, label: String, value: String): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))

            addView(TextView(this@CustomerActivity).apply {
                text = icon
                textSize = 15f
                typeface = heavyFont
                setTextColor(Color.parseColor(ACCENT))
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT_TINT)
                layoutParams = LinearLayout.LayoutParams(dp(36), dp(36)).apply {
                    marginStart = dp(14)
                }
            })

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT
                addView(TextView(this@CustomerActivity).apply {
                    text = label
                    textSize = 12.5f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(MUTED))
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@CustomerActivity).apply {
                    text = value
                    textSize = 16.5f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(3), 0, 0)
                })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
    }

    private fun primaryButton(label: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            text = label
            textSize = 15f
            isAllCaps = false
            typeface = mediumFont
            setTextColor(Color.WHITE)
            background = flatRounded(ACCENT, dp(14).toFloat())
            setPadding(dp(18), dp(14), dp(18), dp(14))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(56)
            ).apply { setMargins(0, dp(4), 0, 0) }
            setOnClickListener { onClick() }
        }
    }

    private fun flatCircle(color: String): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor(color))
        }
    }

    private fun flatRounded(color: String, radius: Float): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(color))
            cornerRadius = radius
        }
    }

    private fun roundedCardWithBorder(): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(CARD))
            setStroke(dp(1), Color.parseColor(BORDER))
            cornerRadius = dp(16).toFloat()
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

}
