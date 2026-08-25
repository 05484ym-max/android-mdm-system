const admin = require('firebase-admin');

let messaging = null;

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (serviceAccount) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccount)),
    });
    messaging = admin.messaging();
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
 */
async function wake(pushToken) {
  if (!messaging || !pushToken) return;
  try {
    await messaging.send({
      token: pushToken,
      data: { action: 'sync' },
      android: { priority: 'high' },
    });
  } catch (err) {
    console.warn('Push failed:', err.message);
  }
}

module.exports = { wake };
