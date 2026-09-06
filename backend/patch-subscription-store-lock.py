from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'{label} marker not found in {path}')
    p.write_text(s.replace(old, new, 1))

# ---- backend: include paid expiry in authoritative access state ----
replace_once(
    'backend/index.js',
    "    overrideUntil: permanent ? null : (temporary ? until.toISOString() : null),\n    source: subscriptionActive ? 'SUBSCRIPTION' : permanent ? 'PERMANENT' : temporary ? 'TEMPORARY' : 'NONE',\n",
    "    overrideUntil: permanent ? null : (temporary ? until.toISOString() : null),\n    subscriptionExpiryDate: device.subscription && device.subscription.expiryDate\n      ? device.subscription.expiryDate\n      : null,\n    source: subscriptionActive ? 'SUBSCRIPTION' : permanent ? 'PERMANENT' : temporary ? 'TEMPORARY' : 'NONE',\n",
    'subscription expiry in access',
)

# ---- backend: deterministic weekly renewal item + expiry item in News & Updates ----
old_updates = """app.get('/api/devices/:deviceId/updates', requireDevice, wrap(async (req, res) => {\n  res.json(await db.listPublishedCustomerUpdatesForDevice(UPDATE_LIST_LIMIT_FOR_DEVICE));\n}));\n"""
new_updates = r"""function subscriptionNewsUpdate(device, now = new Date()) {
  const rawExpiry = device.subscription && device.subscription.expiryDate;
  if (!rawExpiry) return null;
  const expiry = new Date(rawExpiry);
  if (Number.isNaN(expiry.getTime())) return null;

  const expiryKey = expiry.toISOString().slice(0, 10);
  const [year, month, day] = expiryKey.split('-');
  const expiryLabel = `${day}/${month}/${year}`;
  const access = subscriptionAccess(device, now);
  const diffMs = expiry.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

  if (daysRemaining <= 0) {
    if (access.overrideActive) {
      const overrideText = access.overridePermanent
        ? 'פתיחת החסימה של המנהל מוגדרת כרגע לתמיד.'
        : `פתיחת החסימה הזמנית של המנהל פעילה עד ${new Date(access.overrideUntil).toLocaleString('he-IL')}.`;
      return {
        id: `subscription-expired-override-${expiryKey}`,
        title: 'המנוי פג – החנות פתוחה בהרשאת מנהל',
        body: `המנוי פג בתאריך ${expiryLabel}. ${overrideText} לאחר סיום ההרשאה חנות האפליקציות והעדכונים תינעל עד לחידוש המנוי. שאר המכשיר ימשיך לעבוד כרגיל.`,
        pinned: true,
        publishedAt: expiry.toISOString(),
        mediaType: null,
        mediaUrl: null,
        mediaMimeType: null,
        mediaSizeBytes: null,
      };
    }
    return {
      id: `subscription-expired-${expiryKey}`,
      title: 'המנוי פג – חנות האפליקציות נעולה',
      body: `המנוי פג בתאריך ${expiryLabel}. חנות האפליקציות והעדכונים נעולה עד לחידוש המנוי. שאר המכשיר והאפליקציות שכבר מותקנות ממשיכים לעבוד כרגיל.`,
      pinned: true,
      publishedAt: expiry.toISOString(),
      mediaType: null,
      mediaUrl: null,
      mediaMimeType: null,
      mediaSizeBytes: null,
    };
  }

  if (daysRemaining > 30) return null;

  // Four deterministic pre-expiry reminder ids: 30-22, 21-15, 14-8, 7-1 days.
  // The id changes only when a new weekly bucket starts, so the device's existing
  // read-id mechanism naturally shows one new unread News badge per week.
  const weeklyBucket = daysRemaining >= 22 ? 4 : daysRemaining >= 15 ? 3 : daysRemaining >= 8 ? 2 : 1;
  return {
    id: `subscription-renewal-${expiryKey}-w${weeklyBucket}`,
    title: 'תזכורת לחידוש המנוי',
    body: `המנוי שלך יפוג בתאריך ${expiryLabel}. אם המנוי לא יחודש עד לתאריך זה, חנות האפליקציות והעדכונים תינעל עד לחידוש המנוי. שאר המכשיר והאפליקציות שכבר מותקנות ימשיכו לעבוד כרגיל.`,
    pinned: true,
    publishedAt: now.toISOString(),
    mediaType: null,
    mediaUrl: null,
    mediaMimeType: null,
    mediaSizeBytes: null,
  };
}

app.get('/api/devices/:deviceId/updates', requireDevice, wrap(async (req, res) => {
  const updates = await db.listPublishedCustomerUpdatesForDevice(UPDATE_LIST_LIMIT_FOR_DEVICE);
  const subscriptionUpdate = subscriptionNewsUpdate(req.device);
  if (!subscriptionUpdate) return res.json(updates);
  // Subscription reminder is device-specific and should always be visible at the
  // top. Keep the response bounded to the same total size as before.
  res.json([subscriptionUpdate, ...updates].slice(0, UPDATE_LIST_LIMIT_FOR_DEVICE));
}));
"""
replace_once('backend/index.js', old_updates, new_updates, 'updates route')

