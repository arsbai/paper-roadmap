#!/usr/bin/env node
/** Offline SVG preview + conservative geometry checks. No dependency/browser downloads. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const HELP = `Usage: node render_check.mjs input.svg --png preview.png --report qa.json
       [--modules path/to/node_modules] [--browser path/to/chromium]
       [--baseline prior.svg] [--lock-text]

Requires an existing Playwright package and Chromium installation.
data-label-id on <text> identifies labels across revisions. Whitespace is ignored
when comparing label content so tspan wrapping does not count as a text edit.
data-container="element-id" on text or an ancestor enables a containment warning.
data-check-overlap="ignore" on text or an ancestor excludes deliberate overlaps.
Exit: 0 = no hard errors (visual review still required), 1 = QA failure,
      2 = invalid arguments, missing dependency/browser, or execution failure.
`;

const report = {
  schemaVersion: 1, input: null, baseline: null, png: null, rendered: false,
  status: 'incomplete', passed: false, errors: [], warnings: [], textChanges: [],
  limitations: [
    'Bounding boxes are conservative; strokes, rotated text, clipping, masks, filters, and shadows need visual review.',
    'Geometry checks do not judge reading order, arrow meaning, visual balance, or scientific correctness.',
    'Text comparison ignores Unicode whitespace and Unicode canonical composition differences.',
    'System fonts can differ between machines; review the PNG using the intended fonts.'
  ]
};
let browser;
let args;
let exitCode = 0;

function parseArgs(argv) {
  const result = {};
  const values = new Set(['png', 'report', 'modules', 'browser', 'baseline']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--lock-text') { result.lockText = true; continue; }
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!values.has(name) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
        throw new Error(`Unknown option or missing value: ${arg}`);
      }
      result[name] = path.resolve(argv[++i]);
    } else if (!result.input) result.input = path.resolve(arg);
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!result.input || !result.png || !result.report) throw new Error('input.svg, --png, and --report are required.');
  if (result.lockText && !result.baseline) throw new Error('--lock-text requires --baseline prior.svg.');
  const outputs = [result.png, result.report];
  if (new Set(outputs).size !== outputs.length || outputs.some(p => p === result.input || p === result.baseline)) {
    throw new Error('Output paths must be distinct from each other and from input/baseline files.');
  }
  return result;
}

function issue(code, message, details = {}) { return { code, message, ...details }; }

try {
  args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); process.exit(0); }
  report.input = args.input;
  report.baseline = args.baseline ?? null;
  report.png = args.png;
  const source = await fs.readFile(args.input, 'utf8');
  const baseline = args.baseline ? await fs.readFile(args.baseline, 'utf8') : null;
  // Reject XML facilities before giving the source to any parser.
  for (const [name, xml] of [['input', source], ['baseline', baseline]]) {
    if (xml && /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) {
      report.errors.push(issue('unsafe-xml', `${name}: DOCTYPE, ENTITY, and xml-stylesheet are not accepted.`));
    }
  }
  if (report.errors.length) throw Object.assign(new Error('Unsafe XML rejected before rendering.'), { qa: true });

  let chromium;
  try {
    const require = createRequire(args.modules ? path.join(args.modules, '__svg_qa__.cjs') : import.meta.url);
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Playwright is unavailable. Use --modules with an existing node_modules directory containing playwright. No packages were installed.');
  }
  try {
    browser = await chromium.launch({ headless: true, ...(args.browser ? { executablePath: args.browser } : {}) });
  } catch (err) {
    throw new Error(`Chromium could not start. Use --browser with an existing Chromium/Chrome/Edge executable. No browser was downloaded. ${err.message.split('\n')[0]}`);
  }
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const unexpectedRequests = [];
  await context.route('**/*', async route => {
    unexpectedRequests.push(route.request().url());
    await route.abort();
  });
  const page = await context.newPage();

  // DOMParser creates a detached XML tree. The SVG is not inserted/rendered until this passes.
  const preflight = await page.evaluate(({ source, baseline }) => {
    const normalize = s => s.normalize('NFC').replace(/\s+/gu, '');
    function inspect(xml, safety) {
      const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
      const errors = [];
      const warnings = [];
      const root = doc.documentElement;
      if (doc.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
        return { errors: [{ code: 'invalid-svg', message: 'Expected a well-formed SVG document in the SVG namespace.' }], warnings, labels: [] };
      }
      const labels = [...doc.querySelectorAll('text')].map((el, index) => ({
        key: el.getAttribute('data-label-id') || `@index:${index + 1}`,
        stableId: el.getAttribute('data-label-id'), text: el.textContent.trim(), normalized: normalize(el.textContent)
      }));
      const ids = new Set();
      for (const label of labels) {
        if (label.stableId && ids.has(label.key)) errors.push({ code: 'duplicate-label-id', message: `Duplicate data-label-id: ${label.key}` });
        ids.add(label.key);
      }
      if (!safety) return { errors, warnings, labels };
      const elementIds = new Set();
      for (const el of [root, ...root.querySelectorAll('[id]')]) {
        if (!el.id) continue;
        if (elementIds.has(el.id)) errors.push({ code: 'duplicate-svg-id', message: `Duplicate SVG id: ${el.id}` });
        elementIds.add(el.id);
      }
      const blocked = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'link', 'audio', 'video', 'animate', 'animatemotion', 'animatetransform', 'set', 'discard']);
      // Nested SVG data images could conceal active content; only inert raster/font data is accepted.
      const safeRef = value => /^#[^\s]*$/.test(value) || /^data:(?:image\/(?:png|jpeg|gif|webp|bmp|avif)|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|vnd\.ms-fontobject|x-font-ttf|x-font-opentype));base64,[a-z0-9+/=\s]+$/i.test(value);
      const checkUrl = (value, where) => {
        const ref = value.trim();
        if (!safeRef(ref)) errors.push({ code: 'external-or-unsafe-reference', message: `Only fragment references or embedded raster/font base64 data are accepted: ${where}`, value: value.slice(0, 180) });
        else if (ref.startsWith('#') && !doc.getElementById(ref.slice(1))) errors.push({ code: 'missing-svg-reference', message: `Unresolved SVG fragment reference in ${where}: ${ref}` });
      };
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const name = el.localName.toLowerCase();
        if (blocked.has(name) || el.namespaceURI !== root.namespaceURI) errors.push({ code: 'unsafe-element', message: `Element is not accepted: ${el.tagName}` });
        for (const attr of el.attributes) {
          const key = attr.localName.toLowerCase();
          const value = attr.value;
          if (/^on/i.test(key)) errors.push({ code: 'event-handler', message: `Event handler is not accepted: ${attr.name}` });
          if (attr.name.toLowerCase() === 'xml:base') errors.push({ code: 'external-base', message: 'xml:base is not accepted; references must be self-contained.' });
          if (['href', 'src'].includes(key)) checkUrl(value, `${el.tagName}[${attr.name}]`);
          if (/javascript:|vbscript:|file:\/\//i.test(value)) errors.push({ code: 'unsafe-value', message: `Unsafe value in ${el.tagName}[${attr.name}]` });
        }
        const css = [el.getAttribute('style') || '', name === 'style' ? el.textContent : '', ...[...el.attributes].filter(a => /url\s*\(/i.test(a.value)).map(a => a.value)].join('\n');
        if (/@import|@namespace|expression\s*\(|-moz-binding|behavior\s*:/i.test(css)) errors.push({ code: 'unsafe-css', message: `External/active CSS is not accepted in ${el.tagName}.` });
        if (/(?:image-set|cross-fade|paint|element)\s*\(/i.test(css)) errors.push({ code: 'unsupported-css-image', message: 'Use embedded raster data with plain url(); dynamic CSS image functions are not accepted.' });
        if (/@keyframes|(?:^|[;{\s])(?:animation|transition)(?:-[a-z-]+)?\s*:/i.test(css)) errors.push({ code: 'dynamic-css', message: 'CSS animations/transitions are not accepted in an offline static preview.' });
        // Escapes and comments inside CSS URLs are rejected rather than decoded permissively.
        if (/\\/.test(css) || /\/\*/.test(css)) errors.push({ code: 'unsupported-css-encoding', message: 'CSS escapes/comments are not accepted; use plain self-contained CSS.' });
        const urls = [...css.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gis)];
        if ([...css.matchAll(/url\s*\(/gi)].length !== urls.length) errors.push({ code: 'malformed-css-url', message: 'Malformed CSS url() is not accepted.' });
        for (const match of urls) checkUrl(match[2], `${el.tagName} CSS url()`);
      }
      const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      const absolute = v => /^\d*\.?\d+(?:px)?$/i.test(v || '') ? parseFloat(v) : NaN;
      let width = absolute(root.getAttribute('width'));
      let height = absolute(root.getAttribute('height'));
      if ((!Number.isFinite(width) || !Number.isFinite(height)) && viewBox.length === 4 && viewBox.every(Number.isFinite)) {
        width = viewBox[2]; height = viewBox[3];
        warnings.push({ code: 'viewbox-render-size', message: 'Missing/non-pixel canvas dimensions: rendered at the viewBox width and height.' });
      }
      if (!(width > 0 && height > 0 && width <= 20000 && height <= 20000 && width * height <= 40000000)) errors.push({ code: 'invalid-canvas-size', message: 'Use positive pixel dimensions or a viewBox; maximum 20,000 per side and 40 million pixels.' });
      return { errors, warnings, labels, width, height, viewBox: root.getAttribute('viewBox') };
    }
    return { current: inspect(source, true), prior: baseline === null ? null : inspect(baseline, false) };
  }, { source, baseline });

  report.errors.push(...preflight.current.errors);
  report.warnings.push(...preflight.current.warnings);
  report.labels = preflight.current.labels;
  if (preflight.prior) {
    report.errors.push(...preflight.prior.errors.map(e => ({ ...e, message: `baseline: ${e.message}` })));
    const current = new Map(preflight.current.labels.map(x => [x.key, x]));
    const prior = new Map(preflight.prior.labels.map(x => [x.key, x]));
    for (const key of new Set([...prior.keys(), ...current.keys()])) {
      const before = prior.get(key); const after = current.get(key);
      if (before?.normalized !== after?.normalized) report.textChanges.push({
        key, kind: !before ? 'added' : !after ? 'removed' : 'changed',
        before: before?.text ?? null, after: after?.text ?? null
      });
    }
    report.textComparison = { whitespaceIgnored: true, strategy: 'data-label-id; ordinal fallback for unmarked text', locked: !!args.lockText };
    if ([...current.values(), ...prior.values()].some(x => !x.stableId)) report.warnings.push(issue('unstable-label-matching', 'Some labels lack data-label-id; reordering text elements can appear as content changes.'));
    if (report.textChanges.length) {
      (args.lockText ? report.errors : report.warnings).push(issue('text-changed', `${report.textChanges.length} label content change(s) from baseline. See textChanges.`));
    }
  }
  // Content-lock failures still allow a preview; malformed/unsafe SVG does not.
  if (report.errors.some(e => e.code !== 'text-changed')) throw Object.assign(new Error('SVG preflight failed; no SVG was rendered.'), { qa: true });

  const { width, height, viewBox } = preflight.current;
  report.canvas = { width, height, viewBox };
  await page.setViewportSize({ width: Math.ceil(width), height: Math.ceil(height) });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:white}body>svg{display:block}</style></head><body></body></html>');
  await page.evaluate(({ source, width, height }) => {
    const svg = document.importNode(new DOMParser().parseFromString(source, 'image/svg+xml').documentElement, true);
    svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
    document.body.append(svg);
  }, { source, width, height });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('svg image')].map(async el => {
      const image = new Image();
      image.src = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
      await image.decode().catch(() => {});
    }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  const geometry = await page.evaluate(() => {
    const svg = document.querySelector('body > svg');
    const canvas = svg.getBoundingClientRect();
    const errors = []; const warnings = []; const labels = []; const sizes = [];
    const approx = value => Math.round(value * 100) / 100;
    const visible = el => {
      if (el.closest('defs,clipPath,mask,marker,pattern,symbol')) return false;
      for (let current = el; current && current !== document.body; current = current.parentElement) {
        const css = getComputedStyle(current);
        if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
      }
      return true;
    };
    function bounds(el) {
      const box = el.getBBox(); const matrix = el.getScreenCTM();
      if (!matrix || (!box.width && !box.height)) return null;
      const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
      const x1 = Math.min(...points.map(p => p.x)); const x2 = Math.max(...points.map(p => p.x));
      const y1 = Math.min(...points.map(p => p.y)); const y2 = Math.max(...points.map(p => p.y));
      return { x: approx(x1), y: approx(y1), width: approx(x2 - x1), height: approx(y2 - y1) };
    }
    const outside = (a, b) => a.x < b.x - 0.75 || a.y < b.y - 0.75 || a.x + a.width > b.x + b.width + 0.75 || a.y + a.height > b.y + b.height + 0.75;
    for (const [index, el] of [...svg.querySelectorAll('text')].entries()) {
      if (!visible(el) || !el.textContent.trim()) continue;
      const box = bounds(el); if (!box) continue;
      const key = el.getAttribute('data-label-id') || `@index:${index + 1}`;
      const fontSizes = [...new Set([el, ...el.querySelectorAll('tspan')].filter(visible).map(n => {
        const matrix = n.getScreenCTM();
        const scaleY = matrix ? Math.hypot(matrix.c, matrix.d) : 1;
        return approx(parseFloat(getComputedStyle(n).fontSize) * scaleY);
      }))];
      sizes.push(...fontSizes);
      const label = { key, text: el.textContent.trim(), bounds: box, fontSizesPx: fontSizes, fontFamily: getComputedStyle(el).fontFamily, overlapIgnored: !!el.closest('[data-check-overlap="ignore"]') };
      labels.push(label);
      const holder = el.closest('[data-container]');
      if (holder) {
        const id = holder.getAttribute('data-container').replace(/^#/, '');
        const target = document.getElementById(id);
        if (!target || typeof target.getBBox !== 'function') warnings.push({ code: 'missing-container', message: `Label ${key} refers to missing/non-graphic container: ${id}`, label: key });
        else {
          const container = bounds(target);
          if (container && outside(box, container)) warnings.push({ code: 'outside-container', message: `Label ${key} may extend outside container ${id}.`, label: key, container: id, bounds: box, containerBounds: container });
        }
      }
    }
    const fontSizesPx = [...new Set(sizes)].sort((a, b) => a - b);
    if (fontSizesPx.length > 3) errors.push({ code: 'too-many-font-sizes', message: `Found ${fontSizesPx.length} font sizes; maximum is 3.`, fontSizesPx });
    for (const el of svg.querySelectorAll('text,rect,path,line,circle,ellipse,polygon,polyline,image,use')) {
      if (!visible(el)) continue;
      const box = bounds(el);
      if (box && outside(box, canvas)) errors.push({ code: 'outside-canvas', message: `${el.localName}${el.id ? `#${el.id}` : ''} extends outside the SVG canvas.`, label: el.getAttribute('data-label-id'), bounds: box });
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]; const b = labels[j];
      if (a.overlapIgnored || b.overlapIgnored) continue;
      const overlapWidth = Math.min(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width) - Math.max(a.bounds.x, b.bounds.x);
      const overlapHeight = Math.min(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height) - Math.max(a.bounds.y, b.bounds.y);
      if (overlapWidth > 0.75 && overlapHeight > 0.75) warnings.push({ code: 'text-overlap', message: `Labels ${a.key} and ${b.key} have intersecting bounding boxes.`, labels: [a.key, b.key], overlap: { width: approx(overlapWidth), height: approx(overlapHeight) } });
    }
    return { errors, warnings, labels, fontSizesPx };
  });
  report.errors.push(...geometry.errors);
  report.warnings.push(...geometry.warnings);
  report.geometry = { labels: geometry.labels, fontSizesPx: geometry.fontSizesPx };
  if (unexpectedRequests.length) report.errors.push(issue('blocked-network-request', 'An unexpected external request was blocked.', { requests: unexpectedRequests }));
  await fs.mkdir(path.dirname(args.png), { recursive: true });
  await page.screenshot({ path: args.png, type: 'png', animations: 'disabled' });
  report.rendered = true;
  report.warnings.push(issue('visual-review-required', 'Inspect the PNG for clipping, glyphs/fonts, arrow endpoints, spacing, hierarchy, and scientific meaning. Automated checks do not prove visual correctness.'));
} catch (err) {
  if (!err.qa) {
    report.errors.push(issue('execution-error', err.message));
    exitCode = 2;
  }
  console.error(err.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  report.passed = report.errors.length === 0;
  report.status = report.passed ? 'needs-visual-review' : 'fail';
  if (!exitCode && !report.passed) exitCode = 1;
  if (args?.report) {
    try {
      await fs.mkdir(path.dirname(args.report), { recursive: true });
      await fs.writeFile(args.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch (err) { console.error(`Could not write report: ${err.message}`); exitCode = 2; }
  }
  console.log(JSON.stringify({ status: report.status, rendered: report.rendered, errors: report.errors.length, warnings: report.warnings.length, textChanges: report.textChanges.length, report: args?.report ?? null }));
  process.exitCode = exitCode;
}
