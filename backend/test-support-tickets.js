const assert = require('assert');
const crypto = require('crypto');
const db = require('./db');

(async () => {
  await db.init();
  const deviceId = String(Math.floor(1000000000 + Math.random() * 9000000000));
  const id = crypto.randomUUID();
  await db.createDevice(deviceId, crypto.createHash('sha256').update('support-test-token').digest('hex'));
  try {
    await db.setCustomerInfo(deviceId, 'Support Test', '0500000000');
    const created = await db.createSupportTicket(deviceId, id, 'בעיה בבדיקה', 'תוכן פנייה');
    assert.equal(created.status, 'OPEN');
    assert.equal(created.deviceId, deviceId);

    const own = await db.listSupportTicketsForDevice(deviceId);
    assert(own.some(t => t.id === id));

    const admin = await db.listSupportTicketsForAdmin();
    const adminTicket = admin.find(t => t.id === id);
    assert(adminTicket);
    assert.equal(adminTicket.customerName, 'Support Test');

    const updated = await db.updateSupportTicket(id, 'RESOLVED', 'טופל בהצלחה');
    assert.equal(updated.status, 'RESOLVED');
    assert.equal(updated.adminReply, 'טופל בהצלחה');
    assert(updated.resolvedAt);

    await db.updateSupportTicket(id, 'IN_PROGRESS', 'בודקים');
    const reopened = (await db.listSupportTicketsForDevice(deviceId)).find(t => t.id === id);
    assert.equal(reopened.status, 'IN_PROGRESS');
    assert.equal(reopened.resolvedAt, null);

    console.log('support ticket integration: PASS');
  } finally {
    await db.deleteDevice(deviceId);
    process.exit(0);
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
