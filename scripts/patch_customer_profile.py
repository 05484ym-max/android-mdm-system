from pathlib import Path
import re


def rep(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    c = s.count(old)
    if c != 1:
        raise SystemExit(f'{label}: expected 1 match, got {c}')
    p.write_text(s.replace(old, new, 1))


def rx(path, pattern, repl, label, flags=re.S):
    p = Path(path)
    s = p.read_text()
    out, n = re.subn(pattern, repl, s, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f'{label}: expected 1 regex match, got {n}')
    p.write_text(out)

# Admin shell.
rep('admin-panel/index.html', '<link rel="stylesheet" href="support.css">', '<link rel="stylesheet" href="support.css">\n<link rel="stylesheet" href="panel-polish.css">', 'panel polish link')
rep('admin-panel/index.html', '<div class="devices-section">\n    <h2>מכשירים, מנויים ופקודות</h2>', '<div class="devices-section no-heading">', 'remove redundant devices heading')

# DB profile columns and mapping.
rep('backend/db.js', 'ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_number TEXT;', '''ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_number TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_first_name TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_last_name TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS customer_address TEXT;''', 'customer profile columns')
rep('backend/db.js', '''    customerName: row.customer_name,
    customerNumber: row.customer_number,''', '''    customerName: row.customer_name,
    customerNumber: row.customer_number,
    customerFirstName: row.customer_first_name,
    customerLastName: row.customer_last_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    customerAddress: row.customer_address,''', 'toDevice profile mapping')
rx('backend/db.js', r'async function setCustomerInfo\(deviceId, name, number\) \{.*?\n\}', '''async function setCustomerInfo(deviceId, profile) {
  const { rows } = await pool.query(
    `UPDATE devices SET
       customer_name = $2,
       customer_number = $3,
       customer_first_name = $4,
       customer_last_name = $5,
       customer_email = $6,
       customer_phone = $7,
       customer_address = $8
     WHERE device_id = $1 RETURNING *`,
    [deviceId, profile.name || null, profile.number || null, profile.firstName || null,
     profile.lastName || null, profile.email || null, profile.phone || null, profile.address || null],
  );
  return rows[0] ? toDevice(rows[0]) : null;
}''', 'setCustomerInfo')

# Backend sync and admin route.
rep('backend/index.js', '''    subscriptionExpiryDate: device.subscription && device.subscription.expiryDate
      ? device.subscription.expiryDate
      : null,
    source:''', '''    subscriptionExpiryDate: device.subscription && device.subscription.expiryDate
      ? device.subscription.expiryDate
      : null,
    subscriptionStartDate: device.subscription && device.subscription.startDate
      ? device.subscription.startDate
      : null,
    subscriptionPrice: device.subscription && Number.isFinite(Number(device.subscription.price))
      ? Number(device.subscription.price)
      : null,
    source:''', 'subscription access details')
rep('backend/index.js', '''  policy.customerName = req.device.customerName || null;
  policy.customerNumber = req.device.customerNumber || null;''', '''  policy.customerName = req.device.customerName || null;
  policy.customerNumber = req.device.customerNumber || null;
  policy.customerFirstName = req.device.customerFirstName || null;
  policy.customerLastName = req.device.customerLastName || null;
  policy.customerEmail = req.device.customerEmail || null;
  policy.customerPhone = req.device.customerPhone || req.device.customerNumber || null;
  policy.customerAddress = req.device.customerAddress || null;''', 'sync customer profile')
rx('backend/index.js', r"app\.post\('/api/devices/:deviceId/customer', requireAdmin, wrap\(async \(req, res\) => \{.*?\n\}\)\);", '''app.post('/api/devices/:deviceId/customer', requireAdmin, wrap(async (req, res) => {
  const { name, number, firstName, lastName, email, phone, address } = req.body || {};
  const fields = { name, number, firstName, lastName, email, phone, address };
  for (const [key, value] of Object.entries(fields)) {
    if (value != null && typeof value !== 'string') {
      return res.status(400).json({ error: `${key} must be a string` });
    }
  }
  const device = await db.getDevice(req.params.deviceId);
  if (!device) return res.status(404).json({ error: 'device not found' });

  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const cleanFirst = clean(firstName, 60);
  const cleanLast = clean(lastName, 60);
  const legacyName = clean(name, 120);
  const displayName = legacyName || [cleanFirst, cleanLast].filter(Boolean).join(' ');
  const cleanEmail = clean(email, 160);
  if (cleanEmail && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'invalid email' });
  }

  const updated = await db.setCustomerInfo(req.params.deviceId, {
    name: displayName,
    number: clean(number, 50),
    firstName: cleanFirst,
    lastName: cleanLast,
    email: cleanEmail,
    phone: clean(phone, 50),
    address: clean(address, 240),
  });
  await push.wake(device.pushToken);
  res.json(publicDevice(updated));
}));''', 'customer route')

# DPC contracts.
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt', '''    val customerName: String? = null,
    val customerNumber: String? = null,
)''', '''    val customerName: String? = null,
    val customerNumber: String? = null,
    val customerFirstName: String? = null,
    val customerLastName: String? = null,
    val customerEmail: String? = null,
    val customerPhone: String? = null,
    val customerAddress: String? = null,
)''', 'Policy fields')
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt', '''    val overrideUntil: String?,
    val subscriptionExpiryDate: String?,
)''', '''    val overrideUntil: String?,
    val subscriptionExpiryDate: String?,
    val subscriptionStartDate: String?,
    val subscriptionPrice: Double?,
)''', 'SubscriptionAccess fields')
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt', '''            customerName = if (policyJson.isNull("customerName")) null else policyJson.optString("customerName", null),
            customerNumber = if (policyJson.isNull("customerNumber")) null else policyJson.optString("customerNumber", null),
        )''', '''            customerName = if (policyJson.isNull("customerName")) null else policyJson.optString("customerName", null),
            customerNumber = if (policyJson.isNull("customerNumber")) null else policyJson.optString("customerNumber", null),
            customerFirstName = if (policyJson.isNull("customerFirstName")) null else policyJson.optString("customerFirstName", null),
            customerLastName = if (policyJson.isNull("customerLastName")) null else policyJson.optString("customerLastName", null),
            customerEmail = if (policyJson.isNull("customerEmail")) null else policyJson.optString("customerEmail", null),
            customerPhone = if (policyJson.isNull("customerPhone")) null else policyJson.optString("customerPhone", null),
            customerAddress = if (policyJson.isNull("customerAddress")) null else policyJson.optString("customerAddress", null),
        )''', 'Policy parsing')
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt', '''            subscriptionExpiryDate = accessJson?.let { if (it.isNull("subscriptionExpiryDate")) null else it.optString("subscriptionExpiryDate", null) },
        )''', '''            subscriptionExpiryDate = accessJson?.let { if (it.isNull("subscriptionExpiryDate")) null else it.optString("subscriptionExpiryDate", null) },
            subscriptionStartDate = accessJson?.let { if (it.isNull("subscriptionStartDate")) null else it.optString("subscriptionStartDate", null) },
            subscriptionPrice = accessJson?.let { if (it.isNull("subscriptionPrice")) null else it.optDouble("subscriptionPrice") },
        )''', 'subscription parsing')

rep('dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt', '''    private const val KEY_CUSTOMER_NAME = "customer_name"
    private const val KEY_CUSTOMER_NUMBER = "customer_number"''', '''    private const val KEY_CUSTOMER_NAME = "customer_name"
    private const val KEY_CUSTOMER_NUMBER = "customer_number"
    private const val KEY_CUSTOMER_FIRST_NAME = "customer_first_name"
    private const val KEY_CUSTOMER_LAST_NAME = "customer_last_name"
    private const val KEY_CUSTOMER_EMAIL = "customer_email"
    private const val KEY_CUSTOMER_PHONE = "customer_phone"
    private const val KEY_CUSTOMER_ADDRESS = "customer_address"
    private const val KEY_SUBSCRIPTION_START_DATE = "subscription_start_date"
    private const val KEY_SUBSCRIPTION_PRICE = "subscription_price"''', 'Config keys')
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt', '''    fun setSubscriptionAccess(context: Context, access: SubscriptionAccess) {
        prefs(context).edit()
            .putBoolean(KEY_STORE_ACCESS_ALLOWED, access.allowed)
            .putString(KEY_SUBSCRIPTION_EXPIRY_DATE, access.subscriptionExpiryDate)
            .apply()
    }''', '''    fun subscriptionStartDate(context: Context): String? = prefs(context).getString(KEY_SUBSCRIPTION_START_DATE, null)

    fun subscriptionPrice(context: Context): Double? {
        val p = prefs(context)
        return if (p.contains(KEY_SUBSCRIPTION_PRICE)) java.lang.Double.longBitsToDouble(p.getLong(KEY_SUBSCRIPTION_PRICE, 0L)) else null
    }

    fun setSubscriptionAccess(context: Context, access: SubscriptionAccess) {
        val edit = prefs(context).edit()
            .putBoolean(KEY_STORE_ACCESS_ALLOWED, access.allowed)
            .putString(KEY_SUBSCRIPTION_EXPIRY_DATE, access.subscriptionExpiryDate)
            .putString(KEY_SUBSCRIPTION_START_DATE, access.subscriptionStartDate)
        if (access.subscriptionPrice != null) edit.putLong(KEY_SUBSCRIPTION_PRICE, java.lang.Double.doubleToRawLongBits(access.subscriptionPrice))
        else edit.remove(KEY_SUBSCRIPTION_PRICE)
        edit.apply()
    }''', 'Config subscription details')
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt', '''    fun setCustomerNumber(context: Context, number: String?) {
        prefs(context).edit().putString(KEY_CUSTOMER_NUMBER, number).apply()
    }''', '''    fun setCustomerNumber(context: Context, number: String?) {
        prefs(context).edit().putString(KEY_CUSTOMER_NUMBER, number).apply()
    }

    fun customerFirstName(context: Context): String? = prefs(context).getString(KEY_CUSTOMER_FIRST_NAME, null)
    fun customerLastName(context: Context): String? = prefs(context).getString(KEY_CUSTOMER_LAST_NAME, null)
    fun customerEmail(context: Context): String? = prefs(context).getString(KEY_CUSTOMER_EMAIL, null)
    fun customerPhone(context: Context): String? = prefs(context).getString(KEY_CUSTOMER_PHONE, null)
    fun customerAddress(context: Context): String? = prefs(context).getString(KEY_CUSTOMER_ADDRESS, null)

    fun setCustomerProfile(context: Context, policy: Policy) {
        prefs(context).edit()
            .putString(KEY_CUSTOMER_NAME, policy.customerName)
            .putString(KEY_CUSTOMER_NUMBER, policy.customerNumber)
            .putString(KEY_CUSTOMER_FIRST_NAME, policy.customerFirstName)
            .putString(KEY_CUSTOMER_LAST_NAME, policy.customerLastName)
            .putString(KEY_CUSTOMER_EMAIL, policy.customerEmail)
            .putString(KEY_CUSTOMER_PHONE, policy.customerPhone)
            .putString(KEY_CUSTOMER_ADDRESS, policy.customerAddress)
            .apply()
    }''', 'Config profile accessors')
rep('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicySync.kt', '''            Config.setCustomerName(context, result.policy.customerName)
            Config.setCustomerNumber(context, result.policy.customerNumber)''', '''            Config.setCustomerProfile(context, result.policy)''', 'PolicySync profile')

rx('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt', r'''        // "מצב מנוי" moved into the status pill.*?        rows \+= Triple\(R\.drawable\.ic_row_clock, "עדכון אחרון", lastSyncLabelCompact\(\)\)''', '''        val rows = mutableListOf<Triple<Int, String, String>>()
        (Config.customerPhone(this) ?: Config.customerNumber(this))?.takeIf { it.isNotBlank() }?.let { rows += Triple(R.drawable.ic_row_phone, "טלפון", it) }
        Config.customerEmail(this)?.takeIf { it.isNotBlank() }?.let { rows += Triple(R.drawable.ic_row_chat, "אימייל", it) }
        Config.customerAddress(this)?.takeIf { it.isNotBlank() }?.let { rows += Triple(R.drawable.ic_row_device, "כתובת", it) }
        Config.subscriptionStartDate(this)?.takeIf { it.isNotBlank() }?.let { rows += Triple(R.drawable.ic_row_calendar, "תחילת מנוי", compactSubscriptionDate(it)) }
        Config.subscriptionExpiryDate(this)?.takeIf { it.isNotBlank() }?.let { rows += Triple(R.drawable.ic_row_calendar, "תוקף מנוי", compactSubscriptionDate(it)) }
        Config.subscriptionPrice(this)?.let { rows += Triple(R.drawable.ic_row_shield, "מחיר מנוי", "${it.toInt()} ₪") }
        rows += Triple(R.drawable.ic_row_device, "מזהה מכשיר", Config.deviceId(this))
        rows += Triple(R.drawable.ic_row_clock, "עדכון אחרון", lastSyncLabelCompact())''', 'CustomerActivity rows')

# Admin customer card.
rep('admin-panel/customer-search.js', '''      <div class="unified-profile-grid">
        <div class="unified-info-card"><span>מזהה מכשיר</span><strong dir="ltr">${esc(d.deviceId)}</strong></div>
        <div class="unified-info-card"><span>מצב מנוי</span><strong class="${esc(status.cls || '')}">${esc(status.text || '—')}</strong></div>
        <div class="unified-info-card"><span>תוקף מנוי</span><strong>${esc(fmtDate(subscription.expiryDate))}</strong></div>
        <div class="unified-info-card"><span>מחיר מנוי</span><strong>${subscription.price != null ? esc(subscription.price) + ' ₪' : '—'}</strong></div>
        <div class="unified-info-card"><span>נרשם</span><strong>${esc(fmtDate(d.registeredAt))}</strong></div>
        <div class="unified-info-card"><span>דגם</span><strong>${esc(deviceStatus.model || '—')}</strong></div>
        <div class="unified-info-card"><span>Android</span><strong>${esc(deviceStatus.androidVersion || '—')}</strong></div>
        <div class="unified-info-card"><span>נראה לאחרונה</span><strong>${esc(fmtDate(deviceStatus.lastSeen))}</strong></div>
        <div class="unified-info-card"><span>סנכרון מדיניות</span><strong>${esc(p.syncIntervalMinutes || 60)} דקות</strong></div>
        <div class="unified-info-card"><span>מצב קיוסק</span><strong>${p.kioskEnabled ? 'פעיל' : 'כבוי'}</strong></div>
      </div>''', '''      <div class="unified-profile-section">
        <h3 class="customer-section-title">פרטי לקוח</h3>
        <div class="customer-profile-edit">
          <div class="customer-edit-field"><label>שם פרטי</label><input class="customer-edit-input" data-customer-field="firstName" value="${esc(d.customerFirstName || '')}" autocomplete="given-name"></div>
          <div class="customer-edit-field"><label>שם משפחה</label><input class="customer-edit-input" data-customer-field="lastName" value="${esc(d.customerLastName || '')}" autocomplete="family-name"></div>
          <div class="customer-edit-field"><label>טלפון</label><input class="customer-edit-input" data-customer-field="phone" value="${esc(d.customerPhone || d.customerNumber || '')}" inputmode="tel"></div>
          <div class="customer-edit-field"><label>מספר לקוח</label><input class="customer-edit-input" data-customer-field="number" value="${esc(d.customerNumber || '')}"></div>
          <div class="customer-edit-field field-wide"><label>אימייל</label><input class="customer-edit-input" data-customer-field="email" value="${esc(d.customerEmail || '')}" inputmode="email" autocomplete="email"></div>
          <div class="customer-edit-field field-wide"><label>כתובת</label><input class="customer-edit-input" data-customer-field="address" value="${esc(d.customerAddress || '')}" autocomplete="street-address"></div>
        </div>
        <div class="customer-save-row"><button type="button" class="add-app-btn" data-customer-save>שמור פרטים</button><span class="customer-save-status" data-customer-save-status></span></div>
      </div>
      <div class="unified-profile-section">
        <h3 class="customer-section-title">מנוי ומכשיר</h3>
        <div class="customer-summary-grid">
          <div class="customer-summary-card"><span>מצב מנוי</span><strong class="${esc(status.cls || '')}">${esc(status.text || '—')}</strong></div>
          <div class="customer-summary-card"><span>תחילת מנוי</span><strong>${esc(fmtDate(subscription.startDate))}</strong></div>
          <div class="customer-summary-card"><span>תוקף מנוי</span><strong>${esc(fmtDate(subscription.expiryDate))}</strong></div>
          <div class="customer-summary-card"><span>מחיר</span><strong>${subscription.price != null ? esc(subscription.price) + ' ₪' : '—'}</strong></div>
          <div class="customer-summary-card"><span>מזהה מכשיר</span><strong dir="ltr">${esc(d.deviceId)}</strong></div>
          <div class="customer-summary-card"><span>דגם / Android</span><strong>${esc(deviceStatus.model || '—')} · ${esc(deviceStatus.androidVersion || '—')}</strong></div>
          <div class="customer-summary-card"><span>נראה לאחרונה</span><strong>${esc(fmtDate(d.lastSeenAt || deviceStatus.lastSeen))}</strong></div>
          <div class="customer-summary-card"><span>נרשם במערכת</span><strong>${esc(fmtDate(d.registeredAt))}</strong></div>
        </div>
      </div>''', 'customer profile layout')

rep('admin-panel/customer-search.js', '''    loadInlineDiagnostics();
    panel.querySelector('[data-inline-diagnostics-refresh]')?.addEventListener('click', loadInlineDiagnostics);
