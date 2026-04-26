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
