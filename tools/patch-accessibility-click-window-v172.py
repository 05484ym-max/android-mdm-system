from pathlib import Path

# Keep Samsung's Accessibility page usable until our own service is actually
# enabled. The previous 1.5s relock happened while the user was still inside
# Settings, which made the Accessibility row non-clickable again on the A31.
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt')
s = p.read_text(encoding='utf-8')
old = '''                startActivity(intent)\n                contentArea.postDelayed({\n                    try { PolicyEnforcer(this).allowManagedAccessibilityService() } catch (_: Exception) {}\n                }, 1500L)\n                return\n'''
new = '''                startActivity(intent)\n                // Do not re-apply the permitted-services allowlist on a fixed\n                // short timer while Samsung Settings is still open. On the A31\n                // that makes the Accessibility row non-clickable again. The\n                // service itself re-locks the allowlist as soon as Android\n                // confirms it is enabled; WorkManager remains a bounded fallback.\n                return\n'''
if old not in s:
    raise SystemExit('CustomerActivity timed relock target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# The independent lifecycle failsafe stays, but 8 seconds is too short for a
# human to reach and enable the service. Give the setup one minute; enabling the
# managed service re-locks immediately, so this is only the failure/abandon path.
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/SyncScheduler.kt')
s = p.read_text(encoding='utf-8')
old = '.setInitialDelay(8, TimeUnit.SECONDS)'
new = '.setInitialDelay(60, TimeUnit.SECONDS)'
if old not in s:
    raise SystemExit('SyncScheduler accessibility relock delay target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# The moment Android confirms our AccessibilityService is enabled, immediately
# restore the package-only allowlist. This closes the temporary broad
# accessibility window without waiting for the customer to return to our app.
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/WhatsAppGuardService.kt')
s = p.read_text(encoding='utf-8')
old = '''        WhatsAppGuardProtection.reconcile(this, WhatsAppGuardConfig.load(this))\n        scheduleRender()\n'''
new = '''        WhatsAppGuardProtection.reconcile(this, WhatsAppGuardConfig.load(this))\n        try {\n            val enforcer = PolicyEnforcer(applicationContext)\n            if (enforcer.isDeviceOwner()) {\n                enforcer.allowManagedAccessibilityService()\n            }\n        } catch (_: Exception) {\n            // The bounded WorkManager failsafe will retry the local relock.\n        }\n        scheduleRender()\n'''
if old not in s:
    raise SystemExit('WhatsAppGuardService onServiceConnected target not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# Keep comments accurate now that the normal path is event-driven rather than
# a 1.5 second Activity timer.
p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/AccessibilityRelockWorker.kt')
s = p.read_text(encoding='utf-8')
s = s.replace(
    'CustomerActivity normally re-applies the package-only accessibility allowlist\n * after 1.5 seconds and again when it resumes. This worker is deliberately\n',
    'WhatsAppGuardService re-applies the package-only accessibility allowlist as\n * soon as Android confirms it is enabled, and CustomerActivity does so again on\n * return. This worker is deliberately\n',
    1,
)
p.write_text(s, encoding='utf-8')
