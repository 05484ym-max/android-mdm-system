from pathlib import Path
import re

path = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
text = path.read_text(encoding='utf-8')

pattern = re.compile(
    r'    private fun showPersonalArea\(\) \{.*?(?=\n    /\*\* Header row with the on/off switch)',
    re.S,
)

replacement = r'''    private fun showPersonalArea() {
        isPersonalAreaActive = true
        isNewsActive = false
        headerLabelView.text = "אזור אישי"
        setActiveNav(personalNavItem)
        contentArea.removeAllViews()

        // Keep the same visual language, but avoid stacking large cards that
        // repeat the same information or show placeholders the device does not
        // actually know. The customer screen should be a quick status glance;
        // deep DNS diagnostics stay in the admin/health surfaces.
        contentArea.addView(compactPersonalIdentityCard())

        val expiry = Config.subscriptionExpiryDate(this)
        val subscriptionRows = mutableListOf<Triple<String, String, String>>()
        subscriptionRows += Triple(
            "✓",
            "מצב המנוי",
            if (Config.storeAccessAllowed(this)) "פעיל" else "פג תוקף"
        )
        if (!expiry.isNullOrBlank()) {
            subscriptionRows += Triple("◷", "תוקף המנוי", compactSubscriptionDate(expiry))
        }
        contentArea.addView(sectionTitle("המנוי שלי"))
        contentArea.addView(compactInfoRowCard(subscriptionRows))

        contentArea.addView(sectionTitle("המכשיר שלי"))
        contentArea.addView(
            compactInfoRowCard(
                listOf(
                    Triple("#", "מזהה מכשיר", Config.deviceId(this)),
                    Triple("↻", "עדכון אחרון", lastSyncLabel()),
                )
            )
        )

        contentArea.addView(sectionTitle("סינון DNS"))
        contentArea.addView(dnsToggleCard())
        val dnsStatus = AdBlockDns.currentStatus(this)
        contentArea.addView(
            compactInfoRowCard(
                listOf(
                    Triple("◈", "מצב הסינון", dnsModeLabel(dnsStatus.dnsMode))
                )
            )
        )
    }

    private fun compactPersonalIdentityCard(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = roundedCardWithBorder()
        setPadding(dp(14), dp(12), dp(14), dp(12))
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            topMargin = dp(8)
            bottomMargin = dp(8)
        }

        addView(TextView(this@CustomerActivity).apply {
            text = "י"
            textSize = 15f
            typeface = heavyFont
            setTextColor(Color.parseColor(ACCENT))
            gravity = Gravity.CENTER
            background = flatCircle(ACCENT_TINT)
        }, LinearLayout.LayoutParams(dp(42), dp(42)).apply { marginEnd = dp(10) })

        addView(LinearLayout(this@CustomerActivity).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(this@CustomerActivity).apply {
                text = "יהודי כשר"
                textSize = 15f
                typeface = heavyFont
                setTextColor(Color.parseColor(TEXT))
                gravity = Gravity.RIGHT
            })
            addView(TextView(this@CustomerActivity).apply {
                text = "האזור האישי שלך"
                textSize = 11.5f
                typeface = mediumFont
                setTextColor(Color.parseColor(MUTED))
                gravity = Gravity.RIGHT
                setPadding(0, dp(2), 0, 0)
            })
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun compactInfoRowCard(rows: List<Triple<String, String, String>>): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedCardWithBorder()
            setPadding(dp(14), dp(5), dp(14), dp(5))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }

            rows.forEachIndexed { index, row ->
                val (icon, label, value) = row
                addView(LinearLayout(this@CustomerActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(0, dp(8), 0, dp(8))

                    addView(TextView(this@CustomerActivity).apply {
                        text = icon
                        textSize = 13f
                        typeface = heavyFont
                        setTextColor(Color.parseColor(ACCENT))
                        gravity = Gravity.CENTER
                        background = flatCircle(ACCENT_TINT)
                    }, LinearLayout.LayoutParams(dp(34), dp(34)).apply { marginEnd = dp(10) })

                    addView(LinearLayout(this@CustomerActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        addView(TextView(this@CustomerActivity).apply {
                            text = label
                            textSize = 11.5f
                            typeface = mediumFont
                            setTextColor(Color.parseColor(MUTED))
                            gravity = Gravity.RIGHT
                        })
                        addView(TextView(this@CustomerActivity).apply {
                            text = value
                            textSize = 14f
                            typeface = heavyFont
                            setTextColor(Color.parseColor(TEXT))
                            gravity = Gravity.RIGHT
                            maxLines = 2
                        })
                    }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                })

                if (index < rows.lastIndex) {
                    addView(View(this@CustomerActivity).apply {
                        setBackgroundColor(Color.parseColor(BORDER))
                    }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
                        marginStart = dp(44)
                    })
                }
            }
        }

    private fun compactSubscriptionDate(raw: String): String {
        return try {
            val instant = java.time.Instant.parse(raw)
            java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy")
                .withZone(java.time.ZoneId.systemDefault())
                .format(instant)
        } catch (_: Exception) {
            raw.take(10).split('-').let { parts ->
                if (parts.size == 3) "${parts[2]}/${parts[1]}/${parts[0]}" else raw
            }
        }
    }
'''

text, count = pattern.subn(lambda _: replacement, text, count=1)
if count != 1:
    raise SystemExit(f'expected one showPersonalArea block, replaced {count}')

path.write_text(text, encoding='utf-8')
print('compacted customer personal area without changing theme')