''', '''    loadInlineDiagnostics();
    panel.querySelector('[data-inline-diagnostics-refresh]')?.addEventListener('click', loadInlineDiagnostics);

    panel.querySelector('[data-customer-save]')?.addEventListener('click', async e => {
      const saveBtn = e.currentTarget;
      const statusEl = panel.querySelector('[data-customer-save-status]');
      const value = key => panel.querySelector(`[data-customer-field="${key}"]`)?.value.trim() || '';
      const payload = { firstName:value('firstName'), lastName:value('lastName'), phone:value('phone'), number:value('number'), email:value('email'), address:value('address') };
      saveBtn.disabled = true;
      if (statusEl) { statusEl.textContent = 'שומר...'; statusEl.className = 'customer-save-status'; }
      try {
        const response = await fetch(`/api/devices/${encodeURIComponent(d.deviceId)}/customer`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        if (response.status === 401) { document.getElementById('loginScreen').style.display = 'flex'; return; }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'שמירת פרטי הלקוח נכשלה');
        const idx = devices.findIndex(x => x && x.deviceId === d.deviceId);
        if (idx >= 0) devices[idx] = body;
        if (statusEl) { statusEl.textContent = '✓ נשמר וסנכרון נשלח למכשיר'; statusEl.className = 'customer-save-status ok'; }
        setTimeout(() => render(d.deviceId), 650);
      } catch (err) {
        if (statusEl) { statusEl.textContent = err && err.message ? err.message : 'שגיאת תקשורת'; statusEl.className = 'customer-save-status error'; }
      } finally { saveBtn.disabled = false; }
    });
