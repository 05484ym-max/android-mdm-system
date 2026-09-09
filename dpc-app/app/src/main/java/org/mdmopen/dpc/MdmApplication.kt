package org.mdmopen.dpc

import android.app.Application
import android.util.Log
import kotlin.concurrent.thread

class MdmApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(CustomerUiPolish())

        // Capability probing may execute OEM getprop checks, so keep it off the
        // main thread. Failure must never block the existing Device Owner flow.
        thread(name = "mdm-capability-detect", isDaemon = true) {
            runCatching { CapabilitySnapshotStore.refresh(this) }
                .onFailure { Log.w("MdmApplication", "Capability detection failed", it) }
        }
    }
}
