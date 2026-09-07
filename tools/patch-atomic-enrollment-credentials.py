from pathlib import Path

config = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt')
s = config.read_text(encoding='utf-8')
old = '''    fun setDeviceToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_DEVICE_TOKEN, token).apply()
    }
'''
new = '''    fun setDeviceToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_DEVICE_TOKEN, token).apply()
    }

    /**
     * Enrollment identity must be persisted atomically: a process death between
     * separate async writes can otherwise leave a deviceId without its token.
     */
    fun setEnrollmentCredentials(context: Context, deviceId: String, deviceToken: String) {
        val persisted = prefs(context).edit()
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_DEVICE_TOKEN, deviceToken)
            .commit()
        check(persisted) { "Could not persist enrollment credentials" }
    }
'''
if old not in s:
    raise SystemExit('Config target not found')
s = s.replace(old, new, 1)
config.write_text(s, encoding='utf-8')

for filename in [
    'dpc-app/app/src/main/java/org/mdmopen/dpc/MainActivity.kt',
    'dpc-app/app/src/main/java/org/mdmopen/dpc/ProvisioningActivity.kt',
]:
    p = Path(filename)
    text = p.read_text(encoding='utf-8')
    old_pair = '''                Config.setDeviceId(this@MainActivity, result.deviceId)\n                Config.setDeviceToken(this@MainActivity, result.deviceToken)'''
    if 'MainActivity.kt' in filename:
        new_pair = '''                Config.setEnrollmentCredentials(\n                    this@MainActivity,\n                    result.deviceId,\n                    result.deviceToken,\n                )'''
    else:
        old_pair = '''                Config.setDeviceId(this, result.deviceId)\n                Config.setDeviceToken(this, result.deviceToken)'''
        new_pair = '''                Config.setEnrollmentCredentials(\n                    this,\n                    result.deviceId,\n                    result.deviceToken,\n                )'''
    if old_pair not in text:
        raise SystemExit(f'enrollment credential target not found in {filename}')
    p.write_text(text.replace(old_pair, new_pair, 1), encoding='utf-8')
