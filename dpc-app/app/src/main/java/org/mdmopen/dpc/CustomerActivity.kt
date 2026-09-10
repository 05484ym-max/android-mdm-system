package org.mdmopen.dpc

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.MediaController
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Locale

class CustomerActivity : Activity() {

    private data class NavItem(
        val container: LinearLayout,
        val iconFrame: FrameLayout,
        val icon: ImageView,
        val label: TextView,
        val badge: View,
    )

    private lateinit var contentArea: LinearLayout
    private lateinit var headerLabelView: TextView
    private lateinit var personalNavItem: NavItem
    private lateinit var storeNavItem: NavItem
    private lateinit var adminNavItem: NavItem
    private lateinit var newsNavItem: NavItem
    private lateinit var supportNavItem: NavItem

    private var isPersonalAreaActive = false
    private var isNewsActive = false
    private var accessibilitySetupWindowOpen = false
    private var selectedStoreCategory = "all"
    private var storeSearchQuery = ""
    private var newsItems: List<UpdateItem> = emptyList()

    // Palette taken from the approved mockup: warm cream, deep green, pale olive and subtle gold.
    private val BG = "#F7F2E8"
    private val CARD = "#FFFDFC"
    private val CARD_SOFT = "#FBF8F0"
    private val BORDER = "#E8E1D4"
    private val TEXT = "#1C231D"
    private val MUTED = "#85867E"
    private val ACCENT = "#245E38"
    private val ACCENT_DARK = "#17472B"
    private val ACCENT_TINT = "#EEF2E1"
    private val ACCENT_TINT_STRONG = "#E4EAD3"
    private val GOLD = "#BFA15B"
    private val OK = "#2F7A48"

