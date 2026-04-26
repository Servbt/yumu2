import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const source = fs.readFileSync(new URL('./userRoutes.js', import.meta.url), 'utf8');
const packageJson = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
const renderYaml = fs.readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');

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

test('runYtDlp uses a merged video+audio selector for the retry fallback', () => {
  const body = extractFunctionBody(source, 'async function runYtDlp(videoUrl, outputTemplate) {');
  assert.match(
    body,
    /runYtDlpWithFormat\(videoUrl, outputTemplate, 'bestvideo\*\+bestaudio\/best'\)/,
    'retry fallback should stay merge-friendly instead of downgrading to plain best'
  );
});

test('runYtDlpWithFormat does not force mp4 merge output before later ffmpeg transcoding', () => {
  const body = extractFunctionBody(source, 'function runYtDlpWithFormat(videoUrl, outputTemplate, format) {');
  assert.doesNotMatch(
    body,
    /'--merge-output-format'/,
    'yt-dlp invocation should not force mp4 merge output because the file is transcoded later'
  );
});

test('selector failures trigger a yt-dlp list-formats probe for diagnostics', () => {
  assert.match(
    source,
    /function probeYtDlpFormats\(videoUrl, cookiesPath\)[\s\S]*'--list-formats'/,
    'selector failures should trigger a list-formats probe for diagnostics'
  );
});

test('Render blueprint records a runtime-install hint for yt-dlp troubleshooting', () => {
  assert.match(
    renderYaml,
    /nodejs npm/,
    'Render config should preserve the JS-runtime troubleshooting hint'
  );
});

test('server can probe for a JavaScript runtime before invoking yt-dlp', () => {
  assert.match(
    source,
    /function hasJavaScriptRuntime\(\)[\s\S]*spawnSync\(/,
    'server should detect whether a JS runtime is available for yt-dlp challenge solving'
  );
});

test('cookie decoding normalizes whitespace in YT_DLP_COOKIES_B64', () => {
  const body = extractFunctionBody(source, 'function getYtDlpCookiesPath() {');
  assert.match(
    body,
    /encodedCookies\.replace\(\/\\s\+\/g, ''\)/,
    'cookie decoding should strip whitespace from base64 env input before decoding'
  );
});

test('cookie logging checks domains line-by-line instead of relying on a brittle whole-file regex', () => {
  const body = extractFunctionBody(source, 'function logCookieStatus(cookiesPath, source) {');
  assert.match(
    body,
    /split\(\/\\r\?\\n\/\)/,
    'cookie logging should inspect cookie rows line by line'
  );
  assert.match(
    body,
    /fields\[0\]/,
    'cookie logging should derive the domain from the Netscape cookie columns'
  );
});

test('cookie logging reports sample domains and cookie names without values', () => {
  const body = extractFunctionBody(source, 'function logCookieStatus(cookiesPath, source) {');
  assert.match(
    body,
    /sample domains=/,
    'cookie logging should include sample domains for debugging'
  );
  assert.match(
    body,
    /sample cookie names=/,
    'cookie logging should include sample cookie names for debugging without exposing values'
  );
});

test('package render-build still installs yt-dlp', () => {
  assert.match(
    packageJson,
    /python3 -m pip install yt-dlp/,
    'render-build should continue installing yt-dlp'
  );
});
