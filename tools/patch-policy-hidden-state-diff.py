from pathlib import Path

p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt')
s = p.read_text(encoding='utf-8')
old = '''        val failed = mutableListOf<String>()
        for (pkg in toSuspend) {
            if (!dpm.setApplicationHidden(admin, pkg, true)) failed += pkg
        }
        for (pkg in toUnsuspend) {
            if (!dpm.setApplicationHidden(admin, pkg, false)) failed += pkg
        }
'''
new = '''        val failed = mutableListOf<String>()

        fun applyHiddenStateIfNeeded(pkg: String, shouldHide: Boolean) {
            try {
                if (dpm.isApplicationHidden(admin, pkg) == shouldHide) return
                if (!dpm.setApplicationHidden(admin, pkg, shouldHide)) failed += pkg
            } catch (_: Exception) {
                failed += pkg
            }
        }

        for (pkg in toSuspend) {
            applyHiddenStateIfNeeded(pkg, true)
        }
        for (pkg in toUnsuspend) {
            applyHiddenStateIfNeeded(pkg, false)
        }
'''
if old not in s:
    raise SystemExit('PolicyEnforcer hidden-state block not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
