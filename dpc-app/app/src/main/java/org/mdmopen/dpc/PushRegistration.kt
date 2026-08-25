package org.mdmopen.dpc

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.TimeUnit

/** Keeps the server's copy of this device's push token up to date. */
object PushRegistration {

    fun ensureRegistered(context: Context) {
        val deviceToken = Config.deviceToken(context) ?: return
        val serverUrl = Config.serverUrl(context)
        if (serverUrl.isEmpty()) return

        val pushToken = try {
            Tasks.await(FirebaseMessaging.getInstance().token, 15, TimeUnit.SECONDS)
        } catch (e: Exception) {
            Log.w(PolicySync.TAG, "Could not obtain a push token", e)
            return
        }

        if (pushToken == Config.pushToken(context)) return

        ApiClient(serverUrl, deviceToken)
            .registerPushToken(Config.deviceId(context), pushToken)
        Config.setPushToken(context, pushToken)
        Log.i(PolicySync.TAG, "Push token registered")
    }
}
