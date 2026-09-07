from pathlib import Path

p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/AppStoreActivity.kt')
s = p.read_text(encoding='utf-8')

# Add digest import for authoritative custom-APK comparison.
needle = 'import java.net.URL\n'
if 'import java.security.MessageDigest\n' not in s:
    if needle not in s:
        raise SystemExit('import marker not found')
    s = s.replace(needle, needle + 'import java.security.MessageDigest\n', 1)

old_update = '''    private fun isUpdateAvailable(app: CatalogApp, installed: Boolean): Boolean {
        if (!installed) return false

        // Google Play's public metadata is catalog-level, not device-specific.
        // A different version/timestamp can mean staged rollout, device/ABI
        // targeting, regional rollout, or simply metadata that is newer than
        // what this exact device is currently eligible to install.
        //
        // Therefore we deliberately do NOT label an installed app as "עדכן"
        // from versionName/timestamp heuristics alone. False update prompts are
        // worse than a conservative "מותקן". When we later have an
        // authoritative device-specific update signal, this is the one place
        // that should consume it.
        return false
    }
'''
new_update = '''    private fun isUpdateAvailable(app: CatalogApp, installed: Boolean): Boolean {
        if (!installed) return false

        if (app.appSource == "APK") {
            val expectedSha = app.apkSha256?.trim()?.lowercase()
            if (expectedSha.isNullOrBlank()) return false
            return try {
                val info = packageManager.getApplicationInfo(
                    app.packageName,
                    PackageManager.MATCH_UNINSTALLED_PACKAGES
                )
                val digest = MessageDigest.getInstance("SHA-256")
                java.io.File(info.sourceDir).inputStream().use { input ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = input.read(buffer)
                        if (count <= 0) break
                        digest.update(buffer, 0, count)
                    }
                }
                val installedSha = digest.digest().joinToString("") { "%02x".format(it) }
                installedSha != expectedSha
            } catch (_: Exception) {
                false
            }
        }

        val remote = app.playVersion?.trim().orEmpty()
        if (remote.isBlank()) return false
        val local = try {
            packageManager.getPackageInfo(app.packageName, 0).versionName.orEmpty().trim()
        } catch (_: Exception) {
            return false
        }
        if (local.isBlank() || local == remote) return false

        // Compare numeric components (e.g. 8.2.10 > 8.2.9). If either version
        // has no numeric components, stay conservative and do not claim that an
        // update is required.
        val localParts = Regex("\\\\d+").findAll(local).map { it.value.toLongOrNull() ?: 0L }.toList()
        val remoteParts = Regex("\\\\d+").findAll(remote).map { it.value.toLongOrNull() ?: 0L }.toList()
        if (localParts.isEmpty() || remoteParts.isEmpty()) return false
        val size = maxOf(localParts.size, remoteParts.size)
        for (i in 0 until size) {
            val l = localParts.getOrElse(i) { 0L }
            val r = remoteParts.getOrElse(i) { 0L }
            if (r != l) return r > l
        }
        return false
    }
'''
if old_update not in s:
    raise SystemExit('isUpdateAvailable block not found')
s = s.replace(old_update, new_update, 1)

start = s.index('    private fun isInstalled(packageName: String): Boolean {')
end = s.index('\n    private fun confirmQuickUninstall', start)
new_installed = '''    private fun isInstalled(packageName: String): Boolean {
        // MATCH_UNINSTALLED_PACKAGES can return retained metadata after removal.
        // FLAG_INSTALLED is the only authoritative installed-state signal here;
        // DevicePolicyManager hidden-state must never be treated as proof that
        // the package physically exists on the device.
        return try {
            val info = packageManager.getApplicationInfo(
                packageName,
                PackageManager.MATCH_UNINSTALLED_PACKAGES
            )
            (info.flags and ApplicationInfo.FLAG_INSTALLED) != 0
        } catch (_: PackageManager.NameNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }
'''
s = s[:start] + new_installed + s[end:]

old_status = '''            text = when {
                app.appSource == "APK" && installed -> "התקן/עדכן"
                app.appSource == "APK" -> "התקנה"
                !installed -> "התקנה"
                updateAvailable -> "עדכן"
                else -> "בדוק עדכון"
            }
'''
new_status = '''            text = when {
                !installed -> "התקנה"
                updateAvailable -> "עדכון"
                else -> "מותקן"
            }
'''
if old_status not in s:
    raise SystemExit('status text block not found')
s = s.replace(old_status, new_status, 1)

p.write_text(s, encoding='utf-8')
