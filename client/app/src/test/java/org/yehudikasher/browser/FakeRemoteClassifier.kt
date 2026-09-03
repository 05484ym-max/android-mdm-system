package org.yehudikasher.browser

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Test double standing in for the real (server-managed, HTTP-backed)
 * classifier - no network, no real HttpRemoteClassifier involved anywhere
 * in these tests. Records an invocation count per key so a test can prove
 * de-duplication/caching actually happened rather than just guessing from
 * timing, and supports an artificial delay (or an explicit gate a test
 * releases on demand) to exercise RemotePolicyGate's timeout and
 * concurrency-coalescing behavior deterministically.
 */
class FakeRemoteClassifier(
    private val hostResponses: Map<String, RemoteDecision> = emptyMap(),
    private val imageResponses: Map<String, RemoteDecision> = emptyMap(),
    private val delayMs: Long = 0,
    private val defaultDecision: RemoteDecision = RemoteDecision.BLOCK,
) : RemoteClassifier {
    val hostInvocationCounts = ConcurrentHashMap<String, AtomicInteger>()
    val imageInvocationCounts = ConcurrentHashMap<String, AtomicInteger>()

    /** When set, every classify call blocks here until the test releases
     * it - proves concurrent callers for the same key really do share one
     * in-flight call rather than each independently reaching the fake. */
    var gate: CountDownLatch? = null

    override fun classifyHost(host: String): RemoteDecision {
        hostInvocationCounts.computeIfAbsent(host) { AtomicInteger(0) }.incrementAndGet()
        block()
        return hostResponses[host] ?: defaultDecision
    }

    override fun classifyImage(url: String): RemoteDecision {
        imageInvocationCounts.computeIfAbsent(url) { AtomicInteger(0) }.incrementAndGet()
        block()
        return imageResponses[url] ?: defaultDecision
    }

    override fun classifyVideo(url: String): RemoteDecision = defaultDecision

    private fun block() {
        gate?.await(10, TimeUnit.SECONDS)
        if (delayMs > 0) Thread.sleep(delayMs)
    }
}
