from pathlib import Path

# Build workflow: publish SHA-256 for the exact APK bytes in version.json.
p = Path('.github/workflows/build-dpc.yml')
s = p.read_text(encoding='utf-8')
old = '''          python3 - "${{ github.run_number }}" <<'PYVER'\n          import json, sys\n\n          version_code = int(sys.argv[1])\n\n          data = {\n              "versionCode": version_code,\n              "apkUrl": "https://android-mdm-system.onrender.com/downloads/mdm.apk"\n          }\n'''
new = '''          APK_SHA256=$(sha256sum "$APK" | awk '{print $1}')\n          if [ -z "$APK_SHA256" ]; then\n            echo "::error::Could not calculate APK SHA-256"\n            exit 1\n          fi\n\n          python3 - "${{ github.run_number }}" "$APK_SHA256" <<'PYVER'\n          import json, sys\n\n          version_code = int(sys.argv[1])\n          apk_sha256 = sys.argv[2].lower()\n\n          data = {\n              "versionCode": version_code,\n              "apkUrl": "https://android-mdm-system.onrender.com/downloads/mdm.apk",\n              "sha256": apk_sha256\n          }\n'''
if old not in s:
    raise SystemExit('build-dpc version.json target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# DPC updater: require and verify the published SHA-256 before package/signature checks.
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/AutoUpdater.kt')
s = p.read_text(encoding='utf-8')
old_meta = '''        val remoteVersion = metadata.getLong("versionCode")\n\n        val currentVersion =\n'''
new_meta = '''        val remoteVersion = metadata.getLong("versionCode")\n        val expectedSha256 = metadata.optString("sha256").trim().lowercase()\n        if (!expectedSha256.matches(Regex("^[0-9a-f]{64}$"))) {\n            error("Update metadata SHA-256 missing or invalid")\n        }\n\n        val currentVersion =\n'''
if old_meta not in s:
    raise SystemExit('AutoUpdater metadata target not found')
s = s.replace(old_meta, new_meta, 1)
old_verify = '''            downloadFile(apkUrl, apk)\n            verifyApk(context, apk, remoteVersion)\n            installUpdate(context, apk, remoteVersion)\n'''
new_verify = '''            downloadFile(apkUrl, apk)\n            verifyFileSha256(apk, expectedSha256)\n            verifyApk(context, apk, remoteVersion)\n            installUpdate(context, apk, remoteVersion)\n'''
if old_verify not in s:
    raise SystemExit('AutoUpdater download verification target not found')
s = s.replace(old_verify, new_verify, 1)
insert_before = '    private fun verifyApk(\n'
helper = '''    private fun verifyFileSha256(apk: File, expectedSha256: String) {\n        val digest = MessageDigest.getInstance("SHA-256")\n        apk.inputStream().use { input ->\n            val buffer = ByteArray(64 * 1024)\n            while (true) {\n                val read = input.read(buffer)\n                if (read <= 0) break\n                digest.update(buffer, 0, read)\n            }\n        }\n        val actual = digest.digest().joinToString("") { "%02x".format(it) }\n        if (actual != expectedSha256) {\n            error("Update APK SHA-256 mismatch")\n        }\n        Log.i(TAG, "APK SHA-256 verified")\n    }\n\n'''
if 'private fun verifyFileSha256' not in s:
    if insert_before not in s:
        raise SystemExit('AutoUpdater helper insertion target not found')
    s = s.replace(insert_before, helper + insert_before, 1)
p.write_text(s, encoding='utf-8')
