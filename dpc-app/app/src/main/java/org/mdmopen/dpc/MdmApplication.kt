package org.mdmopen.dpc

import android.app.Application
import android.util.Log
import kotlin.concurrent.thread

class MdmApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(CustomerUiPolish())

        // If Android killed the process immediately after provisioning, the QR
        // credentials are already persisted. Re-arm durable enrollment on the
        // next process start without making the setup wizard wait for network.
        runCatching { PostProvisionEnrollmentScheduler.enqueueIfPending(this) }
            .onFailure { Log.w("MdmApplication", "Could not resume pending enrollment", it) }

        // Capability probing may execute OEM getprop checks, so keep it off the
        // main thread. Failure must never block the existing Device Owner flow.
        thread(name = "mdm-capability-detect", isDaemon = true) {
            runCatching { CapabilitySnapshotStore.refresh(this) }
                .onFailure { Log.w("MdmApplication", "Capability detection failed", it) }
        }
    }
}
