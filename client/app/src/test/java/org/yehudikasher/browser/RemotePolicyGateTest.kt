package org.yehudikasher.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class RemotePolicyGateTest {

    @Test
    fun duplicateConcurrentChecks_areCoalescedIntoOneClassifierCall() {
        val classifier = FakeRemoteClassifier(hostResponses = mapOf("busy.example" to RemoteDecision.ALLOW))
        classifier.gate = CountDownLatch(1)
        val gate = RemotePolicyGate(classifier, poolSize = 4)

        val pool = Executors.newFixedThreadPool(5)
        val results = Collections.synchronizedList(mutableListOf<RemoteDecision>())
        val startedLatch = CountDownLatch(5)
        repeat(5) {
            pool.execute {
                startedLatch.countDown()
                results.add(gate.checkHostBlocking("busy.example", 5000))
            }
        }
        // Give every caller a real chance to reach the gate before
        // releasing the fake classifier - this is what actually proves
        // they share one in-flight call instead of each blocking on its
        // own separate one.
        assertTrue(startedLatch.await(2, TimeUnit.SECONDS))
        Thread.sleep(200)
        classifier.gate?.countDown()
        pool.shutdown()
        assertTrue(pool.awaitTermination(5, TimeUnit.SECONDS))

        assertEquals(5, results.size)
        assertTrue(results.all { it == RemoteDecision.ALLOW })
        assertEquals(1, classifier.hostInvocationCounts["busy.example"]?.get())
    }

    @Test
    fun aResolvedDecision_isCached_aSecondCallNeverReinvokesTheClassifier() {
        val classifier = FakeRemoteClassifier(hostResponses = mapOf("known.example" to RemoteDecision.BLOCK))
        val gate = RemotePolicyGate(classifier)

        assertEquals(RemoteDecision.BLOCK, gate.checkHostBlocking("known.example", 2000))
        assertEquals(RemoteDecision.BLOCK, gate.checkHostBlocking("known.example", 2000))

        assertEquals(1, classifier.hostInvocationCounts["known.example"]?.get())
    }

    @Test
    fun aSlowClassifier_resolvesToError_withinTheTimeout_ratherThanHanging() {
        val classifier = FakeRemoteClassifier(delayMs = 3000, defaultDecision = RemoteDecision.ALLOW)
        val gate = RemotePolicyGate(classifier)

        val start = System.currentTimeMillis()
        val decision = gate.checkHostBlocking("slow.example", 300)
        val elapsed = System.currentTimeMillis() - start

        assertEquals(RemoteDecision.ERROR, decision)
        assertTrue("expected to resolve near the 300ms timeout, not the 3000ms call itself; took ${elapsed}ms", elapsed < 1500)
    }

    @Test
    fun anErrorResult_isNeverCached_aLaterRetryCanStillSucceed() {
        var shouldFail = true
        val classifier = object : RemoteClassifier {
            override fun classifyHost(host: String) =
                if (shouldFail) RemoteDecision.ERROR else RemoteDecision.ALLOW
            override fun classifyImage(url: String) = RemoteDecision.ERROR
            override fun classifyVideo(url: String) = RemoteDecision.ERROR
        }
        val gate = RemotePolicyGate(classifier)

        assertEquals(RemoteDecision.ERROR, gate.checkHostBlocking("flaky.example", 2000))
        shouldFail = false
        assertEquals(RemoteDecision.ALLOW, gate.checkHostBlocking("flaky.example", 2000))
    }

    @Test
    fun hostAndImageCachesAreIndependent_sameStringDoesNotCrossOver() {
        val classifier = FakeRemoteClassifier(
            hostResponses = mapOf("same.example" to RemoteDecision.ALLOW),
            imageResponses = mapOf("same.example" to RemoteDecision.BLOCK),
        )
        val gate = RemotePolicyGate(classifier)

        assertEquals(RemoteDecision.ALLOW, gate.checkHostBlocking("same.example", 2000))
        assertEquals(RemoteDecision.BLOCK, gate.checkImageBlocking("same.example", 2000))
    }
}
