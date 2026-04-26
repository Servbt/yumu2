import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const source = fs.readFileSync(new URL('./userRoutes.js', import.meta.url), 'utf8');

function extractFunctionBody(code, signature) {
  const start = code.indexOf(signature);
  assert.notEqual(start, -1, `${signature} should exist`);

  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') {
      depth += 1;
      if (bodyStart === -1) {
        bodyStart = i + 1;
      }
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && bodyStart !== -1) {
        return code.slice(bodyStart, i);
      }
    }
  }

  throw new Error(`Could not extract function body for ${signature}`);
}

test('worker proxy configuration reads URL and secret from env', () => {
  const body = extractFunctionBody(source, 'function getWorkerConfig() {');
  assert.match(body, /DOWNLOADER_WORKER_URL/);
  assert.match(body, /DOWNLOADER_WORKER_SECRET/);
});

test('worker proxy sends authenticated POST requests with JSON payload', () => {
  const body = extractFunctionBody(source, 'async function proxyWorkerDownload(req, res, workerPath, payload, fallbackFilename) {');
  assert.match(body, /x-worker-secret/);
  assert.match(body, /JSON\.stringify\(payload\)/);
  assert.match(body, /response\.arrayBuffer\(\)/);
});

test('single download route attempts worker proxy before local yt-dlp fallback', () => {
  const body = extractFunctionBody(source, "router.post('/download', async \(req, res, next\) => {");
  assert.match(body, /proxyWorkerDownload\(/);
  assert.match(body, /if \(proxied\) \{/);
  assert.match(body, /runYtDlp\(videoUrl, outputTemplate\)/);
});

test('playlist download route attempts worker proxy before local processing', () => {
  const body = extractFunctionBody(source, "router.post('/download-zip', async \(req, res\) => {");
  assert.match(body, /proxyWorkerDownload\(/);
  assert.match(body, /if \(proxied\) \{/);
  assert.match(body, /const downloadedFiles = \[\]/);
});

test('skipped videos endpoint is session-scoped via helper map', () => {
  assert.match(source, /function setSkippedVideos\(sessionId, videos\)/);
  assert.match(source, /function getSkippedVideos\(sessionId\)/);
  assert.match(source, /res\.json\(\{ skippedVideos: getSkippedVideos\(req\.sessionID\) \}\)/);
});
