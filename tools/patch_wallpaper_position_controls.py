from pathlib import Path

wp = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/WallpaperBranding.kt')
s = wp.read_text()
s = s.replace(
    '    private const val KEY_LOCK_SIZE_PERCENT = "customer_branding_lock_size_percent"\n    const val MIN_SIZE_PERCENT = 10\n',
    '    private const val KEY_LOCK_SIZE_PERCENT = "customer_branding_lock_size_percent"\n'
    '    private const val KEY_HOME_TOP_PERCENT = "customer_branding_home_top_percent"\n'
    '    private const val KEY_LOCK_TOP_PERCENT = "customer_branding_lock_top_percent"\n'
    '    const val MIN_SIZE_PERCENT = 10\n'
)
s = s.replace(
    '    const val DEFAULT_SIZE_PERCENT = 30\n',
    '    const val DEFAULT_SIZE_PERCENT = 30\n'
    '    const val MIN_TOP_PERCENT = 5\n'
    '    const val MAX_TOP_PERCENT = 75\n'
    '    const val DEFAULT_TOP_PERCENT = 28\n'
)
marker = '''    fun lockSizePercent(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt(KEY_LOCK_SIZE_PERCENT, DEFAULT_SIZE_PERCENT)
            .coerceIn(MIN_SIZE_PERCENT, MAX_SIZE_PERCENT)
'''
if 'fun homeTopPercent(context: Context)' not in s:
    s = s.replace(marker, marker + '''
    fun homeTopPercent(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt(KEY_HOME_TOP_PERCENT, DEFAULT_TOP_PERCENT)
            .coerceIn(MIN_TOP_PERCENT, MAX_TOP_PERCENT)

    fun lockTopPercent(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt(KEY_LOCK_TOP_PERCENT, DEFAULT_TOP_PERCENT)
            .coerceIn(MIN_TOP_PERCENT, MAX_TOP_PERCENT)
''')
size_method = '''    @Synchronized
    fun setSizePercents(context: Context, homePercent: Int, lockPercent: Int): String {
        val home = homePercent.coerceIn(MIN_SIZE_PERCENT, MAX_SIZE_PERCENT)
        val lock = lockPercent.coerceIn(MIN_SIZE_PERCENT, MAX_SIZE_PERCENT)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putInt(KEY_HOME_SIZE_PERCENT, home)
            .putInt(KEY_LOCK_SIZE_PERCENT, lock)
            .remove(KEY_RECIPE_VERSION)
            .commit()
        return if (isEnabled(context)) {
            apply(context)
        } else {
            "Android ${Build.VERSION.RELEASE} · גודל הסמל נשמר: בית $home% · נעילה $lock%"
        }
    }
'''
if 'fun setTopPercents(context: Context' not in s:
    s = s.replace(size_method, size_method + '''
    @Synchronized
    fun setTopPercents(context: Context, homePercent: Int, lockPercent: Int): String {
        val home = homePercent.coerceIn(MIN_TOP_PERCENT, MAX_TOP_PERCENT)
        val lock = lockPercent.coerceIn(MIN_TOP_PERCENT, MAX_TOP_PERCENT)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putInt(KEY_HOME_TOP_PERCENT, home)
            .putInt(KEY_LOCK_TOP_PERCENT, lock)
            .remove(KEY_RECIPE_VERSION)
            .commit()
        return if (isEnabled(context)) {
            apply(context)
        } else {
            "Android ${Build.VERSION.RELEASE} · מיקום הסמל נשמר: בית $home% · נעילה $lock%"
        }
    }
''')
s = s.replace(
    '            val brandedHome = compositeEmblem(homeOriginal, emblem, homeSizePercent(context) / 100f)\n            val brandedLock = compositeEmblem(lockOriginal, emblem, lockSizePercent(context) / 100f)\n',
    '            val brandedHome = compositeEmblem(homeOriginal, emblem, homeSizePercent(context) / 100f, homeTopPercent(context) / 100f)\n'
    '            val brandedLock = compositeEmblem(lockOriginal, emblem, lockSizePercent(context) / 100f, lockTopPercent(context) / 100f)\n'
)
s = s.replace(
    '    private fun compositeEmblem(background: Bitmap, emblem: Bitmap, widthFraction: Float): CompositeResult {\n',
    '    private fun compositeEmblem(background: Bitmap, emblem: Bitmap, widthFraction: Float, topFraction: Float): CompositeResult {\n'
)
s = s.replace(
    '        val top = result.height * 0.28f\n',
    '        val requestedTop = result.height * topFraction.coerceIn(MIN_TOP_PERCENT / 100f, MAX_TOP_PERCENT / 100f)\n'
    '        val maxTop = (result.height - targetHeight).coerceAtLeast(0f)\n'
    '        val top = requestedTop.coerceIn(0f, maxTop)\n'
)
wp.write_text(s)

ca = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = ca.read_text()
old = '''        contentArea.addView(whatsAppFeaturedCard(), LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(14) })

        contentArea.addView(sectionTitle("סמל יהודי כשר ברקע"))
        contentArea.addView(wallpaperBrandingToggleCard())
'''
new = '''        contentArea.addView(sectionTitle("סמל יהודי כשר ברקע"))
        contentArea.addView(wallpaperBrandingToggleCard())

        contentArea.addView(whatsAppFeaturedCard(), LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(14) })
'''
if old in s:
    s = s.replace(old, new)
