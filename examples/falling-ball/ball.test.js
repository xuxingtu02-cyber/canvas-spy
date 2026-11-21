// node examples/falling-ball/ball.test.js
// REDUCE=1 node examples/falling-ball/ball.test.js        (reduced motion)
// npx canvas-spy-mutate --env REDUCE=1 -- node examples/falling-ball/ball.test.js
//
// Where things are is read from what was drawn, not from the page's variables
// or its counter: a ball is a fill in the ball colour, its position is where
// translate() put the drawing origin.
const path = require('path');
const { loadPage, where, origin } = require('../../src');

const REDUCE = process.env.REDUCE === '1';
const FLOOR = 440, R = 18;
const BALL = '#d0563b';

const page = loadPage(path.join(__dirname, 'ball.html'), {
  reducedMotion: REDUCE,
  viewport: { width: 800, height: 500 },     // canvas CSS size = world size, so canvas px = world units
  mutations: [
    ['if (b.y > FLOOR - R) {', 'if (b.y > FLOOR) {'],                      // ball sinks into the floor
    ['b.vy = -b.vy * 0.5;', 'b.vy = -b.vy * 1.02;'],                        // never settles
    ["balls.length + (balls.length === 1 ? ' ball' : ' balls')", "dropped + ' balls'"], // counter lies after Clear
    ['reduce ? { x, y: FLOOR - R', 'false ? { x, y: FLOOR - R'],            // ignores reduced motion
    ['() => { balls = []; draw(); }', '() => { balls = balls.slice(1); draw(); }'], // Clear clears one
    ['ctx.save(); ctx.translate(b.x, b.y);', 'ctx.save(); ctx.translate(b.x, Math.min(b.y, 60));'], // drawn in the wrong place
  ],
});

let fail = 0;
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) fail++; };
const balls = ops => where(ops, { op: 'fill', style: BALL });
const meter = () => +page.text('meter').match(/^(\d+)/)[1];
// In reduced motion nothing animates; redraws happen on clicks. Use the last ops drawn.
const lastDrawn = () => { const ops = page.canvas().ops; const i = ops.map(o => o.op).lastIndexOf('fillRect'); return ops.slice(i); };
const settle = () => REDUCE ? lastDrawn() : page.run(4000);

// 1. While falling, no ball ever goes below the floor.
let deepest = 0, framesWithBall = 0;
for (let k = 0; k < 3; k++) {
  page.click('drop');
  for (let f = 0; f < (REDUCE ? 1 : 90); f++) {
    const ops = REDUCE ? lastDrawn() : page.frame();
    for (const op of balls(ops)) { deepest = Math.max(deepest, op.box.y + op.box.h); framesWithBall++; }
  }
}
check(framesWithBall > 0, `balls were drawn (${framesWithBall} ball-frames)`);
check(deepest <= FLOOR + 0.5, `no ball below the floor while falling (deepest edge ${deepest.toFixed(1)}, floor ${FLOOR})`);

// 2. After they settle, every ball rests on the floor and the count matches.
let ops = settle();
const resting = balls(ops);
check(resting.length === 3, `3 balls drawn after 3 drops (got ${resting.length})`);
check(resting.every(op => Math.abs(origin(op).y - (FLOOR - R)) < 0.5), 'every ball rests on the floor: ' + resting.map(op => origin(op).y.toFixed(1)).join(' '));
check(meter() === resting.length, `counter says ${meter()}, canvas shows ${resting.length}`);

// 3. Reduced motion: a dropped ball is on the floor the moment it appears.
if (REDUCE) {
  page.click('drop');
  const now = balls(lastDrawn());
  check(now.length === 4 && now.every(op => origin(op).y === FLOOR - R), 'reduced motion: new ball appears already resting');
} else {
  page.click('drop');
  const first = balls(page.frame());
  check(first.length === 4 && origin(first[3]).y < 100, 'normal motion: new ball starts near the top');
}

// 4. Clear removes every ball and the counter follows.
page.click('clear');
ops = REDUCE ? lastDrawn() : page.frame();
check(balls(ops).length === 0 && meter() === 0, `Clear: ${balls(ops).length} balls drawn, counter ${meter()}`);

console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
