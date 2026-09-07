from pathlib import Path

p = Path('backend/index.js')
s = p.read_text(encoding='utf-8')

old_login = '''const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

/** Slows down password guessing against the panel. */
function loginRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { first: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

app.post('/api/login', (req, res) => {
  if (loginRateLimited(req.ip)) {
    return res.status(429).json({ error: 'too many attempts, try again later' });
  }
'''
new_login = '''const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many attempts, try again later' },
});

app.post('/api/login', loginLimiter, (req, res) => {
'''
if old_login not in s:
    raise SystemExit('login limiter target not found')
s = s.replace(old_login, new_login, 1)

old_token = "const token = crypto.randomBytes(4).toString('hex').toUpperCase();"
new_token = "const token = crypto.randomBytes(16).toString('hex').toUpperCase();"
if old_token not in s:
    raise SystemExit('enrollment token target not found')
s = s.replace(old_token, new_token, 1)

old_register = "app.post('/api/devices/register', wrap(async (req, res) => {"
new_register = '''const deviceRegistrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many device registration attempts; try again later' },
});

app.post('/api/devices/register', deviceRegistrationLimiter, wrap(async (req, res) => {'''
if old_register not in s:
    raise SystemExit('device registration route target not found')
s = s.replace(old_register, new_register, 1)

p.write_text(s, encoding='utf-8')
