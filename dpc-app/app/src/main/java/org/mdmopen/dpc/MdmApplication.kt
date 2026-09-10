package org.mdmopen.dpc

import android.app.Application
import android.util.Log
import kotlin.concurrent.thread

class MdmApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(CustomerUiPolish())

        // Re-assert Device Owner anti-reset/anti-escape state whenever the app
        // process starts. This is local and does not depend on server reachability.
        runCatching { ResetProtection.enforce(this) }
            .onFailure { Log.w("MdmApplication", "Reset protection reassert failed", it) }

        // Capability probing may execute OEM getprop checks, so keep it off the
        // main thread. Failure must never block the existing Device Owner flow.
        thread(name = "mdm-capability-detect", isDaemon = true) {
            runCatching { CapabilitySnapshotStore.refresh(this) }
                .onFailure { Log.w("MdmApplication", "Capability detection failed", it) }
        }
    }
}
