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

            // A routine push ("sync") only refreshes policy/health - it never
            // implies an update attempt. Only the admin's explicit "retry
            // update" action sends this distinct action value, mirroring the
            // manual sync-then-check pattern already used by the on-device
            // "sync now" buttons in CustomerActivity/AppStoreActivity. This runs
            // in its own try/catch, independent of whether the sync above
            // succeeded - an explicit admin retry-update request should still
            // attempt the update check even when the routine sync failed, and
            // a failure here must not crash this thread either.
            if (message.data["action"] == "retry_update") {
                try {
                    AutoUpdater.check(applicationContext)
                } catch (e: Exception) {
                    Log.w(PolicySync.TAG, "Retry-update check failed", e)
                }
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
