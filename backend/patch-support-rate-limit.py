from pathlib import Path

p = Path('backend/index.js')
s = p.read_text()
marker = "// ---------- customer support tickets ----------\n\napp.post('/api/devices/:deviceId/support-tickets', requireDevice, wrap(async (req, res) => {"
replacement = """// ---------- customer support tickets ----------\n\n// Device-facing support endpoints are authenticated, but auth alone does not\n// prevent a compromised/buggy managed device from flooding support storage or\n// repeatedly polling the database. Keep write/read budgets separate: creating\n// tickets is intentionally much tighter than reading a customer's own history.\n// The limiter runs after requireDevice so unauthorized traffic is rejected by\n// device auth first; successful devices are then bounded per source IP.\nconst supportTicketCreateLimiter = rateLimit({\n  windowMs: 15 * 60 * 1000,\n  limit: 10,\n  standardHeaders: 'draft-7',\n  legacyHeaders: false,\n  message: { error: 'too many support requests; try again later' },\n});\n\nconst supportTicketReadLimiter = rateLimit({\n  windowMs: 60 * 1000,\n  limit: 60,\n  standardHeaders: 'draft-7',\n  legacyHeaders: false,\n  message: { error: 'too many support refreshes; try again shortly' },\n});\n\napp.post('/api/devices/:deviceId/support-tickets', requireDevice, supportTicketCreateLimiter, wrap(async (req, res) => {"""
if marker not in s:
    raise SystemExit('support POST marker not found')
s = s.replace(marker, replacement, 1)
old = "app.get('/api/devices/:deviceId/support-tickets', requireDevice, wrap(async (req, res) => {"
new = "app.get('/api/devices/:deviceId/support-tickets', requireDevice, supportTicketReadLimiter, wrap(async (req, res) => {"
if old not in s:
    raise SystemExit('support GET marker not found')
s = s.replace(old, new, 1)
p.write_text(s)
