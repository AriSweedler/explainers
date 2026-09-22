// Critical-path byte budget: gzip of the article HTML (inline posters
// included) + the runtime + the shared CSS + the KaTeX CSS. Fonts, the lazy 3D
// chunk and external images are off the critical path and not counted.
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { attr, byTag } from './html.mjs';

export const DEFAULT_BUDGET = '170k';

// "170k" | "170kb" -> 170_000; "170kib" -> 174_080; "1.5m" -> 1_500_000; "170000" -> 170000
export function parseBudget(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(k|kb|kib|m|mb|mib)?$/i.exec(String(s).trim());
  if (!m) throw new Error(`bad --budget "${s}"; use e.g. 170k, 170kib or 170000`);
  const unit = (m[2] || '').toLowerCase();
  const mult = { '': 1, k: 1e3, kb: 1e3, kib: 1024, m: 1e6, mb: 1e6, mib: 1024 ** 2 }[unit];
  return Math.round(Number(m[1]) * mult);
}

const gz = (buf) => gzipSync(buf, { level: 9 }).length;

// Resolve an include relative to the article; fall back to the repo's dist/ or
// assets/ so fixtures outside articles/ still measure the real files.
function resolveInclude(file, ref, repoRoot) {
  const local = path.resolve(path.dirname(file), ref);
  if (fs.existsSync(local)) return local;
  const idx = ref.search(/(?:^|\/)(dist|assets)\//);
  if (idx >= 0) {
    const fromRoot = path.join(repoRoot, ref.slice(idx).replace(/^\//, ''));
    if (fs.existsSync(fromRoot)) return fromRoot;
  }
  return null;
}

export function measure(file, html, doc, repoRoot) {
  const items = [{ label: 'article html', path: file, gz: gz(Buffer.from(html)) }];
  const refs = [
    ...byTag(doc, 'script').map((s) => attr(s, 'src')).filter((s) => s && /explainers-runtime\.v\d+\.js$/.test(s)),
    ...byTag(doc, 'link').map((l) => attr(l, 'href')).filter((h) => h && /(explainers\.v\d+\.css|katex\.min\.css)$/.test(h)),
  ];
  for (const ref of refs) {
    const resolved = resolveInclude(file, ref, repoRoot);
    items.push(resolved ? { label: path.basename(ref), path: resolved, gz: gz(fs.readFileSync(resolved)) } : { label: path.basename(ref), path: ref, gz: 0, missing: true });
  }
  return { items, total: items.reduce((n, i) => n + i.gz, 0) };
}

export function checkBudget(file, html, doc, repoRoot, budgetBytes, problems) {
  const report = measure(file, html, doc, repoRoot);
  for (const i of report.items) if (i.missing) problems.warn(file, 0, null, `not counted: ${i.path} not found`);
  if (report.total > budgetBytes) {
    problems.error(file, 0, 'BUDGET_OVER', null, `${report.total} gzip bytes on the critical path; budget ${budgetBytes} (${report.items.map((i) => `${i.label} ${i.gz}`).join(', ')})`);
  }
  return report;
}

export function formatReport(report, budgetBytes) {
  const lines = report.items.map((i) => `  ${String(i.gz).padStart(8)}  ${i.label}${i.missing ? '  (missing)' : ''}`);
  lines.push(`  ${String(report.total).padStart(8)}  total gzip bytes (budget ${budgetBytes}, ${report.total <= budgetBytes ? 'ok' : 'OVER'})`);
  return lines.join('\n');
}
