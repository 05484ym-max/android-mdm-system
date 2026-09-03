// A minimal local HTTP server standing in for an S3-compatible bucket
// (Cloudflare R2 in production) for tests only. This sandbox has no real
// R2/S3 credentials or network access to a real object store, so this is
// an honest, explicit stand-in - it is a REAL HTTP server that the REAL
// @aws-sdk/client-s3 talks to over REAL HTTP (exercising apkStorage.js's
// actual request/response handling, PutObjectCommand/DeleteObjectCommand
// usage, forcePathStyle routing, error propagation), not a mock of the SDK
// itself. It does not verify AWS SigV4 signatures - that would only prove
// our test double implements signature checking, not anything about
// apkStorage.js's own correctness - so it accepts any PUT/DELETE/GET
// unconditionally, which is sufficient to observe what apkStorage.js
// actually sends and how it reacts to real success/error HTTP responses.
'use strict';

const http = require('http');

function startFakeS3Server() {
  const objects = new Map();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      // The AWS SDK appends diagnostic query params (e.g. "?x-id=PutObject"
      // vs "?x-id=DeleteObject") that differ per operation even for the
      // exact same object - a real S3/R2 bucket identifies an object by
      // path alone, so this must too, or a PUT and a later DELETE for the
      // same key would look like two different objects here.
      const key = req.url.split('?')[0];
      if (req.method === 'PUT') {
        objects.set(key, { body: Buffer.concat(chunks), contentType: req.headers['content-type'] || null });
        res.writeHead(200, { etag: '"fake-etag"' });
        return res.end();
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const obj = objects.get(key);
        if (!obj) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { 'content-type': obj.contentType || 'application/octet-stream' });
        return res.end(req.method === 'GET' ? obj.body : undefined);
      }
      res.writeHead(405);
      res.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        objects,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

module.exports = { startFakeS3Server };
