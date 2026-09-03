'use strict';

const http = require('http');

function startFakeGitHubServer() {
  const assets = new Map();
  let release = null;
  let nextAssetId = 1000;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);

      const sendJson = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };

      const tagMatch = url.pathname.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/releases\/tags\/(.+)$/);
      if (req.method === 'GET' && tagMatch) {
        if (!release) return sendJson(404, { message: 'Not Found' });
        return sendJson(200, release);
      }

      const createReleaseMatch = url.pathname.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/releases$/);
      if (req.method === 'POST' && createReleaseMatch) {
        const payload = JSON.parse(body.toString('utf8') || '{}');
        release = {
          id: 77,
          tag_name: payload.tag_name,
          name: payload.name,
          draft: false,
          prerelease: false,
        };
        return sendJson(201, release);
      }

      const uploadMatch = url.pathname.match(/^\/uploads\/repos\/([^/]+)\/([^/]+)\/releases\/(\d+)\/assets$/);
      if (req.method === 'POST' && uploadMatch) {
        if (!release || Number(uploadMatch[3]) !== release.id) {
          return sendJson(404, { message: 'Release not found' });
        }
        const id = String(nextAssetId++);
        const name = url.searchParams.get('name') || `${id}.apk`;
        assets.set(id, {
          id,
          name,
          body,
          contentType: req.headers['content-type'] || null,
        });
        return sendJson(201, {
          id: Number(id),
          name,
          browser_download_url: `http://127.0.0.1/fake/${id}/${encodeURIComponent(name)}`,
        });
      }

      const assetMatch = url.pathname.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/releases\/assets\/(\d+)$/);
      if (assetMatch) {
        const id = assetMatch[3];
        const asset = assets.get(id);
        if (req.method === 'DELETE') {
          assets.delete(id);
          res.writeHead(asset ? 204 : 404);
          return res.end();
        }
        if (req.method === 'GET') {
          if (!asset) return sendJson(404, { message: 'Not Found' });
          if ((req.headers.accept || '').includes('application/octet-stream')) {
            const range = req.headers.range;
            if (range) {
              const match = /^bytes=(\d+)-(\d*)$/.exec(range);
              if (!match) {
                res.writeHead(416, { 'content-range': `bytes */${asset.body.length}` });
                return res.end();
              }
              const start = Number(match[1]);
              const requestedEnd = match[2] ? Number(match[2]) : asset.body.length - 1;
              const end = Math.min(requestedEnd, asset.body.length - 1);
              if (start > end || start >= asset.body.length) {
                res.writeHead(416, { 'content-range': `bytes */${asset.body.length}` });
                return res.end();
              }
              const slice = asset.body.subarray(start, end + 1);
              res.writeHead(206, {
                'content-type': asset.contentType || 'application/octet-stream',
                'content-length': String(slice.length),
                'content-range': `bytes ${start}-${end}/${asset.body.length}`,
                'accept-ranges': 'bytes',
              });
              return res.end(slice);
            }
            res.writeHead(200, {
              'content-type': asset.contentType || 'application/octet-stream',
              'content-length': String(asset.body.length),
              'accept-ranges': 'bytes',
            });
            return res.end(asset.body);
          }
          return sendJson(200, { id: Number(id), name: asset.name });
        }
      }

      sendJson(404, { message: 'Not Found' });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        assets,
        get release() { return release; },
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

module.exports = { startFakeGitHubServer };
