from pathlib import Path

root = Path('dpc-app/app/src/main/java/org/mdmopen/dpc')

# 1) Recover a stale temporary install-unblock after process death/reboot.
p = root / 'AutoUpdater.kt'
s = p.read_text()
needle = '''    fun restoreInstallBlock(context: Context) {\n'''
replacement = '''    fun recoverInstallBlockIfNeeded(context: Context) {\n        val prefs = context.getSharedPreferences(\n            "dpc_updater",\n            Context.MODE_PRIVATE\n        )\n        if (!prefs.getBoolean("install_in_progress", false)) return\n\n        Log.w(TAG, "Recovering stale install-in-progress state")\n        restoreInstallBlock(context)\n    }\n\n    fun restoreInstallBlock(context: Context) {\n'''
if needle not in s:
    raise SystemExit('AutoUpdater restore marker not found')
s = s.replace(needle, replacement, 1)
p.write_text(s)

# 2) Boot must close any install window before normal schedulers run.
p = root / 'BootReceiver.kt'
s = p.read_text()
needle = '''        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return\n        if (Config.serverUrl(context).isEmpty()) return\n'''
replacement = '''        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return\n        AutoUpdater.recoverInstallBlockIfNeeded(context)\n        if (Config.serverUrl(context).isEmpty()) return\n'''
if needle not in s:
    raise SystemExit('BootReceiver marker not found')
s = s.replace(needle, replacement, 1)
p.write_text(s)

# 3) Every successful policy sync should trigger the signed self-updater.
p = root / 'PolicySync.kt'
s = p.read_text()
needle = '''        val outcomes = result.commands.map { queued ->\n            try {\n                executor.execute(queued)\n            } catch (e: Exception) {\n                "פקודה ${queued.command} נכשלה: ${e.message}"\n            }\n        }\n\n        return buildString {\n'''
replacement = '''        val outcomes = result.commands.map { queued ->\n            try {\n                executor.execute(queued)\n            } catch (e: Exception) {\n                "פקודה ${queued.command} נכשלה: ${e.message}"\n            }\n        }\n\n        // Successful manual, scheduled and push-triggered syncs all request an\n        // immediate signed DPC update check. AutoUpdater is asynchronous and\n        // internally guarded against concurrent runs.\n        AutoUpdater.check(context.applicationContext)\n\n        return buildString {\n'''
if needle not in s:
    raise SystemExit('PolicySync marker not found')
s = s.replace(needle, replacement, 1)
p.write_text(s)
