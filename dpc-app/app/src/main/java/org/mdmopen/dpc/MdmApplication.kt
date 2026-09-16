package org.mdmopen.dpc

import android.app.Application
import android.util.Log
import kotlin.concurrent.thread

class MdmApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(CustomerUiPolish())

        runCatching { PlayStoreGate.recoverAfterProcessStart(this) }
            .onFailure { Log.e("MdmApplication", "Play install recovery failed", it) }

        runCatching { PostProvisionEnrollmentScheduler.enqueueIfPending(this) }
            .onFailure { Log.w("MdmApplication", "Could not resume pending enrollment", it) }

        thread(name = "mdm-capability-detect", isDaemon = true) {
            runCatching { CapabilitySnapshotStore.refresh(this) }
                .onFailure { Log.w("MdmApplication", "Capability detection failed", it) }
        }
    }
}
