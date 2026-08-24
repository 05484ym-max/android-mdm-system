const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error('Usage: node setup-admin.js <username> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const envPath = path.join(__dirname, '.env');
fs.writeFileSync(
  envPath,
  [
    `ADMIN_USERNAME=${username}`,
    `ADMIN_PASSWORD_HASH=${bcrypt.hashSync(password, 10)}`,
    `JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);

console.log('Admin credentials written to backend/.env');
console.log('Restart the server for them to take effect.');
