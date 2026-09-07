package org.mdmopen.dpc

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** A push from the server means "there is something new" - schedule reliable work. */
class MdmMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        SyncScheduler.enqueueImmediate(
            applicationContext,
            retryUpdate = message.data["action"] == "retry_update",
        )
    }

    override fun onNewToken(token: String) {
        // FirebaseMessaging.getInstance().token returns the current token inside
        // PushRegistration. WorkManager adds network constraints and retry/backoff.
        SyncScheduler.enqueuePushTokenRegistration(applicationContext)
    }
}