    private val heavyFont = Typeface.create("sans-serif-black", Typeface.NORMAL)
    private val mediumFont = Typeface.create("sans-serif-medium", Typeface.NORMAL)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        newsItems = Config.newsCache(this)
        setContentView(buildUi())
        showAppStore()
        updateNewsBadge()
        refreshNews()
    }

    override fun onResume() {
        super.onResume()
        if (accessibilitySetupWindowOpen) {
            accessibilitySetupWindowOpen = false
            try {
                PolicyEnforcer(this).finishAccessibilitySetupWindow()
            } catch (_: Exception) {
                SyncScheduler.enqueueImmediate(applicationContext)
            }
        }
        if (::contentArea.isInitialized && isPersonalAreaActive) showPersonalArea()
    }

    // ---------------------------------------------------------------------
    // Shell / navigation
    // ---------------------------------------------------------------------

    private fun buildUi(): View {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setBackgroundColor(Color.parseColor(BG))
        }

        page.addView(buildTopBar())

        contentArea = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(18), dp(4), dp(18), dp(28))
        }

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
            addView(contentArea)
        }
        page.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        page.addView(buildBottomBar())
        return page
    }

    private fun buildTopBar(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(14), dp(18), dp(12))

            // RTL add-order: logo emblem is on the right, then the title stack, then
            // the sync pill on the left.
            addView(ImageView(this@CustomerActivity).apply {
                setImageResource(R.mipmap.ic_launcher)
                scaleType = ImageView.ScaleType.CENTER_CROP
            }, LinearLayout.LayoutParams(dp(38), dp(38)).apply { marginEnd = dp(10) })

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL

                addView(TextView(this@CustomerActivity).apply {
                    text = "יהודי כשר"
                    textSize = 17f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                })

                headerLabelView = TextView(this@CustomerActivity).apply {
                    textSize = 13f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(GOLD))
                    gravity = Gravity.RIGHT
                    maxLines = 1
                    setPadding(0, dp(2), 0, 0)
                }
                addView(headerLabelView)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            addView(headerSyncBadge())
        }
    }

    private fun headerSyncBadge(): TextView {
        lateinit var badge: TextView
        badge = TextView(this).apply {
            text = "↻  סינכרון"
            textSize = 12.5f
            typeface = heavyFont
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            background = rounded(ACCENT, 15)
            setPadding(dp(15), dp(10), dp(15), dp(10))
            isClickable = true
            isFocusable = true

            setOnClickListener {
                isClickable = false
                text = "⏳ מסנכרן..."
                Thread {
                    try {
                        val result = PolicySync.run(applicationContext)
                        AutoUpdater.check(applicationContext)
                        Config.setLastSyncNow(applicationContext)
                        runOnUiThread {
                            text = "✓ סונכרן"
                            Toast.makeText(
                                this@CustomerActivity,
                                "המכשיר סונכרן בהצלחה\n$result",
                                Toast.LENGTH_LONG
                            ).show()
                            refreshLastSyncLabelIfShown()
                            postDelayed({
                                text = "↻  סינכרון"
                                isClickable = true
                            }, 1800)
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            text = "↻  סינכרון"
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

    /** A floating pill dock, inset from the screen edges and elevated over the
     * page background, rather than a full-width bar flush with the bottom. */
    private fun buildBottomBar(): FrameLayout {
        val wrapper = FrameLayout(this).apply {
            setPadding(dp(14), dp(8), dp(14), dp(14))
        }

        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            background = rounded(CARD, 28)
            elevation = dp(8).toFloat()
            setPadding(dp(6), dp(8), dp(6), dp(8))
        }

        personalNavItem = navButton(R.drawable.ic_nav_person, "אזור אישי") { showPersonalArea() }
        storeNavItem = navButton(R.drawable.ic_nav_store, "חנות\nאפליקציות") { showAppStore() }
        newsNavItem = navButton(R.drawable.ic_nav_news, "חדשות\nועדכונים") { showNews() }
        supportNavItem = navButton(R.drawable.ic_nav_support, "תמיכה") { showSupport() }
        adminNavItem = navButton(R.drawable.ic_nav_lock, "כניסת\nמנהל") { showAdminLogin() }

        listOf(personalNavItem, storeNavItem, newsNavItem, supportNavItem, adminNavItem).forEach {
            pill.addView(it.container, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }

        wrapper.addView(
            pill,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        )
        return wrapper
    }

    /** Every nav icon renders at the same fixed size from its own vector
     * drawable (never a text glyph, whose apparent size varies wildly by
     * character), inside a fixed-size frame so the active-state chip below
     * doesn't shift the icon's position when it appears. */
    private fun navButton(iconRes: Int, label: String, action: () -> Unit): NavItem {
        val iconView = ImageView(this).apply {
            setImageResource(iconRes)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
        }
        val badgeDot = View(this).apply {
            background = circle("#B52F24")
            visibility = View.GONE
        }
        val iconFrame = FrameLayout(this).apply {
            addView(iconView, FrameLayout.LayoutParams(dp(22), dp(22)).apply { gravity = Gravity.CENTER })
            addView(badgeDot, FrameLayout.LayoutParams(dp(8), dp(8)).apply {
                gravity = Gravity.TOP or Gravity.END
                marginEnd = dp(1)
            })
        }
        val labelView = TextView(this).apply {
            text = label
            textSize = 10.5f
            typeface = mediumFont
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.CENTER
            setLineSpacing(0f, 0.92f)
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(3), dp(4), dp(3), dp(4))
            isClickable = true
            isFocusable = true
            addView(iconFrame, LinearLayout.LayoutParams(dp(34), dp(34)))
            addView(labelView)
            setOnClickListener { action() }
        }
        return NavItem(container, iconFrame, iconView, labelView, badgeDot)
    }

    private fun setActiveNav(active: NavItem) {
        listOf(personalNavItem, storeNavItem, newsNavItem, supportNavItem, adminNavItem).forEach { item ->
            val selected = item === active
            item.icon.setColorFilter(
                Color.parseColor(if (selected) BG else MUTED),
                PorterDuff.Mode.SRC_IN
            )
            item.iconFrame.background = if (selected) circle(ACCENT_DARK) else null
            item.label.typeface = if (selected) heavyFont else mediumFont
            item.label.setTextColor(Color.parseColor(if (selected) ACCENT_DARK else MUTED))
        }
    }

    // ---------------------------------------------------------------------
    // Personal area - approved redesign
    // ---------------------------------------------------------------------

    private fun showPersonalArea() {
        isPersonalAreaActive = true
        isNewsActive = false
        headerLabelView.text = "אזור אישי"
        setActiveNav(personalNavItem)
        contentArea.removeAllViews()

        contentArea.addView(personalWelcomeCard())

        // "מצב מנוי" moved into the status pill on the welcome card above, so it
        // is not repeated as a row here. A "תאריך הצטרפות" (join date) row isn't
        // included either - no such field exists on the device record.
        val rows = mutableListOf<Triple<Int, String, String>>()
        Config.subscriptionExpiryDate(this)?.takeIf { it.isNotBlank() }?.let {
            rows += Triple(R.drawable.ic_row_calendar, "תוקף מנוי", compactSubscriptionDate(it))
        }
        rows += Triple(R.drawable.ic_row_device, "מזהה מכשיר", Config.deviceId(this))
        rows += Triple(R.drawable.ic_row_clock, "עדכון אחרון", lastSyncLabelCompact())

        contentArea.addView(personalDetailsCard(rows))

        val guardPolicy = WhatsAppGuardConfig.load(this)
        if (guardPolicy.enabled) {
            contentArea.addView(whatsAppFeaturedCard(), LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(14) })
        }

        // Keep DNS functionality intact, below the approved hero content so the first screen
        // remains visually identical to the mockup while advanced controls remain available.
        contentArea.addView(sectionTitle("סינון DNS"))
        contentArea.addView(dnsToggleCard())
        val dnsStatus = AdBlockDns.currentStatus(this)
        contentArea.addView(personalDetailsCard(listOf(
            Triple(R.drawable.ic_row_shield, "מצב הסינון", dnsModeLabel(dnsStatus.dnsMode))
        )))
    }

    private fun personalWelcomeCard(): LinearLayout {
        val active = Config.storeAccessAllowed(this)
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = cardBackground()
            setPadding(dp(18), dp(15), dp(18), dp(15))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(8)
                bottomMargin = dp(14)
            }

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER

                addView(ImageView(this@CustomerActivity).apply {
                    setImageResource(R.drawable.ic_nav_person)
                    scaleType = ImageView.ScaleType.CENTER_INSIDE
                    setColorFilter(Color.parseColor(ACCENT_DARK), PorterDuff.Mode.SRC_IN)
                    background = circle(ACCENT_TINT_STRONG)
                    val pad = dp(13)
                    setPadding(pad, pad, pad, pad)
                }, LinearLayout.LayoutParams(dp(52), dp(52)))

                addView(statusPill(active), LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(8) })
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = dp(14) })

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.RIGHT
                addView(TextView(this@CustomerActivity).apply {
                    text = "ברוך הבא!"
                    textSize = 17f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                })
                addView(TextView(this@CustomerActivity).apply {
                    text = "כאן ניתן לנהל את ההגדרות והמנויים שלך"
                    textSize = 12.5f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(MUTED))
                    gravity = Gravity.RIGHT
                    setPadding(0, dp(3), 0, 0)
                })
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
    }

    /** Small "active"/"expired" status badge, reusing only colors already in
     * the app's palette (OK / the existing badge red / ACCENT_TINT). */
    private fun statusPill(active: Boolean): LinearLayout {
        val tint = if (active) OK else "#B52F24"
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(ACCENT_TINT, 20)
            setPadding(dp(10), dp(5), dp(10), dp(5))
            addView(View(this@CustomerActivity).apply {
                background = circle(tint)
            }, LinearLayout.LayoutParams(dp(7), dp(7)).apply { marginEnd = dp(5) })
            addView(TextView(this@CustomerActivity).apply {
                text = if (active) "פעיל" else "פג תוקף"
                textSize = 11.5f
                typeface = heavyFont
                setTextColor(Color.parseColor(tint))
            })
        }
    }

    /** Each row reads, right to left: a plain (uncircled) icon, its label,
     * then the value pinned to the far left edge of the card. */
    private fun personalDetailsCard(rows: List<Triple<Int, String, String>>): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBackground()
            setPadding(dp(14), dp(4), dp(14), dp(4))
            rows.forEachIndexed { index, (iconRes, label, value) ->
                addView(LinearLayout(this@CustomerActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(2), dp(12), dp(2), dp(12))

                    addView(ImageView(this@CustomerActivity).apply {
                        setImageResource(iconRes)
                        scaleType = ImageView.ScaleType.CENTER_INSIDE
                        setColorFilter(Color.parseColor(MUTED), PorterDuff.Mode.SRC_IN)
                    }, LinearLayout.LayoutParams(dp(20), dp(20)).apply { marginEnd = dp(8) })

                    addView(TextView(this@CustomerActivity).apply {
                        text = label
                        textSize = 12.5f
                        typeface = mediumFont
                        setTextColor(Color.parseColor(MUTED))
                        gravity = Gravity.RIGHT
                    })

                    addView(TextView(this@CustomerActivity).apply {
                        text = value
                        textSize = 15f
                        typeface = heavyFont
                        setTextColor(Color.parseColor(TEXT))
                        gravity = Gravity.LEFT
                        maxLines = 2
                    }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                })
                if (index < rows.lastIndex) {
                    addView(View(this@CustomerActivity).apply {
                        setBackgroundColor(Color.parseColor(BORDER))
                    }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))
                }
            }
        }
    }

    private fun whatsAppFeaturedCard(): LinearLayout {
        val enabled = WhatsAppGuardProtection.accessibilityEnabled(this)
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = featuredCardBackground()
            setPadding(dp(16), dp(16), dp(16), dp(16))

            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL

                addView(ImageView(this@CustomerActivity).apply {
                    setImageResource(R.drawable.ic_row_chat)
                    scaleType = ImageView.ScaleType.CENTER_INSIDE
                    setColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN)
                    background = circle(if (enabled) OK else ACCENT_DARK)
                    val pad = dp(15)
                    setPadding(pad, pad, pad, pad)
                }, LinearLayout.LayoutParams(dp(56), dp(56)).apply { marginEnd = dp(13) })

                addView(LinearLayout(this@CustomerActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.RIGHT
                    addView(TextView(this@CustomerActivity).apply {
                        text = "הגנת WhatsApp"
                        textSize = 18f
                        typeface = heavyFont
                        setTextColor(Color.parseColor(ACCENT_DARK))
                        gravity = Gravity.RIGHT
                    })
                    addView(TextView(this@CustomerActivity).apply {
                        text = if (enabled) {
                            "ההגנה פעילה במכשיר זה"
                        } else {
                            "הפעלה חד-פעמית של שירות ‘יהודי כשר’ להגנת WhatsApp במכשיר זה."
                        }
                        textSize = 12.5f
                        typeface = mediumFont
                        setTextColor(Color.parseColor(MUTED))
                        gravity = Gravity.RIGHT
                        maxLines = 3
                        setPadding(0, dp(4), 0, 0)
                    })
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            })

            if (!enabled) {
                addView(Button(this@CustomerActivity).apply {
                    text = "הפעל הגנת WhatsApp"
                    textSize = 15f
                    isAllCaps = false
                    typeface = heavyFont
                    setTextColor(Color.WHITE)
                    background = rounded(ACCENT, 14)
                    val icon = getDrawable(R.drawable.ic_row_shield)?.mutate()?.apply {
                        setTint(Color.WHITE)
                    }
                    setCompoundDrawablesWithIntrinsicBounds(icon, null, null, null)
                    compoundDrawablePadding = dp(8)
                    setOnClickListener { openWhatsAppAccessibilitySettings() }
                }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)).apply {
                    topMargin = dp(14)
                })
            }
        }
    }

    private fun openWhatsAppAccessibilitySettings() {
        try {
            val enforcer = PolicyEnforcer(this)
            if (!enforcer.isDeviceOwner()) {
                Toast.makeText(this, "המכשיר אינו במצב ניהול מלא", Toast.LENGTH_LONG).show()
                return
            }
            enforcer.beginAccessibilitySetupWindow()
            try { stopLockTask() } catch (_: Exception) {}
            enforcer.disableKiosk()
            accessibilitySetupWindowOpen = true
        } catch (e: Exception) {
            Toast.makeText(this, "לא ניתן לפתוח חלון נגישות: ${e.message}", Toast.LENGTH_LONG).show()
            return
        }

        val attempts = listOf(
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )
        Toast.makeText(this, "הפעילו: יהודי כשר — הגנת WhatsApp", Toast.LENGTH_LONG).show()
        for (intent in attempts) {
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (intent.resolveActivity(packageManager) == null) continue
            try {
                startActivity(intent)
                return
            } catch (_: Exception) {}
        }
        accessibilitySetupWindowOpen = false
        try { PolicyEnforcer(this).finishAccessibilitySetupWindow() } catch (_: Exception) {}
        Toast.makeText(this, "לא ניתן לפתוח את הגדרות הנגישות במכשיר זה", Toast.LENGTH_LONG).show()
    }

    // ---------------------------------------------------------------------
    // App Store - approved two-column card redesign
    // ---------------------------------------------------------------------

    private fun showAppStore() {
        isPersonalAreaActive = false
        isNewsActive = false
        headerLabelView.text = "חנות אפליקציות"
        setActiveNav(storeNavItem)
        contentArea.removeAllViews()

        if (!Config.storeAccessAllowed(this)) {
            renderLockedStore()
            return
        }

        val apps = approvedApps().sortedWith(compareBy<CatalogApp> { it.sortOrder }.thenBy { it.name })

        val searchWrap = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = cardBackground()
            setPadding(dp(14), dp(2), dp(14), dp(2))
        }
        val searchIcon = TextView(this).apply {
            text = "⌕"
            textSize = 24f
            setTextColor(Color.parseColor(ACCENT_DARK))
            gravity = Gravity.CENTER
        }
        val search = EditText(this).apply {
            hint = "חיפוש אפליקציות..."
            textSize = 14f
            setTextColor(Color.parseColor(TEXT))
            setHintTextColor(Color.parseColor(MUTED))
            setSingleLine(true)
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
            background = null
            setPadding(dp(8), dp(10), dp(8), dp(10))
            setText(storeSearchQuery)
            setSelection(text.length)
        }
        searchWrap.addView(searchIcon, LinearLayout.LayoutParams(dp(36), dp(48)))
        searchWrap.addView(search, LinearLayout.LayoutParams(0, dp(52), 1f))
        contentArea.addView(searchWrap, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            topMargin = dp(8)
            bottomMargin = dp(13)
        })

        val categories = linkedMapOf("all" to "הכל")
        apps.forEach { app ->
            if (app.category.isNotBlank() && app.category !in categories) {
                categories[app.category] = app.categoryLabel.ifBlank { "אחר" }
            }
        }
        if (selectedStoreCategory !in categories) selectedStoreCategory = "all"

        val categoryRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        categories.forEach { (key, label) ->
            val active = key == selectedStoreCategory
            categoryRow.addView(TextView(this).apply {
                text = label
                textSize = 12.5f
                typeface = if (active) heavyFont else mediumFont
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor(if (active) Color.WHITE.toHex() else TEXT))
                background = if (active) rounded(ACCENT, 22) else roundedBordered(CARD, BORDER, 22, 1)
                setPadding(dp(22), dp(9), dp(22), dp(9))
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    selectedStoreCategory = key
                    showAppStore()
                }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)).apply {
                marginEnd = dp(8)
            })
        }
        contentArea.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            addView(categoryRow)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)).apply {
            bottomMargin = dp(12)
        })

        val listContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        contentArea.addView(listContainer)

        fun render() = renderStoreContent(listContainer, apps)
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                storeSearchQuery = s?.toString().orEmpty()
                render()
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        render()
    }

    private fun renderStoreContent(container: LinearLayout, apps: List<CatalogApp>) {
        container.removeAllViews()
        val query = storeSearchQuery.trim().lowercase()
        val filtered = apps.filter { app ->
            val categoryMatches = selectedStoreCategory == "all" || app.category == selectedStoreCategory
            val textMatches = query.isEmpty() ||
                app.name.lowercase().contains(query) ||
                app.packageName.lowercase().contains(query) ||
                app.categoryLabel.lowercase().contains(query)
            categoryMatches && textMatches
        }.sortedWith(compareBy<CatalogApp> { it.sortOrder }.thenBy { it.name })

        if (filtered.isEmpty()) {
            container.addView(TextView(this).apply {
                text = if (apps.isEmpty()) "עדיין לא אושרו אפליקציות למכשיר זה" else "לא נמצאו אפליקציות תואמות"
                textSize = 14f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(0, dp(34), 0, dp(34))
            })
            return
        }

        if (selectedStoreCategory == "all" && query.isEmpty()) {
            val updates = filtered.filter { app ->
                val installed = isInstalled(app.packageName)
                installed && isUpdateAvailable(app, installed)
            }
            if (updates.isNotEmpty()) {
                addStoreSectionTitle(container, "עדכונים")
                addStoreGrid(container, updates)
            }
            val recommended = filtered.filter { it.isRecommended }
            if (recommended.isNotEmpty()) {
                addStoreSectionTitle(container, "מומלצות")
                addStoreGrid(container, recommended)
            }
        }

        // The approved mockup intentionally has no redundant “כל האפליקציות” heading.
        if (query.isNotEmpty()) addStoreSectionTitle(container, "תוצאות")
        else if (selectedStoreCategory != "all") {
            addStoreSectionTitle(container, filtered.firstOrNull()?.categoryLabel?.ifBlank { "אפליקציות" } ?: "אפליקציות")
        }
        addStoreGrid(container, filtered)
    }

    private fun addStoreSectionTitle(parent: LinearLayout, title: String) {
        parent.addView(TextView(this).apply {
            text = title
            textSize = 15f
            typeface = heavyFont
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
            setPadding(dp(2), dp(8), dp(2), dp(10))
        })
    }

    private fun addStoreGrid(parent: LinearLayout, apps: List<CatalogApp>) {
        apps.chunked(2).forEach { rowApps ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.TOP
            }
            rowApps.forEachIndexed { index, app ->
                row.addView(appTile(app), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    if (index == 0) marginEnd = dp(6) else marginStart = dp(6)
                })
            }
            if (rowApps.size == 1) row.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))
            parent.addView(row, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(13) })
        }
    }

    private fun approvedApps(): List<CatalogApp> {
        val allowed = Config.allowedApps(this).toSet()
        return Config.appCatalog(this).filter { it.packageName in allowed }
    }

    private fun appTile(app: CatalogApp): LinearLayout {
        val installed = isInstalled(app.packageName)
        val updateAvailable = isUpdateAvailable(app, installed)

        val icon = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            setImageResource(android.R.drawable.sym_def_app_icon)
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }
        loadIcon(app, installed, icon)

        val statusLabel = when {
            !installed -> "התקנה"
            updateAvailable -> "עדכן"
            else -> "✓  מותקן"
        }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = cardBackground()
            setPadding(dp(10), dp(15), dp(10), dp(10))
            isClickable = true
            isFocusable = true

            addView(icon, LinearLayout.LayoutParams(dp(82), dp(82)))
            addView(TextView(this@CustomerActivity).apply {
                text = app.name
                textSize = 13.5f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.CENTER
                maxLines = 2
                setPadding(dp(2), dp(9), dp(2), 0)
            })
            addView(TextView(this@CustomerActivity).apply {
                text = app.categoryLabel.ifBlank { "אפליקציה" }
                textSize = 11.5f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                maxLines = 1
                setPadding(dp(2), dp(3), dp(2), dp(10))
            })
            addView(TextView(this@CustomerActivity).apply {
                text = statusLabel
                textSize = 12.5f
                typeface = heavyFont
                setTextColor(Color.parseColor(if (installed && !updateAvailable) ACCENT_DARK else Color.WHITE.toHex()))
                gravity = Gravity.CENTER
                background = if (installed && !updateAvailable) rounded(ACCENT_TINT, 10) else rounded(ACCENT, 10)
                isClickable = !installed || updateAvailable
                isFocusable = !installed || updateAvailable
                if (!installed || updateAvailable) setOnClickListener { installApp(app) }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38)))

            setOnClickListener {
                if (installed) openInstalledApp(app.packageName) else installApp(app)
            }
        }
    }

    private fun isUpdateAvailable(app: CatalogApp, installed: Boolean): Boolean {
        if (!installed) return false
        return false
    }

    private fun isInstalled(packageName: String): Boolean {
        return try {
            val info = packageManager.getApplicationInfo(packageName, 0)
            if ((info.flags and ApplicationInfo.FLAG_INSTALLED) == 0 || !info.enabled) return false
            val enabledSetting = try {
                packageManager.getApplicationEnabledSetting(packageName)
            } catch (_: Exception) {
                PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
            }
            if (enabledSetting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED ||
                enabledSetting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER ||
                enabledSetting == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED) return false

            val dpm = getSystemService(DevicePolicyManager::class.java)
            if (dpm.isDeviceOwnerApp(this.packageName)) {
                val admin = ComponentName(this, DpcDeviceAdminReceiver::class.java)
                if (dpm.isApplicationHidden(admin, packageName)) return false
            }
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return false
            launchIntent.resolveActivity(packageManager) != null
        } catch (_: Exception) {
            false
        }
    }

    private fun openInstalledApp(packageName: String) {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        if (launchIntent != null) startActivity(launchIntent) else openPlayStoreForInstall(packageName)
    }

    private fun renderLockedStore() {
        val raw = Config.subscriptionExpiryDate(this)
        val expiryLabel = raw?.take(10)?.split('-')?.takeIf { it.size == 3 }
            ?.let { "${it[2]}/${it[1]}/${it[0]}" } ?: "תאריך המנוי"

        contentArea.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = cardBackground()
            setPadding(dp(24), dp(30), dp(24), dp(30))
            addView(TextView(this@CustomerActivity).apply {
                text = "▱"
                textSize = 38f
                setTextColor(Color.parseColor(GOLD))
                gravity = Gravity.CENTER
            })
            addView(TextView(this@CustomerActivity).apply {
                text = "חנות האפליקציות נעולה"
                textSize = 19f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.CENTER
                setPadding(0, dp(10), 0, dp(8))
            })
            addView(TextView(this@CustomerActivity).apply {
                text = "המנוי פג בתאריך $expiryLabel.\nכדי להוריד אפליקציות או לקבל עדכונים דרך החנות יש לחדש את המנוי.\n\nשאר המכשיר והאפליקציות שכבר מותקנות ממשיכים לעבוד כרגיל."
                textSize = 13.5f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
            })
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(20)
        })
    }

    private fun openPlayStoreForInstall(packageName: String) {
        if (!Config.storeAccessAllowed(this)) {
            Toast.makeText(this, "המנוי פג — חנות האפליקציות נעולה עד לחידוש", Toast.LENGTH_LONG).show()
            showAppStore()
            return
        }
        PlayStoreGate.openForInstall(this, packageName)
    }

    private fun installApp(app: CatalogApp) {
        if (!Config.storeAccessAllowed(this)) {
            Toast.makeText(this, "המנוי פג — הורדות ועדכונים נעולים עד לחידוש", Toast.LENGTH_LONG).show()
            showAppStore()
            return
        }
        if (app.appSource != "APK") {
            openPlayStoreForInstall(app.packageName)
            return
        }
        val apkUrl = app.apkUrl
        val apkSha256 = app.apkSha256
        if (apkUrl.isNullOrBlank() || apkSha256.isNullOrBlank()) {
            Toast.makeText(this, "קובץ ההתקנה אינו זמין כרגע", Toast.LENGTH_LONG).show()
            return
        }
        Toast.makeText(this, "מתחיל התקנה של ${app.name}", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                AppInstaller(applicationContext).installFromUrl(apkUrl, apkSha256)
                runOnUiThread {
                    Toast.makeText(this@CustomerActivity, "ההתקנה נשלחה למכשיר", Toast.LENGTH_LONG).show()
                    showAppStore()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this@CustomerActivity, "ההתקנה נכשלה: ${e.message ?: "שגיאה לא ידועה"}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun loadIcon(app: CatalogApp, installed: Boolean, target: ImageView) {
        if (installed) {
            try {
                val drawable = packageManager.getApplicationIcon(app.packageName)
                target.setImageDrawable(drawable)
                AppIconCache.save(this, app.packageName, drawable)
                return
            } catch (_: Exception) {}
        }
        AppIconCache.get(this, app.packageName)?.let { target.setImageBitmap(it) }
        val url = app.iconUrl ?: return
        Thread {
            val bitmap: Bitmap? = try {
                URL(url).openStream().use { BitmapFactory.decodeStream(it) }
            } catch (_: Exception) { null }
            if (bitmap != null && !isFinishing) runOnUiThread { target.setImageBitmap(bitmap) }
        }.start()
    }

    // ---------------------------------------------------------------------
    // Support - functionality preserved
    // ---------------------------------------------------------------------

    private fun showSupport() {
        isPersonalAreaActive = false
        isNewsActive = false
        headerLabelView.text = "תמיכה"
        setActiveNav(supportNavItem)
        contentArea.removeAllViews()

        contentArea.addView(TextView(this).apply {
            text = "צריכים עזרה? שלחו פנייה והיא תגיע ישירות לצוות התמיכה."
            textSize = 14f
            typeface = mediumFont
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.RIGHT
            setPadding(dp(3), dp(8), dp(3), dp(14))
        })

        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBackground()
            setPadding(dp(15), dp(15), dp(15), dp(15))
        }
        val subject = styledInput("נושא הפנייה", false)
        val message = styledInput("כתבו כאן במה אפשר לעזור...", true)
        val send = primaryButton("שליחת פנייה") {}
        form.addView(subject, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(10) })
        form.addView(message, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) })
        form.addView(send)
        contentArea.addView(form)

        val historyTitle = sectionTitle("הפניות שלי")
        val history = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        contentArea.addView(historyTitle)
        contentArea.addView(history)

        fun loadTickets() {
            history.removeAllViews()
            history.addView(loadingText("טוען פניות..."))
            val deviceId = Config.deviceId(this)
            val serverUrl = Config.serverUrl(this)
            val token = Config.deviceToken(this)
            Thread {
                try {
                    val tickets = ApiClient(serverUrl, token).fetchSupportTickets(deviceId)
                    runOnUiThread { renderSupportTickets(history, tickets) }
                } catch (_: Exception) {
                    runOnUiThread {
                        history.removeAllViews()
                        history.addView(loadingText("לא ניתן לטעון כרגע את הפניות. נסו שוב מאוחר יותר."))
                    }
                }
            }.start()
        }

        send.setOnClickListener {
            val subjectText = subject.text.toString().trim()
            val messageText = message.text.toString().trim()
            if (subjectText.isEmpty() || messageText.isEmpty()) {
                Toast.makeText(this, "יש למלא נושא ותוכן", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (subjectText.length > 120 || messageText.length > 5000) {
                Toast.makeText(this, "הפנייה ארוכה מדי", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            send.isEnabled = false
            send.text = "שולח..."
            val deviceId = Config.deviceId(this)
            val serverUrl = Config.serverUrl(this)
            val token = Config.deviceToken(this)
            Thread {
                try {
                    ApiClient(serverUrl, token).createSupportTicket(deviceId, subjectText, messageText)
                    runOnUiThread {
                        subject.text.clear()
                        message.text.clear()
                        send.isEnabled = true
                        send.text = "שליחת פנייה"
                        Toast.makeText(this, "הפנייה נשלחה בהצלחה", Toast.LENGTH_LONG).show()
                        loadTickets()
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        send.isEnabled = true
                        send.text = "שליחת פנייה"
                        Toast.makeText(this, "שליחת הפנייה נכשלה: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                }
            }.start()
        }
        loadTickets()
    }

    private fun renderSupportTickets(container: LinearLayout, tickets: List<SupportTicket>) {
        container.removeAllViews()
        if (tickets.isEmpty()) {
            container.addView(loadingText("עדיין לא נשלחו פניות"))
            return
        }
        tickets.forEach { ticket ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = cardBackground()
                setPadding(dp(14), dp(14), dp(14), dp(14))
            }
            val statusText = when (ticket.status) {
                "RESOLVED" -> "טופל"
                "IN_PROGRESS" -> "בטיפול"
                else -> "חדש"
            }
            card.addView(TextView(this).apply {
                text = "${ticket.subject}  ·  $statusText"
                textSize = 15f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
            })
            val chat = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = rounded(CARD_SOFT, 14)
                setPadding(dp(9), dp(9), dp(9), dp(9))
            }
            fun addBubble(message: String, sender: String, whenIso: String, mine: Boolean) {
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = if (mine) Gravity.RIGHT else Gravity.LEFT
                }
                row.addView(TextView(this).apply {
                    text = "$sender\n$message\n${formatUpdateDate(whenIso)}"
                    textSize = 13f
                    typeface = mediumFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                    background = rounded(if (mine) ACCENT_TINT else CARD, 14)
                    setPadding(dp(11), dp(9), dp(11), dp(8))
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.84f))
                chat.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(7) })
            }
            addBubble(ticket.message, "אתם", ticket.createdAt, true)
            ticket.adminReply?.takeIf { it.isNotBlank() }?.let {
                addBubble(it, "תמיכה — יהודי כשר", ticket.updatedAt, false)
            }
            card.addView(chat, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(11) })
            container.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(11) })
        }
    }

    // ---------------------------------------------------------------------
    // Admin login - functionality preserved
    // ---------------------------------------------------------------------

    private fun showAdminLogin() {
        isPersonalAreaActive = false
        isNewsActive = false
        headerLabelView.text = "כניסת מנהל"
        setActiveNav(adminNavItem)
        contentArea.removeAllViews()

        val hasPin = Config.hasAdminPin(this)
        contentArea.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = cardBackground()
            setPadding(dp(22), dp(30), dp(22), dp(30))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(22) }

            addView(TextView(this@CustomerActivity).apply {
                text = "▱"
                textSize = 30f
                typeface = heavyFont
                setTextColor(Color.parseColor(ACCENT_DARK))
                gravity = Gravity.CENTER
                background = circle(ACCENT_TINT)
            }, LinearLayout.LayoutParams(dp(62), dp(62)))

            addView(TextView(this@CustomerActivity).apply {
                text = if (hasPin) "כניסת מנהל" else "הגדרת קוד מנהל"
                textSize = 18f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.CENTER
                setPadding(0, dp(16), 0, dp(5))
            })
            addView(TextView(this@CustomerActivity).apply {
                text = if (hasPin) "הכנס את קוד המנהל כדי להמשיך" else "בחר קוד מנהל חדש בן 4 ספרות לפחות"
                textSize = 12.5f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.CENTER
                setPadding(0, 0, 0, dp(18))
            })
            val input = EditText(this@CustomerActivity).apply {
                hint = if (hasPin) "קוד מנהל" else "קוד חדש"
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
                setSingleLine()
                textSize = 19f
                typeface = heavyFont
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor(TEXT))
                background = roundedBordered(CARD_SOFT, BORDER, 13, 1)
                setPadding(dp(14), dp(12), dp(14), dp(12))
            }
            addView(input, LinearLayout.LayoutParams(dp(180), ViewGroup.LayoutParams.WRAP_CONTENT))
            val button = primaryButton(if (hasPin) "היכנס" else "שמור והמשך") {
                val pin = input.text.toString()
                if (!hasPin) {
                    if (pin.length < 4) {
                        Toast.makeText(this@CustomerActivity, "הקוד חייב להכיל לפחות 4 ספרות", Toast.LENGTH_SHORT).show()
                        return@primaryButton
                    }
                    Config.setAdminPin(this@CustomerActivity, pin)
                    AdminAccess.grant()
                    startActivity(Intent(this@CustomerActivity, MainActivity::class.java))
                } else if (Config.checkAdminPin(this@CustomerActivity, pin)) {
                    AdminAccess.grant()
                    startActivity(Intent(this@CustomerActivity, MainActivity::class.java))
                } else {
                    Toast.makeText(this@CustomerActivity, "קוד שגוי", Toast.LENGTH_SHORT).show()
                }
            }
            addView(button, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)).apply { topMargin = dp(16) })
        })
    }

    // ---------------------------------------------------------------------
    // DNS - functionality preserved
    // ---------------------------------------------------------------------

    private fun dnsToggleCard(): LinearLayout {
        val allowToggle = Config.dnsAllowCustomerToggle(this)
        val actualOn = AdBlockDns.currentStatus(this).dnsFilteringActual
        val providerFilters = Config.dnsDesiredProviderFilters(this)
        lateinit var switchView: Switch

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBackground()
            setPadding(dp(16), dp(14), dp(16), dp(14))
            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                addView(ImageView(this@CustomerActivity).apply {
                    setImageResource(R.drawable.ic_row_shield)
                    scaleType = ImageView.ScaleType.CENTER_INSIDE
                    setColorFilter(Color.parseColor(ACCENT_DARK), PorterDuff.Mode.SRC_IN)
                }, LinearLayout.LayoutParams(dp(20), dp(20)).apply { marginEnd = dp(10) })
                addView(TextView(this@CustomerActivity).apply {
                    text = if (providerFilters) "חסימת אתרים ופרסומות" else "DNS מאובטח"
                    textSize = 14.5f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                switchView = Switch(this@CustomerActivity).apply {
                    isChecked = actualOn
                    isEnabled = allowToggle
                }
                addView(switchView)
            })
            addView(TextView(this@CustomerActivity).apply {
                text = when {
                    !allowToggle -> "ההגדרה מנוהלת על ידי מנהל המערכת"
                    !providerFilters -> "מצפין את תעבורת ה-DNS, אך הספק הנוכחי אינו חוסם תוכן"
                    else -> "ניתן להפעיל ולכבות בעצמך"
                }
                textSize = 11.5f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                setPadding(0, dp(4), 0, 0)
            })
        }

        switchView.setOnCheckedChangeListener { _, isChecked ->
            if (!allowToggle) return@setOnCheckedChangeListener
            switchView.isEnabled = false
            Thread {
                Config.setDnsPendingCustomerRequest(applicationContext, isChecked)
                if (isChecked) {
                    Config.dnsDesiredProviderHost(applicationContext)?.let { AdBlockDns.enable(applicationContext, it) }
                } else {
                    AdBlockDns.disable(applicationContext)
                }
                val syncFailed = try {
                    PolicySync.run(applicationContext)
                    false
                } catch (_: Exception) { true }
                val status = AdBlockDns.currentStatus(applicationContext)
                val message = when {
                    status.dnsFilteringActual == isChecked -> if (isChecked) "סינון DNS הופעל" else "סינון DNS כובה (עבר ל-Opportunistic)"
                    syncFailed -> "הבקשה נשמרה במכשיר - תושלם בשרת כשהחיבור יחזור"
                    else -> "הפעולה לא הושלמה - נסה שוב"
                }
                runOnUiThread {
                    Toast.makeText(this@CustomerActivity, message, Toast.LENGTH_LONG).show()
                    refreshPersonalAreaIfShown()
                }
            }.start()
        }
        return card
    }

    private fun dnsModeLabel(mode: DnsMode): String = when (mode) {
        DnsMode.PROVIDER_HOSTNAME -> "מסונן (Strict)"
        DnsMode.OPPORTUNISTIC -> "Opportunistic"
        DnsMode.OFF -> "כבוי"
        DnsMode.UNKNOWN -> "לא ידוע"
        DnsMode.ERROR -> "שגיאת קריאה"
    }

    private fun refreshPersonalAreaIfShown() {
        if (isPersonalAreaActive) showPersonalArea()
    }

    // ---------------------------------------------------------------------
    // News - functionality preserved
    // ---------------------------------------------------------------------

    private fun showNews() {
        isPersonalAreaActive = false
        isNewsActive = true
        headerLabelView.text = "חדשות ועדכונים"
        setActiveNav(newsNavItem)
        renderNewsList()
        refreshNews()
    }

    private fun renderNewsList() {
        contentArea.removeAllViews()
        if (newsItems.isEmpty()) {
            contentArea.addView(loadingText("אין עדכונים כרגע"))
            return
        }
        newsItems.forEach { item -> contentArea.addView(newsCard(item)) }
    }

    private fun refreshNews() {
        val deviceId = Config.deviceId(this)
        val serverUrl = Config.serverUrl(this)
        val deviceToken = Config.deviceToken(this)
        Thread {
            try {
                val fetched = ApiClient(serverUrl, deviceToken).fetchUpdates(deviceId)
                Config.setNewsCache(applicationContext, fetched)
                runOnUiThread {
                    newsItems = fetched
                    updateNewsBadge()
                    if (isNewsActive) renderNewsList()
                }
            } catch (_: Exception) {}
        }.start()
    }

    private fun updateNewsBadge() {
        val hasUnread = newsItems.any { !Config.isUpdateRead(this, it.id) }
        newsNavItem.badge.visibility = if (hasUnread) View.VISIBLE else View.GONE
    }

    private fun showNewsDetail(item: UpdateItem) {
        Config.markUpdateRead(this, item.id)
        updateNewsBadge()
        contentArea.removeAllViews()
        contentArea.addView(TextView(this).apply {
            text = "→ חזרה"
            textSize = 13f
            typeface = mediumFont
            setTextColor(Color.parseColor(ACCENT))
            gravity = Gravity.RIGHT
            setPadding(dp(2), 0, dp(2), dp(16))
            isClickable = true
            setOnClickListener { showNews() }
        })
        if (item.pinned) contentArea.addView(newsBadge("★ חשוב", "#F8ECD1", "#956A20"))
        contentArea.addView(TextView(this).apply {
            text = item.title
            textSize = 19f
            typeface = heavyFont
            setTextColor(Color.parseColor(TEXT))
            gravity = Gravity.RIGHT
            setPadding(0, dp(8), 0, dp(5))
        })
        contentArea.addView(TextView(this).apply {
            text = formatUpdateDate(item.publishedAt)
            textSize = 12f
            typeface = mediumFont
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.RIGHT
            setPadding(0, 0, 0, dp(15))
        })
        val detailCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBackground()
            setPadding(dp(15), dp(14), dp(15), dp(13))
            addView(TextView(this@CustomerActivity).apply {
                text = item.body
                textSize = 14.5f
                typeface = mediumFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
                setLineSpacing(dp(3).toFloat(), 1f)
            })
        }
        addNewsMedia(detailCard, item, true)
        contentArea.addView(detailCard)
    }

    private fun newsCard(item: UpdateItem): LinearLayout {
        val isRead = Config.isUpdateRead(this, item.id)
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBackground()
            setPadding(dp(15), dp(14), dp(15), dp(14))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(11) }
            isClickable = true
            addView(LinearLayout(this@CustomerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                addView(TextView(this@CustomerActivity).apply {
                    text = item.title
                    textSize = 15f
                    typeface = heavyFont
                    setTextColor(Color.parseColor(TEXT))
                    gravity = Gravity.RIGHT
                    maxLines = 2
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                if (!isRead) addView(newsBadge("חדש", ACCENT_TINT, ACCENT))
                if (item.pinned) addView(newsBadge("★", "#F8ECD1", "#956A20"))
            })
            addView(TextView(this@CustomerActivity).apply {
                text = item.body
                textSize = 13f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                maxLines = 3
                ellipsize = android.text.TextUtils.TruncateAt.END
                setPadding(0, dp(6), 0, 0)
            })
            addNewsMedia(this, item, false)
            addView(TextView(this@CustomerActivity).apply {
                text = formatUpdateDate(item.publishedAt)
                textSize = 11f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.LEFT
                setPadding(0, dp(7), 0, 0)
            })
            setOnClickListener { showNewsDetail(item) }
        }
    }

    private fun addNewsMedia(container: LinearLayout, item: UpdateItem, detail: Boolean) {
        val mediaUrl = item.mediaUrl?.takeIf { it.startsWith("https://") || it.startsWith("http://") } ?: return
        when (item.mediaType) {
            "IMAGE" -> {
                val image = ImageView(this).apply {
                    adjustViewBounds = true
                    minimumHeight = dp(if (detail) 260 else 170)
                    scaleType = ImageView.ScaleType.FIT_CENTER
                    setBackgroundColor(Color.parseColor(CARD_SOFT))
                    setPadding(dp(4), dp(4), dp(4), dp(4))
                }
                container.addView(image, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
                Thread {
                    val bitmap = loadNewsImageSafely(mediaUrl)
                    if (bitmap != null && !isFinishing) runOnUiThread { image.setImageBitmap(bitmap) }
                }.start()
            }
            "VIDEO" -> {
                if (!detail) {
                    container.addView(TextView(this).apply {
                        text = "▶ סרטון מצורף · לחץ לצפייה"
                        textSize = 12.5f
                        typeface = mediumFont
                        setTextColor(Color.parseColor(ACCENT))
                        gravity = Gravity.RIGHT
                        background = rounded(ACCENT_TINT, 11)
                        setPadding(dp(11), dp(8), dp(11), dp(8))
                    }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
                    return
                }
                val play = TextView(this).apply {
                    text = "▶ נגן סרטון"
                    textSize = 13.5f
                    typeface = heavyFont
                    setTextColor(Color.WHITE)
                    gravity = Gravity.CENTER
                    background = rounded(ACCENT, 12)
                    setPadding(dp(13), dp(11), dp(13), dp(11))
                    isClickable = true
                }
                container.addView(play, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
                play.setOnClickListener {
                    play.isEnabled = false
                    play.text = "טוען סרטון..."
                    val video = VideoView(this@CustomerActivity).apply {
                        val controller = MediaController(this@CustomerActivity)
                        controller.setAnchorView(this)
                        setMediaController(controller)
                        setVideoURI(Uri.parse(mediaUrl))
                        setOnPreparedListener {
                            play.visibility = View.GONE
                            start()
                        }
                        setOnErrorListener { _, _, _ ->
                            play.isEnabled = true
                            play.visibility = View.VISIBLE
                            play.text = "▶ נסה שוב"
                            Toast.makeText(this@CustomerActivity, "לא ניתן לנגן את הסרטון כרגע", Toast.LENGTH_LONG).show()
                            true
                        }
                    }
                    container.addView(video, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(240)).apply { topMargin = dp(9) })
                    video.requestFocus()
                }
            }
        }
    }

    private fun loadNewsImageSafely(url: String): Bitmap? {
        val conn = (URL(url).openConnection() as? HttpURLConnection) ?: return null
        return try {
            conn.connectTimeout = 20_000
            conn.readTimeout = 60_000
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("Accept", "image/*")
            conn.setRequestProperty("User-Agent", "YehudiKasher-Android")
            val code = conn.responseCode
            if (code !in 200..299) return null
            val declared = conn.contentLengthLong
            if (declared > 10L * 1024L * 1024L) return null
            val bytes = conn.inputStream.use { input ->
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                var total = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > 10 * 1024 * 1024) return null
                    out.write(buffer, 0, read)
                }
                out.toByteArray()
            }
            if (bytes.isEmpty()) null else BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }

    private fun newsBadge(text: String, bg: String, fg: String): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = 10.5f
            typeface = mediumFont
            setTextColor(Color.parseColor(fg))
            background = rounded(bg, 10)
            setPadding(dp(8), dp(3), dp(8), dp(3))
            gravity = Gravity.CENTER
        }
    }

    // ---------------------------------------------------------------------
    // Shared helpers
    // ---------------------------------------------------------------------

    private fun styledInput(hintText: String, multiLine: Boolean): EditText {
        return EditText(this).apply {
            hint = hintText
            textSize = 14f
            setTextColor(Color.parseColor(TEXT))
            setHintTextColor(Color.parseColor(MUTED))
            gravity = if (multiLine) Gravity.TOP or Gravity.RIGHT else Gravity.CENTER_VERTICAL or Gravity.RIGHT
            inputType = if (multiLine) {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            } else InputType.TYPE_CLASS_TEXT
            if (!multiLine) setSingleLine(true) else {
                minLines = 5
                maxLines = 10
            }
            background = rounded(CARD_SOFT, 12)
            setPadding(dp(13), dp(11), dp(13), dp(11))
        }
    }

    private fun loadingText(textValue: String): TextView {
        return TextView(this).apply {
            text = textValue
            textSize = 14f
            typeface = mediumFont
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(28), dp(8), dp(28))
        }
    }

    private fun primaryButton(label: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            text = label
            textSize = 14.5f
            isAllCaps = false
            typeface = heavyFont
            setTextColor(Color.WHITE)
            background = rounded(ACCENT, 14)
            setOnClickListener { onClick() }
        }
    }

    private fun sectionTitle(title: String): TextView {
        return TextView(this).apply {
            text = title
            textSize = 13.5f
            typeface = mediumFont
            setTextColor(Color.parseColor(MUTED))
            gravity = Gravity.RIGHT
            setPadding(dp(3), dp(18), dp(3), dp(9))
        }
    }

    private fun compactSubscriptionDate(raw: String): String {
        return try {
            java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy")
                .withZone(java.time.ZoneId.systemDefault())
                .format(java.time.Instant.parse(raw))
        } catch (_: Exception) {
            raw.take(10).split('-').let { parts ->
                if (parts.size == 3) "${parts[2]}/${parts[1]}/${parts[0]}" else raw
            }
        }
    }

    private fun lastSyncLabelCompact(): String {
        val last = Config.lastSyncAt(this)
        if (last == 0L) return "טרם סונכרן"
        val minutes = ((System.currentTimeMillis() - last) / 60000).toInt()
        return when {
            minutes < 1 -> "הרגע"
            minutes < 60 -> "לפני $minutes דקות"
            else -> "לפני ${minutes / 60} שעות"
        }
    }

    private fun refreshLastSyncLabelIfShown() {
        if (isPersonalAreaActive) showPersonalArea()
    }

    private fun formatUpdateDate(iso: String): String {
        return try {
            val millis = Instant.parse(iso).toEpochMilli()
            SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("he", "IL")).format(java.util.Date(millis))
        } catch (_: Exception) { iso }
    }

    private fun cardBackground(): GradientDrawable = roundedBordered(CARD, BORDER, 17, 1)

    private fun featuredCardBackground(): GradientDrawable {
        return GradientDrawable().apply {
            orientation = GradientDrawable.Orientation.TL_BR
            colors = intArrayOf(
                Color.parseColor("#F8F7EE"),
                Color.parseColor("#EEF1DF"),
                Color.parseColor("#FFFDFC")
            )
            cornerRadius = dp(18).toFloat()
            setStroke(dp(1), Color.parseColor("#E3DCCB"))
        }
    }

    private fun circle(color: String): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor(color))
        }
    }

    private fun rounded(color: String, radiusDp: Int): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(color))
            cornerRadius = dp(radiusDp).toFloat()
        }
    }

    private fun roundedBordered(fill: String, border: String, radiusDp: Int, strokeDp: Int): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(fill))
            cornerRadius = dp(radiusDp).toFloat()
            setStroke(dp(strokeDp), Color.parseColor(border))
        }
    }

    private fun Int.toHex(): String = String.format("#%06X", 0xFFFFFF and this)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
