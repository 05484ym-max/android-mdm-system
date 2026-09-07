from pathlib import Path
import re

p = Path('backend/index.js')
s = p.read_text()

# A6: replace the hand-rolled Map login limiter with express-rate-limit.
pattern = re.compile(r"const loginAttempts = new Map\(\);.*?app\.post\('/api/login', \(req, res\) => \{\n  if \(loginRateLimited\(req\.ip\)\) \{\n    return res\.status\(429\)\.json\(\{ error: 'too many attempts, try again later' \}\);\n  \}\n", re.S)
replacement = """const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many attempts, try again later' },
});

app.post('/api/login', loginLimiter, (req, res) => {
"""
s, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit('login limiter block not found')

# A1: strengthen enrollment token entropy from 32 bits to 128 bits.
old = "const token = crypto.randomBytes(4).toString('hex').toUpperCase();"
new = "const token = crypto.randomBytes(16).toString('hex').toUpperCase();"
if old not in s:
    raise SystemExit('enrollment token generator not found')
s = s.replace(old, new, 1)

# A1: bound anonymous registration attempts before token lookup/consumption.
route = "app.post('/api/devices/register', wrap(async (req, res) => {"
insert = """const deviceRegistrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many device registration attempts; try again later' },
});

app.post('/api/devices/register', deviceRegistrationLimiter, wrap(async (req, res) => {"""
if route not in s:
    raise SystemExit('device registration route not found')
s = s.replace(route, insert, 1)

p.write_text(s)
