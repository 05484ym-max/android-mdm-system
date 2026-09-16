const fs = require('fs');
const assert = require('assert');
// Regression contract for customer wallpaper branding controls and per-screen size sliders.
const wallpaper = fs.readFileSync('../dpc-app/app/src/main/java/org/mdmopen/dpc/WallpaperBranding.kt', 'utf8');
const retry = fs.readFileSync('../dpc-app/app/src/main/java/org/mdmopen/dpc/WallpaperBrandingRetryWorker.kt', 'utf8');
const customer = fs.readFileSync('../dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt', 'utf8');
assert(wallpaper.includes('KEY_ENABLED = "customer_branding_enabled"'));
assert(wallpaper.includes('fun isEnabled(context: Context): Boolean'));
assert(wallpaper.includes('fun setEnabled(context: Context, enabled: Boolean): String'));
assert(wallpaper.includes('private fun restoreOriginals(context: Context): String'));
assert(wallpaper.includes('if (!isEnabled(context))'));
assert(retry.includes('result.contains("· הסמל כבוי")'));
assert(customer.includes('sectionTitle("סמל יהודי כשר ברקע")'));
assert(customer.includes('wallpaperBrandingToggleCard()'));
assert(customer.includes('WallpaperBranding.setEnabled(applicationContext, enabled)'));

assert(wallpaper.includes('KEY_HOME_SIZE_PERCENT = "customer_branding_home_size_percent"'));
assert(wallpaper.includes('KEY_LOCK_SIZE_PERCENT = "customer_branding_lock_size_percent"'));
assert(wallpaper.includes('const val MIN_SIZE_PERCENT = 10'));
assert(wallpaper.includes('const val MAX_SIZE_PERCENT = 75'));
assert(wallpaper.includes('fun setSizePercents(context: Context, homePercent: Int, lockPercent: Int): String'));
assert(customer.includes('SeekBar.OnSeekBarChangeListener'));
assert(customer.includes('גודל הסמל במסך הבית'));
assert(customer.includes('גודל הסמל במסך הנעילה'));
console.log('wallpaper branding customer toggle wiring: ok');
