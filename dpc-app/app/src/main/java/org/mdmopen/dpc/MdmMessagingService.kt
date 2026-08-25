package org.mdmopen.dpc

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** A push from the server means "there is something new" - sync straight away. */
class MdmMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        Thread {
            try {
                Log.i(PolicySync.TAG, "Push sync: ${PolicySync.run(applicationContext)}")
            } catch (e: Exception) {
                Log.w(PolicySync.TAG, "Push sync failed", e)
            }
        }.start()
    }

    override fun onNewToken(token: String) {
        Thread {
            try {
                val deviceToken = Config.deviceToken(applicationContext) ?: return@Thread
                ApiClient(Config.serverUrl(applicationContext), deviceToken)
                    .registerPushToken(Config.deviceId(applicationContext), token)
                Config.setPushToken(applicationContext, token)
            } catch (e: Exception) {
                Log.w(PolicySync.TAG, "Push token registration failed", e)
            }
        }.start()
    }
}
