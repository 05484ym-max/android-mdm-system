from pathlib import Path

# Customer app: show WhatsApp blocking mode only; keep accessibility internal.
path = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
text = path.read_text()
old = '''        val guardPolicy = WhatsAppGuardConfig.load(this)
        if (guardPolicy.enabled) {
            contentArea.addView(whatsAppFeaturedCard(), LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(14) })
        }
'''
new = '''        contentArea.addView(whatsAppFeaturedCard(), LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(14) })
'''
if old not in text:
    raise SystemExit('Customer WhatsApp card visibility block not found')
text = text.replace(old, new, 1)

old = '''    private fun whatsAppFeaturedCard(): LinearLayout {
        val enabled = WhatsAppGuardProtection.accessibilityEnabled(this)
'''
new = '''    private fun whatsAppFeaturedCard(): LinearLayout {
        val policy = WhatsAppGuardConfig.load(this)
        val accessibilityEnabled = WhatsAppGuardProtection.accessibilityEnabled(this)
        val blockLabel = whatsAppBlockLabel(policy)
        val blockingEnabled = policy.enabled
'''
if old not in text:
    raise SystemExit('Customer WhatsApp card header not found')
text = text.replace(old, new, 1)
text = text.replace('background = circle(if (enabled) OK else ACCENT_DARK)', 'background = circle(if (blockingEnabled) OK else ACCENT_DARK)', 1)

old = '''                        text = if (enabled) {
                            "ההגנה פעילה. חסימת סטטוסים וערוצים מנוהלת מהפאנל בלבד."
                        } else {
                            "נדרשת הפעלה חד-פעמית של הנגישות על ידי מתקין עם קוד מנהל. WhatsApp נשאר זמין גם אם השירות אינו פעיל."
                        }
'''
new = '''                        text = "מצב חסימת WhatsApp: $blockLabel"
'''
if old not in text:
    raise SystemExit('Customer WhatsApp description block not found')
text = text.replace(old, new, 1)

old = '''            addView(TextView(this@CustomerActivity).apply {
                text = if (enabled) "✓ נגישות פעילה ומוגנת" else "⚠ נגישות אינה פעילה"
                textSize = 12f
                typeface = heavyFont
                setTextColor(Color.parseColor(if (enabled) OK else "#B52F24"))
                gravity = Gravity.RIGHT
                setPadding(0, dp(12), 0, 0)
            })

            if (!enabled) {
'''
new = '''            addView(TextView(this@CustomerActivity).apply {
                text = blockLabel
                textSize = 12f
                typeface = heavyFont
                setTextColor(Color.parseColor(if (blockingEnabled) OK else MUTED))
                gravity = Gravity.RIGHT
                setPadding(0, dp(12), 0, 0)
            })

            if (!accessibilityEnabled) {
'''
if old not in text:
    raise SystemExit('Customer accessibility status block not found')
text = text.replace(old, new, 1)

anchor = '    private fun requestAdminPinForWhatsApp(title: String, onSuccess: () -> Unit) {'
helper = '''    private fun whatsAppBlockLabel(policy: WhatsAppGuardPolicy): String {
        val parts = mutableListOf<String>()
        if (policy.hideProfilePhotos) parts += "תמונות פרופיל"
        if (policy.blockStatuses) parts += "סטטוסים"
        if (policy.blockChannels) parts += "ערוצים"
        return when {
            parts.isEmpty() -> "פתוח"
            policy.blockChannels && !policy.blockStatuses && !policy.hideProfilePhotos -> "חסום: ערוצים בלבד"
            else -> "חסום: ${parts.joinToString(", ")}"
        }
    }

'''
if anchor not in text:
    raise SystemExit('Customer helper anchor not found')
text = text.replace(anchor, helper + anchor, 1)
path.write_text(text)

# Device telemetry: desired/applied local WhatsApp flags and Accessibility separately.
path = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/DeviceHealth.kt')
text = path.read_text()
old = '''        val guard = WhatsAppGuardConfig.load(context)
        val json = JSONObject()
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("manufacturer", Build.MANUFACTURER)
            .put("androidVersion", Build.VERSION.RELEASE)
            .put("isDeviceOwner", isDeviceOwner)
            .put("whatsappGuardRequested", guard.enabled)
            .put("whatsappGuardAccessibilityEnabled", WhatsAppGuardProtection.accessibilityEnabled(context))
'''
new = '''        val guard = WhatsAppGuardConfig.load(context)
        val guardAccessibility = WhatsAppGuardProtection.accessibilityEnabled(context)
        val guardState = WhatsAppGuardProtection.decide(
            guard.enabled,
            guardAccessibility,
            WhatsAppGuardConfig.wasProtected(context),
        )
        val json = JSONObject()
            .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("manufacturer", Build.MANUFACTURER)
            .put("androidVersion", Build.VERSION.RELEASE)
            .put("isDeviceOwner", isDeviceOwner)
            .put("whatsappGuardRequested", guard.enabled)
            .put("whatsappGuardBlockStatuses", guard.blockStatuses)
            .put("whatsappGuardBlockChannels", guard.blockChannels)
            .put("whatsappGuardHideProfilePhotos", guard.hideProfilePhotos)
            .put("whatsappGuardAccessibilityEnabled", guardAccessibility)
            .put("whatsappGuardProtectionState", guardState.name)
'''
if old not in text:
    raise SystemExit('DeviceHealth WhatsApp telemetry block not found')
