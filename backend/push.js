const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

let messaging = null;

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (serviceAccount) {
  try {
    const app = initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
    messaging = getMessaging(app);
    console.log('Push notifications enabled.');
  } catch (err) {
    console.error('Push notifications disabled:', err.message);
  }
} else {
  console.warn('FIREBASE_SERVICE_ACCOUNT is not set - devices will only poll.');
}

/**
 * Tells one device that something changed, so it syncs now instead of waiting
 * for its next poll. A failure here is never fatal: the poll is the fallback.
 * Returns { sent, reason } so a caller that cares (e.g. an explicit "retry
 * sync" action) can report the real outcome; existing callers that don't
 * check the return value are unaffected.
 *
 * `data` defaults to the plain sync nudge every existing caller relies on
 * (savePolicyAndWake, the /commands route, retry-sync). A caller that needs
 * the device to do something more than a routine sync - e.g. retry-update
 * also running AutoUpdater.check() - passes a different `action` value;
 * MdmMessagingService on the device branches on it.
 */
async function wake(pushToken, data = { action: 'sync' }) {
  if (!messaging) return { sent: false, reason: 'push_not_configured' };
  if (!pushToken) return { sent: false, reason: 'no_push_token' };
  try {
    await messaging.send({
      token: pushToken,
      data,
      android: { priority: 'high' },
    });
    return { sent: true };
  } catch (err) {
    console.warn('Push failed:', err.message);
    return { sent: false, reason: 'send_failed' };
  }
}

module.exports = { wake };