s = s.replace(
    '        var lockPercent = WallpaperBranding.lockSizePercent(this)\n        val enabledAtStart = WallpaperBranding.isEnabled(this)\n',
    '        var lockPercent = WallpaperBranding.lockSizePercent(this)\n'
    '        var homeTopPercent = WallpaperBranding.homeTopPercent(this)\n'
    '        var lockTopPercent = WallpaperBranding.lockTopPercent(this)\n'
    '        val enabledAtStart = WallpaperBranding.isEnabled(this)\n'
)
s = s.replace(
    '        val lockValue = TextView(this).apply {\n            text = "$lockPercent%"\n            textSize = 12.5f\n            typeface = heavyFont\n            setTextColor(Color.parseColor(ACCENT_DARK))\n        }\n',
    '        val lockValue = TextView(this).apply {\n            text = "$lockPercent%"\n            textSize = 12.5f\n            typeface = heavyFont\n            setTextColor(Color.parseColor(ACCENT_DARK))\n        }\n'
    '        val homeTopValue = TextView(this).apply {\n            text = "$homeTopPercent%"\n            textSize = 12.5f\n            typeface = heavyFont\n            setTextColor(Color.parseColor(ACCENT_DARK))\n        }\n'
    '        val lockTopValue = TextView(this).apply {\n            text = "$lockTopPercent%"\n            textSize = 12.5f\n            typeface = heavyFont\n            setTextColor(Color.parseColor(ACCENT_DARK))\n        }\n'
)
anchor = '''        val homeControl = makeSizeControl("גודל הסמל במסך הבית", homePercent, homeValue) { homePercent = it }
        val lockControl = makeSizeControl("גודל הסמל במסך הנעילה", lockPercent, lockValue) { lockPercent = it }
        val homeSeek = homeControl.tag as SeekBar
        val lockSeek = lockControl.tag as SeekBar
'''
if 'makeTopControl(' not in s:
    s = s.replace(anchor, anchor + '''
        fun makeTopControl(title: String, initial: Int, valueView: TextView, onValue: (Int) -> Unit): LinearLayout {
            val seek = SeekBar(this).apply {
                max = WallpaperBranding.MAX_TOP_PERCENT - WallpaperBranding.MIN_TOP_PERCENT
                progress = initial - WallpaperBranding.MIN_TOP_PERCENT
                isEnabled = enabledAtStart
            }
            seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    val value = WallpaperBranding.MIN_TOP_PERCENT + progress
                    valueView.text = "$value%"
                    onValue(value)
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) {
                    if (!WallpaperBranding.isEnabled(this@CustomerActivity)) return
                    val currentHome = homeTopPercent
                    val currentLock = lockTopPercent
                    Thread {
                        val result = WallpaperBranding.setTopPercents(applicationContext, currentHome, currentLock)
                        runOnUiThread { Toast.makeText(this@CustomerActivity, result, Toast.LENGTH_SHORT).show() }
                    }.start()
                }
            })
            return LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, dp(8), 0, dp(2))
                addView(LinearLayout(this@CustomerActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    addView(TextView(this@CustomerActivity).apply {
                        text = title
                        textSize = 13f
                        typeface = mediumFont
                        setTextColor(Color.parseColor(TEXT))
                        gravity = Gravity.RIGHT
                    }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                    addView(valueView)
                })
                addView(seek, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                tag = seek
            }
        }

        val homeTopControl = makeTopControl("מיקום הסמל למעלה / למטה במסך הבית", homeTopPercent, homeTopValue) { homeTopPercent = it }
        val lockTopControl = makeTopControl("מיקום הסמל למעלה / למטה במסך הנעילה", lockTopPercent, lockTopValue) { lockTopPercent = it }
        val homeTopSeek = homeTopControl.tag as SeekBar
        val lockTopSeek = lockTopControl.tag as SeekBar
''')
s = s.replace(
    '                    homeSeek.isEnabled = enabled\n                    lockSeek.isEnabled = enabled\n',
    '                    homeSeek.isEnabled = enabled\n                    lockSeek.isEnabled = enabled\n                    homeTopSeek.isEnabled = enabled\n                    lockTopSeek.isEnabled = enabled\n'
)
s = s.replace(
    '            addView(homeControl)\n            addView(lockControl)\n',
    '            addView(homeControl)\n            addView(lockControl)\n            addView(homeTopControl)\n            addView(lockTopControl)\n'
)
ca.write_text(s)

test = Path('backend/test-wallpaper-branding-toggle-static.js')
s = test.read_text()
if 'KEY_HOME_TOP_PERCENT' not in s:
    s = s.replace("console.log('wallpaper branding customer toggle wiring: ok');", '''
assert(wallpaper.includes('KEY_HOME_TOP_PERCENT = "customer_branding_home_top_percent"'));
assert(wallpaper.includes('KEY_LOCK_TOP_PERCENT = "customer_branding_lock_top_percent"'));
assert(wallpaper.includes('const val MIN_TOP_PERCENT = 5'));
assert(wallpaper.includes('const val MAX_TOP_PERCENT = 75'));
assert(wallpaper.includes('fun setTopPercents(context: Context, homePercent: Int, lockPercent: Int): String'));
assert(customer.includes('מיקום הסמל למעלה / למטה במסך הבית'));
assert(customer.includes('מיקום הסמל למעלה / למטה במסך הנעילה'));
console.log('wallpaper branding customer toggle wiring: ok');''')
test.write_text(s)
