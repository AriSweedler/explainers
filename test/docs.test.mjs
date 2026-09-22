// DESIGN.md's generated sections must equal what lib/ produces right now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyGenerated } from '../tools/gen-docs.mjs';
import { describeVocabulary, ERROR_CATALOGUE } from '../lib/spec.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const design = fs.readFileSync(path.join(root, 'DESIGN.md'), 'utf8');

test('DESIGN.md generated sections are current (node tools/gen-docs.mjs)', () => {
  assert.equal(applyGenerated(design), design, 'DESIGN.md is stale; run: node tools/gen-docs.mjs');
});

test('DESIGN.md contains the vocabulary, every error code and the phase-2 contract', () => {
  assert.ok(design.includes(describeVocabulary()));
  for (const code of Object.keys(ERROR_CATALOGUE)) assert.ok(design.includes(`\`${code}\``), code);
  for (const heading of ['## Expression grammar', '## Glossary contract', '## Authoring example', '## Phase 2 contract', '## Error catalogue']) {
    assert.ok(design.includes(heading), heading);
  }
});

test('README points at the tools and the template', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const s of ['tools/explainers.cjs validate', 'tools/explainers.cjs build', 'python3 -m http.server', 'template/article.html', 'DESIGN.md']) {
    assert.ok(readme.includes(s), s);
  }
});
