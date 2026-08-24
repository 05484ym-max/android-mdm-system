require('dotenv').config();
const db = require('./db');

(async () => {
  await db.init();
  const devices = await db.listDevices();
  console.log(`OK - schema ready, ${devices.length} devices in the database.`);
  process.exit(0);
})().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