path.write_text(text.replace(old, new, 1))

# Admin panel: split block state and accessibility state; explicit channels-only preset.
path = Path('admin-panel/customer-search.js')
text = path.read_text()
anchor = '  function ensurePanel() {'
helper = '''  function waModeLabel(wa) {
    const parts = [];
    if (wa && wa.hideProfilePhotos) parts.push('תמונות פרופיל');
    if (wa && wa.blockStatuses) parts.push('סטטוסים');
    if (wa && wa.blockChannels) parts.push('ערוצים');
    if (!parts.length) return 'פתוח';
    if (wa.blockChannels && !wa.blockStatuses && !wa.hideProfilePhotos) return 'חסום: ערוצים בלבד';
    return 'חסום: ' + parts.join(', ');
  }

  function reportedWa(deviceStatus) {
    const hasReported = ['whatsappGuardBlockStatuses','whatsappGuardBlockChannels','whatsappGuardHideProfilePhotos']
      .every(k => typeof deviceStatus[k] === 'boolean');
    if (!hasReported) return null;
    return {
      blockStatuses: deviceStatus.whatsappGuardBlockStatuses,
      blockChannels: deviceStatus.whatsappGuardBlockChannels,
      hideProfilePhotos: deviceStatus.whatsappGuardHideProfilePhotos,
    };
  }

'''
if anchor not in text:
    raise SystemExit('Admin helper anchor not found')
text = text.replace(anchor, helper + anchor, 1)

old = '''    const wa = p.whatsappGuard || { blockStatuses: false, blockChannels: false, hideProfilePhotos: false };
    const waRequested = Boolean(wa.blockStatuses || wa.blockChannels || wa.hideProfilePhotos);
    const waAccessibility = deviceStatus.whatsappGuardAccessibilityEnabled === true;
    const waRuntime = !waRequested
      ? { text: 'ההגנה כבויה', cls: 'wa-runtime-off' }
      : waAccessibility
        ? { text: '✓ פעיל ומוגן', cls: 'wa-runtime-ok' }
        : { text: '⚠ שירות הנגישות אינו פעיל — WhatsApp נשאר זמין, אך הסינון אינו נאכף כרגע', cls: 'wa-runtime-warn' };
'''
new = '''    const wa = p.whatsappGuard || { blockStatuses: false, blockChannels: false, hideProfilePhotos: false };
    const waActual = reportedWa(deviceStatus);
    const waRequestedLabel = waModeLabel(wa);
    const waActualLabel = waActual ? waModeLabel(waActual) : 'טרם דווח';
    const waAccessibility = deviceStatus.whatsappGuardAccessibilityEnabled === true;
    const waAccessibilityKnown = typeof deviceStatus.whatsappGuardAccessibilityEnabled === 'boolean';
'''
if old not in text:
    raise SystemExit('Admin primary WA state block not found')
text = text.replace(old, new, 1)

old = '''        <div class="wa-runtime ${esc(waRuntime.cls)}">${esc(waRuntime.text)}</div>
        <div class="unified-command-summary">כל חסימה נשלטת בנפרד ומסתנכרנת למכשיר.</div>
'''
new = '''        <div class="wa-runtime ${waActualLabel === 'פתוח' ? 'wa-runtime-off' : 'wa-runtime-ok'}">מצב חסימת WhatsApp במכשיר: ${esc(waActualLabel)}</div>
        <div class="wa-runtime ${waAccessibility ? 'wa-runtime-ok' : 'wa-runtime-warn'}">מצב נגישות: ${waAccessibilityKnown ? (waAccessibility ? 'פעילה' : 'כבויה') : 'טרם דווח'}</div>
        <div class="unified-command-summary">הגדרה בפאנל: <strong>${esc(waRequestedLabel)}</strong>. כל חסימה נשלטת בנפרד ומסתנכרנת למכשיר.</div>
'''
if old not in text:
    raise SystemExit('Admin primary status markup not found')
text = text.replace(old, new, 1)

old = '''          <button type="button" class="toggle-btn ${wa.hideProfilePhotos ? 'wa-on' : ''}" data-wa-key="hideProfilePhotos">תמונות פרופיל: ${wa.hideProfilePhotos ? 'מוסתר' : 'גלוי'}</button>
        </div>
'''
new = '''          <button type="button" class="toggle-btn ${wa.hideProfilePhotos ? 'wa-on' : ''}" data-wa-key="hideProfilePhotos">תמונות פרופיל: ${wa.hideProfilePhotos ? 'מוסתר' : 'גלוי'}</button>
          <button type="button" class="toggle-btn" data-wa-channels-only>ערוצים בלבד</button>
        </div>
'''
if old not in text:
    raise SystemExit('Admin primary buttons block not found')
text = text.replace(old, new, 1)

