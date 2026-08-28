package org.mdmopen.dpc

import android.app.Activity
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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

class CustomerActivity : Activity() {

    private data class NavItem(val container: LinearLayout, val icon: TextView, val label: TextView)

    private lateinit var contentArea: LinearLayout
    private lateinit var headerLabelView: TextView
    private lateinit var personalNavItem: NavItem
    private lateinit var storeNavItem: NavItem
    private lateinit var adminNavItem: NavItem
    private var isPersonalAreaActive = false

    private val BG = "#F2F1E6"
    private val CARD = "#FFFFFF"
    private val BORDER = "#EAE8DC"
    private val TEXT = "#1C1C1C"
    private val MUTED = "#8C8C86"
    private val ACCENT = "#4B6B45"
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
            // The manifest doesn't declare supportsRtl, so the system never
            // mirrors add-order-based layout on its own even under a Hebrew
            // locale - forced explicitly here instead of relying on that.
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }

        page.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(24), dp(18), dp(24), dp(14))

            // Right side: the app's own emblem (it already carries the
            // "יהודי כשר" lettering) plus a label naming the active screen -
            // replaces the old static wordmark so the header stays useful
            // as a per-tab indicator instead of a repeated brand name.
            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL

                addView(ImageView(this@CustomerActivity).apply {
                    setImageResource(R.mipmap.ic_launcher)
                    alpha = 0.85f
                    layoutParams = LinearLayout.LayoutParams(dp(38), dp(38)).apply {
                        marginEnd = dp(14)
                    }
                })

                headerLabelView = TextView(this@CustomerActivity).apply {
                    textSize = 17f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                }
                addView(headerLabelView)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            addView(headerSyncBadge())
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

    /** Small fixed badge in the header, present on every screen (built once
     * in buildUi, not per-tab) instead of the old full-width button that only
     * lived inside the personal-area tab. */
    private fun headerSyncBadge(): TextView {
        lateinit var badge: TextView
        badge = TextView(this).apply {
            text = "↻ סינכרון"
            textSize = 12.5f
            typeface = heavyFont
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            background = flatRounded(ACCENT, dp(12).toFloat())
            setPadding(dp(14), dp(11), dp(14), dp(11))
            isClickable = true
            isFocusable = true

            setOnClickListener {
                isClickable = false
                text = "⏳ מסנכרן..."

                Thread {
                    try {
                        PolicySync.run(applicationContext)
                        AutoUpdater.check(applicationContext)
                        Config.setLastSyncNow(applicationContext)

                        runOnUiThread {
                            text = "✓ סונכרן"
                            Toast.makeText(
                                this@CustomerActivity,
                                "המכשיר סונכרן בהצלחה",
                                Toast.LENGTH_SHORT
                            ).show()
                            refreshLastSyncLabelIfShown()

                            postDelayed({
                                text = "↻ סינכרון"
                                isClickable = true
                            }, 1800)
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            text = "↻ סינכרון"
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
        return badge
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
        adminNavItem = navButton("🔒", "כניסת מנהל") { showAdminLogin() }

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
        for (item in listOf(personalNavItem, storeNavItem, adminNavItem)) {
            val isActive = item === active
            item.icon.alpha = if (isActive) 1f else 0.5f
            item.label.typeface = if (isActive) heavyFont else mediumFont
            item.label.setTextColor(Color.parseColor(if (isActive) ACCENT else MUTED))
            item.container.background =
                if (isActive) flatRounded(ACCENT_TINT, dp(14).toFloat()) else null
        }
    }

    private fun showAppStore() {
        isPersonalAreaActive = false
        headerLabelView.text = "חנות אפליקציות"
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

    /** A full tab like the other two, rather than a popup dialog - centered
     * PIN field, styled to match the rest of the app. Business logic (first-time
     * PIN setup vs. checking an existing one) is unchanged from the old dialog. */
    private fun showAdminLogin() {
        isPersonalAreaActive = false
        headerLabelView.text = "כניסת מנהל"
        setActiveNav(adminNavItem)
        contentArea.removeAllViews()

        val hasPin = Config.hasAdminPin(this)

        contentArea.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(36), dp(24), dp(36))
            background = roundedCardWithBorder()
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, dp(24), 0, dp(16)) }

            addView(TextView(this@CustomerActivity).apply {
                text = "🔒"
                textSize = 26f
                gravity = Gravity.CENTER
                background = flatCircle(ACCENT_TINT)
                layoutParams = LinearLayout.LayoutParams(dp(64), dp(64))
            })

            addView(TextView(this@CustomerActivity).apply {
                text = if (hasPin) "כניסת מנהל" else "הגדרת קוד מנהל"
                textSize = 18f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.CENTER
                setPadding(0, dp(18), 0, dp(6))
            })

            addView(TextView(this@CustomerActivity).apply {
                text = if (hasPin) "הכנס את קוד המנהל כדי להמשיך"
                       else "בחר קוד מנהל חדש בן 4 ספרות לפחות"
                textSize = 13f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(dp(12), 0, dp(12), dp(22))
            })

            val input = EditText(this@CustomerActivity).apply {
                hint = if (hasPin) "קוד מנהל" else "קוד חדש"
                inputType =
                    InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
                setSingleLine()
                textSize = 20f
                typeface = heavyFont
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor(TEXT))
                background = roundedCardWithBorder()
                setPadding(dp(16), dp(14), dp(16), dp(14))
                layoutParams = LinearLayout.LayoutParams(
                    dp(180),
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            }
            addView(input)

            addView(primaryButton(if (hasPin) "היכנס" else "שמור והמשך") {
                val pin = input.text.toString()

                if (!hasPin) {
                    if (pin.length < 4) {
                        Toast.makeText(
                            this@CustomerActivity,
                            "הקוד חייב להכיל לפחות 4 ספרות",
                            Toast.LENGTH_SHORT
                        ).show()
                        return@primaryButton
                    }

                    Config.setAdminPin(this@CustomerActivity, pin)

                    startActivity(
                        Intent(this@CustomerActivity, MainActivity::class.java)
                            .putExtra("admin_mode", true)
                    )
                } else if (Config.checkAdminPin(this@CustomerActivity, pin)) {
                    startActivity(
                        Intent(this@CustomerActivity, MainActivity::class.java)
                            .putExtra("admin_mode", true)
                    )
                } else {
                    Toast.makeText(
                        this@CustomerActivity,
                        "קוד שגוי",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            })
        })
    }

    private fun showPersonalArea() {
        isPersonalAreaActive = true
        headerLabelView.text = "אזור אישי"
        setActiveNav(personalNavItem)
        contentArea.removeAllViews()

        contentArea.addView(identityCard("האזור האישי שלך"))
        contentArea.addView(statusCard())

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
                listOf(
                    Triple("#", "מזהה מכשיר", Config.deviceId(this)),
                    Triple("↻", "עדכון אחרון", lastSyncLabel()),
                )
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

    /** Rebuilds the personal-area tab so its "last synced" row picks up a
     * sync that just completed via the header badge - a no-op if some other
     * tab is showing. */
    private fun refreshLastSyncLabelIfShown() {
        if (isPersonalAreaActive) showPersonalArea()
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
