const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadPage, where } = require('../src');

const PAGE = `<!doctype html><html><head><style>
  :root { --ink: #111111; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ink: #eeeeee; } }
</style></head><body>
<canvas id="c"></canvas>
<div id="why"></div>
<input id="s" type="range" min="0" max="10" value="3">
<p id="out">ready</p>
<script>
  const ctx = document.getElementById('c').getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let x = 0, clicks = 0;
  ['a', 'b'].forEach(k => { const b = document.createElement('button'); b.dataset.why = k; b.textContent = k; document.getElementById('why').appendChild(b); });
  document.getElementById('why').addEventListener('click', e => {
    clicks++;
    document.querySelectorAll('#why button').forEach(b => b.setAttribute('aria-pressed', String(b === e.target)));
  });
  document.getElementById('s').addEventListener('input', e => { document.getElementById('out').textContent = 'v=' + e.target.value; });
  function draw(t) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink');
    ctx.fillRect(x, 0, 10, 10);
  }
  function loop(t) { x += 1; draw(t); requestAnimationFrame(loop); }
  if (!reduce) requestAnimationFrame(loop);
</script></body></html>`;

test('builds the tree, runs the script, events bubble to a delegated listener', () => {
  const p = loadPage(PAGE);
  const buttons = p.$$('#why button');
  assert.deepEqual(buttons.map(b => b.dataset.why), ['a', 'b']);
  p.click(buttons[1]);
  assert.deepEqual(buttons.map(b => b.getAttribute('aria-pressed')), ['false', 'true']);
  assert.equal(p.document.getElementById('nope'), null);
  assert.throws(() => p.el('nope'), /no element/);
});

test('inputs: value from markup, input events', () => {
  const p = loadPage(PAGE);
  assert.equal(p.el('s').value, '3');
  p.input('s', 7);
  assert.equal(p.text('out'), 'v=7');
});

test('frames advance the fake clock; CSS variables come from the page, per scheme', () => {
  const p = loadPage(PAGE);
  const a = p.frame(), b = p.frame();
  assert.equal(a[0].box.x, 1);
  assert.equal(b[0].box.x, 2);
  assert.equal(a[0].style, '#111111');
  const dark = loadPage(PAGE, { colorScheme: 'dark' });
  assert.equal(dark.frame()[0].style, '#eeeeee');
});

test('reduced motion is what matchMedia says', () => {
  const p = loadPage(PAGE, { reducedMotion: true });
  assert.equal(p.frame().length, 0);
});

test('expose reaches inside the page script; a missing anchor is an error, not a no-op', () => {
  const p = loadPage(PAGE, { expose: { 'let x = 0, clicks = 0;': '{ get x() { return x; }, get clicks() { return clicks; } }' } });
  p.run(100);
  assert.equal(p.exposed.x, 6);
  p.click(p.$$('#why button')[0]);
  assert.equal(p.exposed.clicks, 1);
  assert.throws(() => loadPage(PAGE, { expose: { 'no such text': '{}' } }), /found 0 times/);
});

test('mutations: applied one at a time, anchors must be unique, out-of-range is an error', () => {
  const muts = [['x += 1;', 'x += 2;'], ['not in the page', 'x'], ['ctx', 'ctx']];
  assert.equal(loadPage(PAGE, { mutations: muts, mutant: 1 }).frame()[0].box.x, 2);
  assert.throws(() => loadPage(PAGE, { mutations: muts, mutant: 2 }), /found 0 times/);
  assert.throws(() => loadPage(PAGE, { mutations: muts, mutant: 3 }), /found \d+ times/);
  assert.throws(() => loadPage(PAGE, { mutations: muts, mutant: 4 }), /no mutant 4/);
});

test('<script src> is read relative to the page file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-spy-'));
  fs.writeFileSync(path.join(dir, 'lib.js'), 'window.LIB = { answer: 42 };');
  fs.writeFileSync(path.join(dir, 'p.html'), '<p id="o"></p><script src="lib.js"></script><script>document.getElementById("o").textContent = LIB.answer;</script>');
  assert.equal(loadPage(path.join(dir, 'p.html')).text('o'), '42');
  fs.writeFileSync(path.join(dir, 'q.html'), '<script src="https://cdn.example/x.js"></script>');
  assert.throws(() => loadPage(path.join(dir, 'q.html')), /options\.scripts/);
});

// --- the mutation runner must be able to say no ---
const BIN = path.join(__dirname, '..', 'bin', 'canvas-spy-mutate.js');
function runner(testBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-spy-run-'));
  fs.writeFileSync(path.join(dir, 'p.html'), PAGE);
  const file = path.join(dir, 't.js');
  fs.writeFileSync(file, `const { loadPage } = require(${JSON.stringify(path.join(__dirname, '..', 'src'))});\n${testBody}`);
  return spawnSync(process.execPath, [BIN, '--', process.execPath, file], { encoding: 'utf8', cwd: dir });
}

test('runner: a mutation the test cannot see is reported as SURVIVED, exit 1', () => {
  const r = runner(`const p = loadPage('p.html', { mutations: [['x += 1;', 'x += 2;'], ["'v=' +", "'w=' +"]] });
    const a = p.frame(); process.exit(a[0].box.x === 1 ? 0 : 1);`);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /mutant 1: caught/);
  assert.match(r.stdout, /mutant 2: SURVIVED/);
});

test('runner: a mutation whose anchor is gone never counts as caught, exit 1', () => {
  const r = runner(`const p = loadPage('p.html', { mutations: [['x += 1;', 'x += 2;'], ['renamed away', 'x']] });
    try { const a = p.frame(); process.exit(a[0].box.x === 1 ? 0 : 1); } catch (e) { process.exit(1); }`);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /mutant 2: anchor missing/);
  assert.match(r.stdout, /1 caught, 0 survived, 1 never ran/);
});

test('runner: refuses to start when the unmutated test already fails', () => {
  const r = runner(`loadPage('p.html', { mutations: [['x += 1;', 'x += 2;']] }); process.exit(1);`);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /unmutated run fails/);
});