anchor = "    panel.querySelector('[data-unified-close]')?.addEventListener('click', () => {\n"
listener = '''    panel.querySelector('[data-wa-channels-only]')?.addEventListener('click', async () => {
      panel.querySelectorAll('[data-wa-key], [data-wa-channels-only]').forEach(x => x.disabled = true);
      try {
        const response = await fetch(`/api/devices/${encodeURIComponent(d.deviceId)}/policy/whatsapp-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blockStatuses: false, blockChannels: true, hideProfilePhotos: false }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        const idx = devices.findIndex(x => x && x.deviceId === d.deviceId);
        if (idx >= 0) devices[idx] = body;
        render(d.deviceId);
      } catch (err) {
        alert('שמירת חסימת ערוצים בלבד נכשלה: ' + (err && err.message ? err.message : err));
        panel.querySelectorAll('[data-wa-key], [data-wa-channels-only]').forEach(x => x.disabled = false);
      }
    });

'''
if anchor not in text:
    raise SystemExit('Admin preset listener anchor not found')
text = text.replace(anchor, listener + anchor, 1)

old = '''  function detailWaState(d) {
    const p = d && d.policy ? d.policy : {};
    const wa = p.whatsappGuard || { blockStatuses: false, blockChannels: false, hideProfilePhotos: false };
    const requested = Boolean(wa.blockStatuses || wa.blockChannels || wa.hideProfilePhotos);
    const accessibility = Boolean(d && d.status && d.status.whatsappGuardAccessibilityEnabled === true);
    return {
      wa,
      runtime: !requested
        ? { text: 'ההגנה כבויה', cls: 'wa-runtime-off' }
        : accessibility
          ? { text: '✓ פעיל ומוגן', cls: 'wa-runtime-ok' }
          : { text: '⚠ שירות הנגישות אינו פעיל — WhatsApp נשאר זמין, אך הסינון אינו נאכף כרגע', cls: 'wa-runtime-warn' },
    };
  }
'''
new = '''  function detailWaState(d) {
    const p = d && d.policy ? d.policy : {};
    const wa = p.whatsappGuard || { blockStatuses: false, blockChannels: false, hideProfilePhotos: false };
    const status = d && d.status ? d.status : {};
    const actual = reportedWa(status);
    return {
      wa,
      requestedLabel: waModeLabel(wa),
      actualLabel: actual ? waModeLabel(actual) : 'טרם דווח',
      accessibility: typeof status.whatsappGuardAccessibilityEnabled === 'boolean'
        ? status.whatsappGuardAccessibilityEnabled
        : null,
    };
  }
'''
if old not in text:
    raise SystemExit('Admin detail state block not found')
text = text.replace(old, new, 1)
text = text.replace('    const { wa, runtime } = detailWaState(d);', '    const { wa, requestedLabel, actualLabel, accessibility } = detailWaState(d);', 1)
old = '''      <div class="wa-runtime ${runtime.cls}">${runtime.text}</div>
      <div class="unified-command-summary">כל חסימה נשלטת בנפרד ומסתנכרנת למכשיר.</div>
'''
new = '''      <div class="wa-runtime ${actualLabel === 'פתוח' ? 'wa-runtime-off' : 'wa-runtime-ok'}">מצב חסימת WhatsApp במכשיר: ${actualLabel}</div>
      <div class="wa-runtime ${accessibility === true ? 'wa-runtime-ok' : 'wa-runtime-warn'}">מצב נגישות: ${accessibility === null ? 'טרם דווח' : (accessibility ? 'פעילה' : 'כבויה')}</div>
      <div class="unified-command-summary">הגדרה בפאנל: <strong>${requestedLabel}</strong>. כל חסימה נשלטת בנפרד ומסתנכרנת למכשיר.</div>
'''
if old not in text:
    raise SystemExit('Admin detail markup not found')
text = text.replace(old, new, 1)
path.write_text(text)

# CI invariants.
path = Path('.github/workflows/whatsapp-guard-mdm-verify.yml')
text = path.read_text()
anchor = "              'first setup remains separately modeled': 'FIRST_SETUP_PENDING' in policy,\n"
extra = """              'customer UI hides accessibility status': 'נגישות פעילה ומוגנת' not in Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt').read_text() and 'נגישות אינה פעילה' not in Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt').read_text(),
              'device reports granular WhatsApp policy': all(x in Path('dpc-app/app/src/main/java/org/mdmopen/dpc/DeviceHealth.kt').read_text() for x in ['whatsappGuardBlockStatuses','whatsappGuardBlockChannels','whatsappGuardHideProfilePhotos','whatsappGuardAccessibilityEnabled']),
              'admin panel has channels-only preset': 'data-wa-channels-only' in Path('admin-panel/customer-search.js').read_text(),
              'admin panel splits block and accessibility status': 'מצב חסימת WhatsApp במכשיר' in Path('admin-panel/customer-search.js').read_text() and 'מצב נגישות' in Path('admin-panel/customer-search.js').read_text(),
"""
if anchor not in text:
    raise SystemExit('WhatsApp CI anchor not found')
path.write_text(text.replace(anchor, anchor + extra, 1))