# ---- Android API contract: receive subscription access on every sync ----
replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt',
    "data class SyncResult(\n    val policy: Policy,\n    val catalog: List<CatalogApp>,\n    val commands: List<QueuedCommand>,\n    val dns: DnsPolicy,\n)\n",
    "data class SubscriptionAccess(\n    val allowed: Boolean,\n    val subscriptionActive: Boolean,\n    val overrideActive: Boolean,\n    val overridePermanent: Boolean,\n    val overrideUntil: String?,\n    val subscriptionExpiryDate: String?,\n)\n\ndata class SyncResult(\n    val policy: Policy,\n    val catalog: List<CatalogApp>,\n    val commands: List<QueuedCommand>,\n    val dns: DnsPolicy,\n    val subscriptionAccess: SubscriptionAccess,\n)\n",
    'sync result type',
)

replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt',
    "        return SyncResult(policy, catalog, commands, dns)\n",
    "        val accessJson = json.optJSONObject(\"subscriptionAccess\")\n        val subscriptionAccess = SubscriptionAccess(\n            // Backward-compatible fail-open for the store only: an older server\n            // that does not send this field must not suddenly lock an existing\n            // customer's store merely because the app updated first.\n            allowed = accessJson?.optBoolean(\"allowed\", true) ?: true,\n            subscriptionActive = accessJson?.optBoolean(\"subscriptionActive\", true) ?: true,\n            overrideActive = accessJson?.optBoolean(\"overrideActive\", false) ?: false,\n            overridePermanent = accessJson?.optBoolean(\"overridePermanent\", false) ?: false,\n            overrideUntil = accessJson?.let { if (it.isNull(\"overrideUntil\")) null else it.optString(\"overrideUntil\", null) },\n            subscriptionExpiryDate = accessJson?.let { if (it.isNull(\"subscriptionExpiryDate\")) null else it.optString(\"subscriptionExpiryDate\", null) },\n        )\n\n        return SyncResult(policy, catalog, commands, dns, subscriptionAccess)\n",
    'sync result parse',
)

# ---- Config cache: store-only entitlement, not a whole-device lock ----
replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt',
    "    private const val KEY_READ_UPDATE_IDS = \"read_update_ids\"\n",
    "    private const val KEY_READ_UPDATE_IDS = \"read_update_ids\"\n    private const val KEY_STORE_ACCESS_ALLOWED = \"store_access_allowed\"\n    private const val KEY_SUBSCRIPTION_EXPIRY_DATE = \"subscription_expiry_date\"\n",
    'config keys',
)

replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt',
    "    fun kioskEnabled(context: Context): Boolean =\n",
    "    /** Server-authoritative entitlement for the in-app app store only.\n     * Defaults open until the first new-server sync so an app-first rollout\n     * cannot accidentally lock paying customers. It never controls the rest\n     * of the device, already-installed apps, filtering, or Device Owner. */\n    fun storeAccessAllowed(context: Context): Boolean =\n        prefs(context).getBoolean(KEY_STORE_ACCESS_ALLOWED, true)\n\n    fun subscriptionExpiryDate(context: Context): String? =\n        prefs(context).getString(KEY_SUBSCRIPTION_EXPIRY_DATE, null)\n\n    fun setSubscriptionAccess(context: Context, access: SubscriptionAccess) {\n        prefs(context).edit()\n            .putBoolean(KEY_STORE_ACCESS_ALLOWED, access.allowed)\n            .putString(KEY_SUBSCRIPTION_EXPIRY_DATE, access.subscriptionExpiryDate)\n            .apply()\n    }\n\n    fun kioskEnabled(context: Context): Boolean =\n",
    'config entitlement functions',
)

