from pathlib import Path

p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/AutoUpdater.kt')
s = p.read_text(encoding='utf-8')
old = '''        val oldCerts =
            installed.signingInfo.apkContentsSigners
                .map { sha256(it.toByteArray()) }
                .toSet()

        val newCerts =
            archive.signingInfo.apkContentsSigners
                .map { sha256(it.toByteArray()) }
                .toSet()
'''
new = '''        val installedSigningInfo = installed.signingInfo
            ?: error("Installed DPC signing information unavailable")
        val archiveSigningInfo = archive.signingInfo
            ?: error("Update APK signing information unavailable")

        val oldCerts =
            installedSigningInfo.apkContentsSigners
                .map { sha256(it.toByteArray()) }
                .toSet()

        val newCerts =
            archiveSigningInfo.apkContentsSigners
                .map { sha256(it.toByteArray()) }
                .toSet()

        if (oldCerts.isEmpty() || newCerts.isEmpty()) {
            error("APK signing certificate unavailable")
        }
'''
if old not in s:
    raise SystemExit('signingInfo target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
