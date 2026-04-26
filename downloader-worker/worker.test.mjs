import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const source = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');

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

test('worker honors PYTHON_BIN override before defaulting to python3', () => {
  assert.match(source, /process\.env\.PYTHON_BIN \|\| 'python3'/);
});

test('worker logs errors for single-download failures', () => {
  const body = extractFunctionBody(source, "app.post('/download', requireWorkerAuth, async \(req, res\) => {");
  assert.match(body, /console\.error\('Worker single download failed:'/);
});

test('worker logs errors for playlist-download failures', () => {
  const body = extractFunctionBody(source, "app.post('/download-zip', requireWorkerAuth, async \(req, res\) => {");
  assert.match(body, /console\.error\('Worker playlist download failed:'/);
});

test('worker health endpoint reports whether yt-dlp cookie config and python command are set', () => {
  const body = extractFunctionBody(source, "app.get('/health', \(_req, res\) => {");
  assert.match(body, /pythonBin/);
  assert.match(body, /hasCookies/);
});
