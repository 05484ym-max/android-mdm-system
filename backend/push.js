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
 * Returns { sent, reason } so callers can distinguish a transient send failure
 * from a permanently dead registration token. reliabilityBridge clears dead
 * tokens from the DB by value without ever exposing them to the browser.
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
    const code = String(err && err.code ? err.code : '');
    if (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token') {
      console.warn('Push token is no longer registered; it will be pruned.');
      return { sent: false, reason: 'token_unregistered' };
    }
    console.warn('Push failed:', err.message);
    return { sent: false, reason: 'send_failed' };
  }
}

module.exports = { wake };
