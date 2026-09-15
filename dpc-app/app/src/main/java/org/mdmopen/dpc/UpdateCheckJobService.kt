package org.mdmopen.dpc

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicLong

class UpdateCheckJobService : JobService() {

    private val runGeneration = AtomicLong(0)

    @Volatile
    private var executor: ExecutorService? = null

    @Volatile
    private var runningTask: Future<*>? = null

    override fun onStartJob(params: JobParameters?): Boolean {
        // Invalidate any stale callback from an older run before starting a new
        // one. JobScheduler normally serializes one JobService instance, but
        // OEMs can stop/restart aggressively and the old worker must never call
        // jobFinished() for the new run.
        val generation = runGeneration.incrementAndGet()
        runningTask?.cancel(true)
        executor?.shutdownNow()

        val newExecutor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "mdm-update-check").apply { isDaemon = true }
        }
        executor = newExecutor
        runningTask = newExecutor.submit {
            try {
                AutoUpdater.checkBlocking(applicationContext)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                Log.i(TAG, "Scheduled update check interrupted")
            } catch (e: Exception) {
                Log.w(TAG, "Scheduled update check failed", e)
            } finally {
                // Only the currently-active generation may finish/reschedule the
                // Android job. A stopped/replaced worker simply exits.
                if (runGeneration.get() == generation && !Thread.currentThread().isInterrupted) {
                    jobFinished(params, false)
                    UpdateCheckScheduler.scheduleNext(applicationContext)
                }
                newExecutor.shutdown()
            }
        }

        return true
    }

    override fun onStopJob(params: JobParameters?): Boolean {
        // Invalidate the worker first, then cancel it. Even if an OEM/network
        // call ignores interruption temporarily, its late finally block cannot
        // finish or reschedule a newer job anymore.
        runGeneration.incrementAndGet()
        runningTask?.cancel(true)
        runningTask = null
        executor?.shutdownNow()
        executor = null

        // Let JobScheduler retry this interrupted run. We deliberately do not
        // schedule a second job here, avoiding duplicate update checks.
        return true
    }

    override fun onDestroy() {
        runningTask?.cancel(true)
        executor?.shutdownNow()
        runningTask = null
        executor = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MdmAutoUpdater"
    }
}
