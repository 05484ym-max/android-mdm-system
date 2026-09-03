package org.yehudikasher.browser

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Bounded-concurrency, cached, de-duplicated gateway in front of a
 * RemoteClassifier - this is the only place in the app that ever calls
 * into it. Three guarantees this class exists to make true regardless of
 * how many resources a page throws at it at once:
 *
 *  - never a Thread per resource: every check runs on one small, fixed-size
 *    executor, shared across every host/image/video check for the whole
 *    app's lifetime.
 *  - never a duplicate concurrent request for the same key: if a check for
 *    "host:example.com" is already in flight, a second caller asking about
 *    the same host joins that same in-flight result instead of issuing a
 *    second remote call.
 *  - never an unbounded wait: a check that doesn't resolve within
 *    `timeoutMs` resolves to ERROR for that caller - the in-flight call
 *    itself is left to finish (and, if it later resolves ALLOW/BLOCK, still
 *    gets cached for the next caller), it's just not waited on past the
 *    deadline.
 *
 * A resolved ALLOW or BLOCK is cached for this gate's lifetime (process
 * lifetime, in practice - one instance is shared for the app's whole
 * session). ERROR is deliberately never cached: a transient failure must
 * not permanently poison a host/resource that a later retry could resolve
 * cleanly - callers still have to treat ERROR as BLOCK for that one check
 * (see ImageFilterPolicy/BrowsingPolicyEngine), they just get to try again
 * next time rather than being stuck forever.
 */
class RemotePolicyGate(
    private val classifier: RemoteClassifier,
    poolSize: Int = DEFAULT_POOL_SIZE,
) {
    private val executor = Executors.newFixedThreadPool(poolSize)
    private val hostCache = ConcurrentHashMap<String, RemoteDecision>()
    private val imageCache = ConcurrentHashMap<String, RemoteDecision>()
    private val videoCache = ConcurrentHashMap<String, RemoteDecision>()
    private val inFlight = ConcurrentHashMap<String, Future<RemoteDecision>>()

    fun checkHostBlocking(host: String, timeoutMs: Long): RemoteDecision =
        resolve("host:$host", hostCache, timeoutMs) { classifier.classifyHost(host) }

    fun checkImageBlocking(url: String, timeoutMs: Long): RemoteDecision =
        resolve("image:$url", imageCache, timeoutMs) { classifier.classifyImage(url) }

    /** Not called from anywhere yet - see RemoteClassifier.classifyVideo's
     * own comment. Kept alongside checkHostBlocking/checkImageBlocking so
     * wiring it in later needs no new plumbing here. */
    fun checkVideoBlocking(url: String, timeoutMs: Long): RemoteDecision =
        resolve("video:$url", videoCache, timeoutMs) { classifier.classifyVideo(url) }

    fun checkHostAsync(host: String, timeoutMs: Long, callback: (RemoteDecision) -> Unit) {
        executor.execute { callback(checkHostBlocking(host, timeoutMs)) }
    }

    fun checkImageAsync(url: String, timeoutMs: Long, callback: (RemoteDecision) -> Unit) {
        executor.execute { callback(checkImageBlocking(url, timeoutMs)) }
    }

    /**
     * Caching and in-flight bookkeeping both happen *inside* the submitted
     * task itself - exactly once per key, no matter how many callers are
     * waiting on it or how many of them individually time out - rather
     * than in each caller's own get()/timeout handling. That matters: a
     * caller that hits `timeoutMs` returns ERROR for itself but must NOT
     * touch the shared in-flight entry, since the real remote call is
     * still running in the background; if it removed that entry, a new
     * caller arriving a moment later would start a genuinely duplicate
     * remote call for the same key instead of joining the one already in
     * flight.
     */
    private fun resolve(
        key: String,
        cache: ConcurrentHashMap<String, RemoteDecision>,
        timeoutMs: Long,
        call: () -> RemoteDecision,
    ): RemoteDecision {
        cache[key]?.let { return it }

        val future = inFlight.computeIfAbsent(key) {
            executor.submit<RemoteDecision> {
                try {
                    val decision = try {
                        call()
                    } catch (_: Exception) {
                        RemoteDecision.ERROR
                    }
                    if (decision != RemoteDecision.ERROR) cache[key] = decision
                    decision
                } finally {
                    inFlight.remove(key)
                }
            }
        }

        return try {
            future.get(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (_: TimeoutException) {
            RemoteDecision.ERROR
        } catch (_: Exception) {
            RemoteDecision.ERROR
        }
    }

    companion object {
        private const val DEFAULT_POOL_SIZE = 4
    }
}
