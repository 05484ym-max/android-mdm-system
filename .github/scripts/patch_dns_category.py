from pathlib import Path

customer = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = customer.read_text()
old = '''                switchView = Switch(this@CustomerActivity).apply {
                    isChecked = actualOn
                    isEnabled = allowToggle
                }
'''
new = '''                switchView = Switch(this@CustomerActivity).apply {
                    isChecked = actualOn
                    isEnabled = allowToggle
                    val states = arrayOf(
                        intArrayOf(android.R.attr.state_checked, android.R.attr.state_enabled),
                        intArrayOf(android.R.attr.state_checked, -android.R.attr.state_enabled),
                        intArrayOf(-android.R.attr.state_checked, android.R.attr.state_enabled),
                        intArrayOf(-android.R.attr.state_checked, -android.R.attr.state_enabled),
                    )
                    thumbTintList = android.content.res.ColorStateList(
                        states,
                        intArrayOf(
                            Color.WHITE,
                            Color.WHITE,
                            Color.parseColor("#F2F3F2"),
                            Color.parseColor("#F2F3F2"),
                        ),
                    )
                    trackTintList = android.content.res.ColorStateList(
                        states,
                        intArrayOf(
                            Color.parseColor("#1FA457"),
                            Color.parseColor("#1FA457"),
                            Color.parseColor("#B7BDB9"),
                            Color.parseColor("#B7BDB9"),
                        ),
                    )
                }
'''
if old not in s:
    raise SystemExit('DNS switch anchor not found')
customer.write_text(s.replace(old, new, 1))

backend = Path('backend/index.js')
s = backend.read_text()
old = '''app.post('/api/apps/from-play', requireAdmin, wrap(async (req, res) => {
  const { packageName } = req.body || {};
  if (typeof packageName !== 'string' || !PACKAGE_NAME_REGEX.test(packageName)) {
    return res.status(400).json({ error: 'invalid packageName format' });
  }
  try {
    const appInfo = await playStoreSearch.getPlayStoreApp(packageName);
    await db.addAppToCatalog(
      appInfo.packageName, appInfo.name, appInfo.iconUrl, appInfo.version, appInfo.updated,
      appInfo.category,
    );
'''
new = '''app.post('/api/apps/from-play', requireAdmin, wrap(async (req, res) => {
  const { packageName, category } = req.body || {};
  if (typeof packageName !== 'string' || !PACKAGE_NAME_REGEX.test(packageName)) {
    return res.status(400).json({ error: 'invalid packageName format' });
  }
  let requestedCategory = null;
  if (category !== undefined && category !== null && category !== '') {
    if (typeof category !== 'string' || !(await isKnownAppCategory(category))) {
      return res.status(400).json({ error: 'invalid category' });
    }
    requestedCategory = category;
  }
  try {
    const appInfo = await playStoreSearch.getPlayStoreApp(packageName);
    await db.addAppToCatalog(
      appInfo.packageName, appInfo.name, appInfo.iconUrl, appInfo.version, appInfo.updated,
      requestedCategory || appInfo.category,
    );
'''
if old not in s:
    raise SystemExit('from-play anchor not found')
backend.write_text(s.replace(old, new, 1))
