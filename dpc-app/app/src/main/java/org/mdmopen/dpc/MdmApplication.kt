package org.mdmopen.dpc

import android.app.Application

class MdmApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(CustomerUiPolish())
    }
}
