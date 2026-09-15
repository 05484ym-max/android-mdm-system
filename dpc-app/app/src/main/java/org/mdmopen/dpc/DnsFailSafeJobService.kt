package org.mdmopen.dpc

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicLong

/** Local DNS watchdog that remains safe across OEM stop/restart cycles. */
class DnsFailSafeJobService : JobService() {

    private val runGeneration = AtomicLong(0)

    @Volatile
    private var executor: ExecutorService? = null

    @Volatile
    private var runningTask: Future<*>? = null

    override fun onStartJob(params: JobParameters?): Boolean {
        val generation = runGeneration.incrementAndGet()
        runningTask?.cancel(true)
        executor?.shutdownNow()

        val newExecutor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "mdm-dns-failsafe").apply { isDaemon = true }
        }
        executor = newExecutor
        runningTask = newExecutor.submit {
            try {
                AdBlockDns.runFailSafeCheckCycle(applicationContext)
                    ?.let { Log.i(PolicySync.TAG, "DNS fail-safe watchdog: $it") }
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                Log.i(PolicySync.TAG, "DNS fail-safe watchdog interrupted")
            } catch (e: Exception) {
                Log.w(PolicySync.TAG, "DNS fail-safe watchdog failed", e)
            } finally {
                if (runGeneration.get() == generation && !Thread.currentThread().isInterrupted) {
                    jobFinished(params, false)
                }
                newExecutor.shutdown()
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters?): Boolean {
        runGeneration.incrementAndGet()
        runningTask?.cancel(true)
        runningTask = null
        executor?.shutdownNow()
        executor = null
        return true
    }

    override fun onDestroy() {
        runGeneration.incrementAndGet()
        runningTask?.cancel(true)
        executor?.shutdownNow()
        runningTask = null
        executor = null
        super.onDestroy()
    }
}
