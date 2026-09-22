// The glossary markup contract (DESIGN.md "Glossary contract"):
//   first use   <dfn id="t-<slug>"><a href="#g-<slug>">term</a></dfn>
//   later uses  <a class="term" href="#g-<slug>">term</a>
//   rows        <details id="glossary" class="x-glossary"> ... <div class="row" id="g-<slug>">
//                 <dt>term <a class="x-back" href="#t-<slug>">↩</a></dt><dd>definition</dd>
import { attr, byTag, elements, elementChildren, hasClass, line, offset, textOf, closest } from './html.mjs';

const slugOf = (id, prefix) => (id && id.startsWith(prefix) ? id.slice(prefix.length) : null);

export function checkGlossary(doc, file, problems) {
  const main = byTag(doc, 'main')[0];
  const details = elements(doc, (n) => n.tagName === 'details' && attr(n, 'id') === 'glossary');
  let glossary = null;
  if (details.length !== 1) {
    problems.error(file, details[1] ? line(details[1]) : 0, 'GLOSSARY_NOT_LAST', null, details.length ? 'more than one <details id="glossary">' : 'no <details id="glossary" class="x-glossary"> found');
  } else {
    glossary = details[0];
    const last = main ? elementChildren(main).at(-1) : null;
    if (main && last !== glossary) problems.error(file, line(glossary), 'GLOSSARY_NOT_LAST', null, 'the glossary must be the last element inside <main>');
    if (!hasClass(glossary, 'x-glossary')) problems.error(file, line(glossary), 'GLOSSARY_NOT_LAST', null, '<details id="glossary"> needs class="x-glossary"');
  }
  const glossaryOffset = glossary ? offset(glossary) : Infinity;

  // rows
  const rows = new Map(); // slug -> el
  for (const el of elements(doc, (n) => (attr(n, 'id') || '').startsWith('g-'))) {
    const slug = slugOf(attr(el, 'id'), 'g-');
    if (!glossary || !closest(el, (n) => n === glossary)) {
      problems.error(file, line(el), 'GLOSSARY_NOT_LAST', null, `row #g-${slug} is outside <details id="glossary">`);
      continue;
    }
    rows.set(slug, el);
    const back = elements(el, (n) => n.tagName === 'a' && hasClass(n, 'x-back'));
    if (back.length !== 1 || attr(back[0], 'href') !== `#t-${slug}`) {
      problems.error(file, line(el), 'GLOSSARY_BACK_MISSING', null, `row #g-${slug} needs exactly one <a class="x-back" href="#t-${slug}">`);
    }
    const dd = byTag(el, 'dd');
    if (dd.length !== 1 || textOf(dd[0]).trim() === '') problems.error(file, line(el), 'GLOSSARY_EMPTY_DD', null, `row #g-${slug} needs one non-empty <dd>`);
  }

  // first uses
  const firstUse = new Map(); // slug -> el
  for (const dfn of elements(doc, (n) => n.tagName === 'dfn')) {
    const slug = slugOf(attr(dfn, 'id'), 't-');
    if (!slug) { problems.error(file, line(dfn), 'GLOSSARY_DFN_NO_LINK', null, '<dfn> needs id="t-<slug>"'); continue; }
    if (firstUse.has(slug)) { problems.error(file, line(dfn), 'GLOSSARY_DUP_FIRST_USE', null, `second <dfn id="t-${slug}">; first at line ${line(firstUse.get(slug))}`); continue; }
    firstUse.set(slug, dfn);
    const links = elementChildren(dfn).filter((n) => n.tagName === 'a');
    if (links.length !== 1 || !(attr(links[0], 'href') || '').startsWith('#g-')) {
      problems.error(file, line(dfn), 'GLOSSARY_DFN_NO_LINK', null, `<dfn id="t-${slug}"> must wrap exactly one <a href="#g-${slug}">`);
      continue;
    }
    const target = slugOf(attr(links[0], 'href').slice(1), 'g-');
    if (target !== slug) problems.error(file, line(dfn), 'GLOSSARY_SLUG_MISMATCH', null, `<dfn id="t-${slug}"> links to #g-${target}`);
    else if (!rows.has(slug)) problems.error(file, line(dfn), 'GLOSSARY_ROW_MISSING', null, `no glossary row #g-${slug} for the first use`);
    if (offset(dfn) > glossaryOffset) problems.error(file, line(dfn), 'GLOSSARY_ORDER', null, `first use of "${slug}" is inside or after the glossary`);
  }

  // later uses
  for (const a of elements(doc, (n) => n.tagName === 'a' && hasClass(n, 'term'))) {
    const href = attr(a, 'href') || '';
    const slug = href.startsWith('#g-') ? href.slice(3) : null;
    if (!slug || !rows.has(slug)) { problems.error(file, line(a), 'GLOSSARY_ROW_MISSING', null, `<a class="term" href="${href}"> does not resolve to a glossary row`); continue; }
    const dfn = firstUse.get(slug);
    if (dfn && offset(dfn) > offset(a)) problems.error(file, line(a), 'GLOSSARY_ORDER', null, `"${slug}" used before its first use at line ${line(dfn)}`);
  }

  // orphans
  for (const [slug, row] of rows) {
    if (!firstUse.has(slug)) problems.error(file, line(row), 'GLOSSARY_ORPHAN_ROW', null, `row #g-${slug} has no <dfn id="t-${slug}"> first use`);
  }
}
