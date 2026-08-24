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

// Keep whatever is already configured (DATABASE_URL and friends).
const settings = new Map();
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    settings.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
}

settings.set('ADMIN_USERNAME', username);
settings.set('ADMIN_PASSWORD_HASH', bcrypt.hashSync(password, 10));
if (!settings.get('JWT_SECRET')) {
  settings.set('JWT_SECRET', crypto.randomBytes(32).toString('hex'));
}

fs.writeFileSync(
  envPath,
  [...settings].map(([key, value]) => `${key}=${value}`).join('\n') + '\n',
  { mode: 0o600 },
);

console.log('Admin credentials saved. Restart the server for them to take effect.');
