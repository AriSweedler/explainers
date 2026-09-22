#!/usr/bin/env node
// Regenerates the generated sections of DESIGN.md from lib/spec.js and
// lib/expr.js so the documentation cannot drift from the validator.
// Markers:  <!-- generated:NAME --> ... <!-- /generated:NAME -->
// Usage: node tools/gen-docs.mjs [--check]   (--check exits 1 when stale)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeVocabulary, ERROR_CATALOGUE } from '../lib/spec.js';
import { describeFunctions } from '../lib/expr.js';

export function generatedSections() {
  const errors = ['| code | meaning |', '|---|---|', ...Object.entries(ERROR_CATALOGUE).map(([c, d]) => `| \`${c}\` | ${d} |`)].join('\n');
  return { vocabulary: describeVocabulary(), functions: describeFunctions(), errors };
}

export function applyGenerated(text) {
  let out = text;
  for (const [name, body] of Object.entries(generatedSections())) {
    const re = new RegExp(`(<!-- generated:${name} -->)[\\s\\S]*?(<!-- /generated:${name} -->)`);
    if (!re.test(out)) throw new Error(`DESIGN.md has no <!-- generated:${name} --> section`);
    out = out.replace(re, (_, open, close) => `${open}\n${body}\n${close}`);
  }
  return out;
}

export function updateDesignDoc(file, { check = false } = {}) {
  const before = fs.readFileSync(file, 'utf8');
  const after = applyGenerated(before);
  if (after === before) return false;
  if (!check) fs.writeFileSync(file, after);
  return true;
}

if (process.argv[1] && /gen-docs\.mjs$/.test(process.argv[1])) {
  const check = process.argv.includes('--check');
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../DESIGN.md');
  const changed = updateDesignDoc(file, { check });
  if (check && changed) { console.error('DESIGN.md generated sections are stale; run: node tools/gen-docs.mjs'); process.exit(1); }
  console.log(changed ? 'DESIGN.md updated' : 'DESIGN.md current');
}