# ---- Policy sync persists store entitlement each cycle ----
replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/PolicySync.kt',
    "        Config.setDnsPendingCustomerRequest(context, null)\n",
    "        Config.setDnsPendingCustomerRequest(context, null)\n        Config.setSubscriptionAccess(context, result.subscriptionAccess)\n",
    'policy sync entitlement save',
)

# ---- Customer app: lock only the store UI and both install paths ----
replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
    "        contentArea.removeAllViews()\n\n        val apps = Config.appCatalog(this)\n",
    "        contentArea.removeAllViews()\n\n        if (!Config.storeAccessAllowed(this)) {\n            renderLockedStore()\n            return\n        }\n\n        val apps = Config.appCatalog(this)\n",
    'store screen guard',
)

replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
    "    /** Play Store is hidden by default like any unapproved app - this briefly\n",
    "    private fun renderLockedStore() {\n        val raw = Config.subscriptionExpiryDate(this)\n        val expiryLabel = raw?.take(10)?.split('-')?.takeIf { it.size == 3 }\n            ?.let { \"${it[2]}/${it[1]}/${it[0]}\" } ?: \"תאריך המנוי\"\n\n        contentArea.addView(LinearLayout(this).apply {\n            orientation = LinearLayout.VERTICAL\n            gravity = Gravity.CENTER\n            background = flatRounded(CARD, dp(20).toFloat())\n            setPadding(dp(24), dp(32), dp(24), dp(32))\n\n            addView(TextView(this@CustomerActivity).apply {\n                text = \"🔒\"\n                textSize = 36f\n                gravity = Gravity.CENTER\n            })\n            addView(TextView(this@CustomerActivity).apply {\n                text = \"חנות האפליקציות נעולה\"\n                textSize = 20f\n                typeface = heavyFont\n                setTextColor(Color.parseColor(TEXT))\n                gravity = Gravity.CENTER\n                setPadding(0, dp(12), 0, dp(8))\n            })\n            addView(TextView(this@CustomerActivity).apply {\n                text = \"המנוי פג בתאריך $expiryLabel.\\nכדי להוריד אפליקציות או לקבל עדכונים דרך החנות יש לחדש את המנוי.\\n\\nשאר המכשיר והאפליקציות שכבר מותקנות ממשיכים לעבוד כרגיל.\"\n                textSize = 14f\n                setTextColor(Color.parseColor(MUTED))\n                gravity = Gravity.CENTER\n            })\n        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {\n            topMargin = dp(22)\n        })\n    }\n\n    /** Play Store is hidden by default like any unapproved app - this briefly\n",
    'locked store renderer',
)

replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
    "    private fun openPlayStoreForInstall(packageName: String) {\n        PlayStoreGate.openForInstall(this, packageName)\n    }\n",
    "    private fun openPlayStoreForInstall(packageName: String) {\n        if (!Config.storeAccessAllowed(this)) {\n            Toast.makeText(this, \"המנוי פג — חנות האפליקציות נעולה עד לחידוש\", Toast.LENGTH_LONG).show()\n            showAppStore()\n            return\n        }\n        PlayStoreGate.openForInstall(this, packageName)\n    }\n",
    'play install guard',
)

replace_once(
    'dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt',
    "    private fun installApp(app: CatalogApp) {\n        if (app.appSource != \"APK\") {\n",
    "    private fun installApp(app: CatalogApp) {\n        if (!Config.storeAccessAllowed(this)) {\n            Toast.makeText(this, \"המנוי פג — הורדות ועדכונים נעולים עד לחידוש\", Toast.LENGTH_LONG).show()\n            showAppStore()\n            return\n        }\n        if (app.appSource != \"APK\") {\n",
    'apk install guard',
)

print('subscription store lock/reminders patch applied')
