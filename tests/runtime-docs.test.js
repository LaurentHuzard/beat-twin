import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateRuntimeDocs } from '../scripts/check-runtime-docs.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  packageJsonText: readFileSync(resolve(repoRoot, 'package.json'), 'utf8'),
  readmeText: readFileSync(resolve(repoRoot, 'README.md'), 'utf8'),
  runtimeGuideText: readFileSync(
    resolve(repoRoot, 'docs/RTX_BITWIG_PREVIEW_RUNTIME.md'),
    'utf8',
  ),
  ciText: readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8'),
};

test('runtime documentation matches package and CI contracts', () => {
  assert.deepEqual(validateRuntimeDocs(files), []);
});

test('runtime documentation check rejects a stale Node 24 README', () => {
  const staleFiles = {
    ...files,
    readmeText: files.readmeText
      .replace('Node.js 26 or newer', 'Node.js 24')
      .replace('`>=26.0.0`', '`>=24.0.0`'),
  };

  assert.match(
    validateRuntimeDocs(staleFiles).join('\n'),
    /README must document Node\.js 26\+/,
  );
});

test('runtime documentation check rejects CI below the engine floor', () => {
  const staleFiles = {
    ...files,
    ciText: files.ciText
      .replace('node: [26]', 'node: [24]')
      .replace('node-version: 26', 'node-version: 24'),
  };

  assert.match(
    validateRuntimeDocs(staleFiles).join('\n'),
    /CI must not run a Node major below 26/,
  );
});
