from pathlib import Path
p = Path('backend/index.js')
s = p.read_text()
old = "const fullOpenAdminLimiter = rateLimit({\n  windowMs: 60 * 1000,\n  limit: 30,\n  standardHeaders: 'draft-7',\n  legacyHeaders: false,\n  message: { error: 'too many full-open changes; try again shortly' },\n});\n\napp.post('/api/devices/:deviceId/full-open', requireAdmin, fullOpenAdminLimiter, wrap(async (req, res) => {\n"
new = "const fullOpenPreAuthLimiter = rateLimit({\n  windowMs: 60 * 1000,\n  limit: 120,\n  standardHeaders: 'draft-7',\n  legacyHeaders: false,\n  message: { error: 'too many full-open requests; try again shortly' },\n});\n\nconst fullOpenAdminLimiter = rateLimit({\n  windowMs: 60 * 1000,\n  limit: 30,\n  standardHeaders: 'draft-7',\n  legacyHeaders: false,\n  message: { error: 'too many full-open changes; try again shortly' },\n});\n\napp.post('/api/devices/:deviceId/full-open', fullOpenPreAuthLimiter, requireAdmin, fullOpenAdminLimiter, wrap(async (req, res) => {\n"
if old not in s:
    raise SystemExit('full-open limiter marker not found')
p.write_text(s.replace(old, new, 1))
print('CodeQL full-open limiter hardening applied')
