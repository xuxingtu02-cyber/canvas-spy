const test = require('node:test');
const assert = require('node:assert/strict');
const { createClock } = require('../src');

test('animation frames run once per tick; frames they request wait for the next tick', () => {
  const k = createClock({ start: 0 });
  let n = 0;
  const loop = () => { n++; k.requestAnimationFrame(loop); };
  k.requestAnimationFrame(loop);
  assert.equal(n, 0);
  k.tick(16); assert.equal(n, 1);
  k.tick(16); assert.equal(n, 2);
  assert.equal(k.now, 32);
});

test('timers fire in due order, intervals repeat, cleared ones do not', () => {
  const k = createClock({ start: 0 });
  const log = [];
  k.setTimeout(() => log.push('b'), 20);
  k.setTimeout(() => log.push('a'), 10);
  const gone = k.setTimeout(() => log.push('x'), 5);
  k.clearTimeout(gone);
  const iv = k.setInterval(() => log.push('i'), 15);
  k.tick(31);
  assert.deepEqual(log, ['a', 'i', 'b', 'i']);
  k.clearInterval(iv);
  k.tick(100);
  assert.deepEqual(log, ['a', 'i', 'b', 'i']);
});

test('performance.now and Date.now follow the fake clock; time cannot go back', () => {
  const k = createClock({ start: 500, epoch: 0 });
  assert.equal(k.performance.now(), 500);
  k.advance(1000);
  assert.equal(k.performance.now(), 1500);
  assert.equal(k.dateNow(), 1500);
  assert.throws(() => { k.now = 10; }, /forward/);
});
