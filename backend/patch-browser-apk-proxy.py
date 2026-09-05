from pathlib import Path

p = Path(__file__).with_name('index.js')
s = p.read_text()
anchor = "app.use((err, req, res, next) => {"
if anchor not in s:
    raise SystemExit('anchor not found')
if "/downloads/yehudi-kasher-browser-latest.apk" in s:
    raise SystemExit('route already exists')

block = r'''
// ---------- stable filtered-browser APK download ----------
// Keep one customer-facing URL on our own backend. The upstream URL is
// fixed server-side (never user input), so this cannot be used as a generic
// proxy/SSRF primitive. GitHub's redirect chain is followed only across
// HTTPS github.com / *.githubusercontent.com hosts.
const LATEST_BROWSER_APK_UPSTREAM =
  'https://github.com/05484ym-max/android-mdm-system/releases/download/app-store-assets/yehudi-kasher-browser-latest.apk';
const BROWSER_APK_MAX_BYTES = 25 * 1024 * 1024;
const BROWSER_APK_MAX_REDIRECTS = 5;

function browserApkUpstreamHostAllowed(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'github.com' || host.endsWith('.githubusercontent.com');
}

function proxyLatestBrowserApk(res, url = LATEST_BROWSER_APK_UPSTREAM, redirectsLeft = BROWSER_APK_MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error('invalid browser APK upstream URL'));
    }
    if (parsed.protocol !== 'https:' || !browserApkUpstreamHostAllowed(parsed.hostname)) {
      return reject(new Error('browser APK upstream host is not allowed'));
    }

    const upstreamReq = https.get(parsed, {
      headers: {
        'User-Agent': 'Yehudi-Kasher-MDM/1.0',
        Accept: 'application/vnd.android.package-archive, application/octet-stream;q=0.9, */*;q=0.1',
      },
      timeout: 15000,
    }, upstream => {
      if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location) {
        upstream.resume();
        if (redirectsLeft <= 0) {
          return reject(new Error('too many redirects while fetching browser APK'));
        }
        let nextUrl;
        try {
          nextUrl = new URL(upstream.headers.location, parsed).toString();
        } catch {
          return reject(new Error('invalid browser APK redirect'));
        }
        return proxyLatestBrowserApk(res, nextUrl, redirectsLeft - 1).then(resolve, reject);
      }

      if (upstream.statusCode !== 200) {
        upstream.resume();
        return reject(new Error(`browser APK upstream returned HTTP ${upstream.statusCode}`));
      }

      const contentLength = Number.parseInt(upstream.headers['content-length'] || '0', 10);
      if (Number.isFinite(contentLength) && contentLength > BROWSER_APK_MAX_BYTES) {
        upstream.destroy();
        return reject(new Error('browser APK exceeds maximum size'));
      }

      res.status(200);
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="yehudi-kasher-browser-latest.apk"');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (contentLength > 0) res.setHeader('Content-Length', String(contentLength));

      let total = 0;
      upstream.on('data', chunk => {
        total += chunk.length;
        if (total > BROWSER_APK_MAX_BYTES) {
          upstream.destroy(new Error('browser APK exceeds maximum size'));
          if (!res.destroyed) res.destroy();
          return;
        }
        if (!res.destroyed) res.write(chunk);
      });
      upstream.on('end', () => {
        if (!res.destroyed) res.end();
        resolve();
      });
      upstream.on('error', err => {
        if (res.headersSent) {
          if (!res.destroyed) res.destroy();
          return resolve();
        }
        reject(err);
      });
    });

    upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('browser APK upstream timed out')));
    upstreamReq.on('error', reject);
  });
}

app.get('/downloads/yehudi-kasher-browser-latest.apk', async (req, res) => {
  try {
    await proxyLatestBrowserApk(res);
  } catch (err) {
    console.error('[browser-apk-download]', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'browser APK is temporarily unavailable' });
    } else if (!res.destroyed) {
      res.destroy();
    }
  }
});

'''

p.write_text(s.replace(anchor, block + anchor, 1))