''', 'customer save handler')

rep('admin-panel/customer-search.js', '''      const name = String(d.customerName || '').toLowerCase();
      const number = String(d.customerNumber || '').toLowerCase();
      const id = String(d.deviceId || '').toLowerCase();
      const numberDigits = number.replace(/\\D/g, '');
      return name.includes(q) || number.includes(q) || id.includes(q) || (digits.length >= 3 && numberDigits.includes(digits));''', '''      const name = String(d.customerName || '').toLowerCase();
      const first = String(d.customerFirstName || '').toLowerCase();
      const last = String(d.customerLastName || '').toLowerCase();
      const number = String(d.customerNumber || '').toLowerCase();
      const phone = String(d.customerPhone || '').toLowerCase();
      const email = String(d.customerEmail || '').toLowerCase();
      const id = String(d.deviceId || '').toLowerCase();
      const numberDigits = (number + phone).replace(/\\D/g, '');
      return name.includes(q) || first.includes(q) || last.includes(q) || number.includes(q) || phone.includes(q) || email.includes(q) || id.includes(q) || (digits.length >= 3 && numberDigits.includes(digits));''', 'expanded customer search')

# Audit contracts.
rep('backend/test-admin-panel-functional-audit.js', '''const appImportUi = read('admin-panel/app-import.js');
const apkUploadUi = read('admin-panel/apk-upload.js');''', '''const appImportUi = read('admin-panel/app-import.js');
const apkUploadUi = read('admin-panel/apk-upload.js');
const playStoreSearch = read('backend/playStoreSearch.js');''', 'audit play source')
rep('backend/test-admin-panel-functional-audit.js', "includes(customerSearch, 'setCustomerFocus(true)', 'focused customer workspace');", """includes(customerSearch, 'setCustomerFocus(true)', 'focused customer workspace');
includes(customerSearch, 'data-customer-field=\"firstName\"', 'editable customer first name');
includes(customerSearch, 'data-customer-field=\"email\"', 'editable customer email');
includes(customerSearch, 'data-customer-field=\"address\"', 'editable customer address');
includes(index, 'customerFirstName', 'customer profile sync first name');
includes(index, 'subscriptionStartDate', 'subscription start sync');""", 'audit customer profile')
rep('backend/test-admin-panel-functional-audit.js', "includes(appImportUi, '/api/apps/play-search', 'Play search UI call');", """includes(appImportUi, '/api/apps/play-search', 'Play search UI call');
includes(appImportUi, 'play-search-grid', 'scrollable Play search result grid');
includes(playStoreSearch, 'MAX_RESULTS = 80', 'expanded Play result limit');
includes(playStoreSearch, 'googlePlayScraper.search', 'broad Play scraper search');""", 'audit expanded Play search')

print('patch_customer_profile.py: OK')
