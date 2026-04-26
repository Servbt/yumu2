import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const source = fs.readFileSync(new URL('./userRoutes.js', import.meta.url), 'utf8');

function extractRunYtDlpBody(code) {
  const marker = 'async function runYtDlp(videoUrl, outputTemplate) {';
  const start = code.indexOf(marker);
  assert.notEqual(start, -1, 'runYtDlp function should exist');

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

  throw new Error('Could not extract runYtDlp body');
}

test('runYtDlp uses a merged video+audio selector for the retry fallback', () => {
  const body = extractRunYtDlpBody(source);
  assert.match(
    body,
    /runYtDlpWithFormat\(videoUrl, outputTemplate, 'bestvideo\*\+bestaudio\/best'\)/,
    'retry fallback should stay merge-friendly instead of downgrading to plain best'
  );
});
