const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecorder, Path2D, where, origin, objects, sameColor } = require('../src');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('translate, scale, rotate and save/restore map points like a canvas', () => {
  const r = createRecorder(); const c = r.ctx;
  c.translate(100, 50);
  c.save(); c.scale(2, 3); c.fillRect(1, 1, 10, 10); c.restore();
  c.save(); c.rotate(Math.PI / 2); c.beginPath(); c.moveTo(10, 0); c.lineTo(20, 0); c.stroke(); c.restore();
  c.fillText('hi', 0, 0);
  const [rect, line, text] = r.ops;
  assert.deepEqual(rect.points[0], { x: 102, y: 53 });
  assert.deepEqual(rect.box, { x: 102, y: 53, w: 20, h: 30, cx: 112, cy: 68 });
  assert.ok(near(line.points[0].x, 100) && near(line.points[0].y, 60));
  assert.ok(near(line.points[1].x, 100) && near(line.points[1].y, 70));
  assert.equal(text.text, 'hi');
  assert.deepEqual(text.points[0], { x: 100, y: 50 });
  assert.equal(r.depth, 0);
});

test('a translate after a scale moves in scaled units (order of composition)', () => {
  const r = createRecorder(); const c = r.ctx;
  c.scale(2, 3); c.translate(10, 10); c.fillRect(0, 0, 1, 1);
  c.setTransform(1, 0, 0, 1, 0, 0); c.rotate(Math.PI / 2); c.translate(10, 0); c.fillText('t', 0, 0);
  assert.deepEqual(r.ops[0].points[0], { x: 20, y: 30 });
  const p = r.ops[1].points[0];
  assert.ok(near(p.x, 0) && near(p.y, 10), JSON.stringify(p));
});

test('path points are fixed at the transform in force when they are added', () => {
  const r = createRecorder(); const c = r.ctx;
  c.beginPath(); c.moveTo(0, 0); c.translate(10, 0); c.lineTo(0, 0); c.fill();
  assert.deepEqual(r.ops[0].points, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
});

test('arc is sampled so its box is the circle', () => {
  const r = createRecorder(); const c = r.ctx;
  c.beginPath(); c.arc(50, 50, 10, 0, Math.PI * 2); c.fill();
  const b = r.ops[0].box;
  assert.ok(near(b.x, 40, 1e-6) && near(b.y, 40, 1e-6) && near(b.w, 20, 1e-6) && near(b.h, 20, 1e-6));
});

test('styles, alpha and dash are recorded at paint time and restored', () => {
  const r = createRecorder(); const c = r.ctx;
  c.fillStyle = '#ABC'; c.globalAlpha = 0.5; c.setLineDash([4, 2]);
  c.save(); c.fillStyle = 'rgb(1, 2, 3)'; c.fillRect(0, 0, 1, 1); c.restore();
  c.fillRect(0, 0, 1, 1); c.strokeRect(0, 0, 1, 1);
  assert.equal(r.ops[0].style, 'rgb(1, 2, 3)');
  assert.ok(sameColor(r.ops[1].style, '#aabbcc'));
  assert.equal(r.ops[1].alpha, 0.5);
  assert.deepEqual(r.ops[2].lineDash, [4, 2]);
  assert.equal(r.ops[2].style, '#000000');
  assert.equal(c.fillStyle, '#ABC');
  assert.equal(where(r.ops, { style: '#aabbcc', op: 'fillRect' }).length, 1);
  assert.equal(where(r.ops, { dashed: true }).length, 3);
  // inForce: the stroke colour was set but this op painted with the fill colour
  assert.equal(where(r.ops, { op: 'fillRect', inForce: '#000' }).length, 2);
  assert.equal(where(r.ops, { op: 'fillRect', style: '#000' }).length, 0);
});

test('NaN reaching the canvas throws (a browser would draw nothing, silently)', () => {
  const r = createRecorder();
  assert.throws(() => r.ctx.arc(NaN, 0, 5, 0, 1), /NaN/);
  assert.throws(() => { r.ctx.lineWidth = Infinity; }, /Infinity/);
  const loose = createRecorder({ strictFinite: false });
  loose.ctx.lineTo(NaN, 1);
});

test('Path2D is mapped through the transform at fill time', () => {
  const r = createRecorder(); const c = r.ctx;
  const p = new Path2D(); p.rect(0, 0, 2, 2);
  c.translate(5, 5); c.fill(p);
  assert.deepEqual(r.ops[0].box, { x: 5, y: 5, w: 2, h: 2, cx: 6, cy: 6 });
});

test('origin() and objects() find things drawn after a translate', () => {
  const r = createRecorder(); const c = r.ctx;
  for (const [x, y] of [[10, 20], [30, 40]]) {
    c.save(); c.translate(x, y); c.fillStyle = 'red'; c.fillRect(-1, -1, 2, 2); c.strokeRect(-1, -1, 2, 2); c.restore();
  }
  assert.deepEqual(r.ops.map(origin), [{ x: 10, y: 20 }, { x: 10, y: 20 }, { x: 30, y: 40 }, { x: 30, y: 40 }]);
  const objs = objects(r.ops);
  assert.equal(objs.length, 2);
  assert.equal(objs[1].ops.length, 2);
});

test('capture() returns only what was drawn inside it; calls keep the raw log', () => {
  const r = createRecorder(); const c = r.ctx;
  c.fillRect(0, 0, 1, 1);
  const got = r.capture(() => { c.fillRect(1, 1, 1, 1); });
  assert.equal(got.length, 1);
  assert.equal(r.ops.length, 2);
  assert.deepEqual(r.calls.map(x => x.name), ['fillRect', 'fillRect']);
  r.clear();
  assert.equal(r.ops.length, 0);
});
