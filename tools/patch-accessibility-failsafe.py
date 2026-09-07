from pathlib import Path

p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/SyncScheduler.kt')
s = p.read_text(encoding='utf-8')
s = s.replace(
    '    private const val UNIQUE_PUSH_TOKEN_WORK = "push-token-registration"\n',
    '    private const val UNIQUE_PUSH_TOKEN_WORK = "push-token-registration"\n    private const val UNIQUE_ACCESSIBILITY_RELOCK_WORK = "accessibility-policy-relock"\n',
    1,
)
anchor = '''    /** The latest Firebase token wins; transient network failures are retried. */\n    fun enqueuePushTokenRegistration(context: Context) {\n'''
method = '''    /**\n     * Independent failsafe for Samsung accessibility setup. This intentionally\n     * has no network constraint: its only job is to restore the local Device\n     * Owner accessibility allowlist even if the Activity/process dies.\n     */\n    fun enqueueAccessibilityRelock(context: Context) {\n        val appContext = context.applicationContext\n        val request = OneTimeWorkRequestBuilder<AccessibilityRelockWorker>()\n            .setInitialDelay(8, TimeUnit.SECONDS)\n            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)\n            .build()\n\n        WorkManager.getInstance(appContext).enqueueUniqueWork(\n            UNIQUE_ACCESSIBILITY_RELOCK_WORK,\n            ExistingWorkPolicy.REPLACE,\n            request,\n        )\n    }\n\n'''
if anchor not in s:
    raise SystemExit('SyncScheduler insertion anchor not found')
s = s.replace(anchor, method + anchor, 1)
p.write_text(s, encoding='utf-8')

p = Path('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt')
s = p.read_text(encoding='utf-8')
needle = '''        try { dpm.setPermittedAccessibilityServices(admin, null) } catch (_: Exception) {}\n    }\n\n    fun finishAccessibilitySetupWindow() {\n'''
replacement = '''        try { dpm.setPermittedAccessibilityServices(admin, null) } catch (_: Exception) {}\n        // Activity handler normally re-locks in 1.5s; WorkManager is a separate\n        // process/lifecycle failsafe so a crash cannot leave this relaxed.\n        SyncScheduler.enqueueAccessibilityRelock(context)\n    }\n\n    fun finishAccessibilitySetupWindow() {\n'''
if needle not in s:
    raise SystemExit('PolicyEnforcer failsafe anchor not found')
s = s.replace(needle, replacement, 1)
p.write_text(s, encoding='utf-8')
