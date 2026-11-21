# canvas-spy

Test a `<canvas>` page by asking **what it drew and where**, not by comparing screenshots.

```js
const { loadPage, where, origin } = require('canvas-spy');

const page = loadPage('ball.html', { viewport: { width: 800, height: 500 } });
page.click('drop');
const ops = page.run(4000);                       // 4 s of fake time, 60 frames a second
const balls = where(ops, { op: 'fill', style: '#d0563b' });
assert(balls.every(b => origin(b).y === 422));    // every ball came to rest on the floor
```

- **What it does.** Loads your HTML page in Node with a small fake browser and runs its scripts. The 2D context records every paint (fill, stroke, fillRect, fillText, drawImage) with the colour, alpha, dash and transform in force, and the points it covered in canvas pixels. Time is fake: you move `performance.now()` and animation frames by hand, so "the frame 1.3 s after the click" is a line of test code.
- **What you need.** Node 18+. No dependencies, no browser, no build step. Pages should be self-contained (inline scripts, local `<script src>`); anything from a CDN you pass in as a string.
- **What it costs you.** It is not a browser. No layout (elements report whatever size you give them), no CSS cascade (it reads `--custom-properties` from your `<style>`, nothing else), no pixels. Curves are kept as bounding points, so "is the ball above the floor" works and "is this pixel red" does not. If your page needs real layout or WebGL, use a real browser.

It also ships a **mutation runner**: you list a few ways to break the page, and it checks that your test notices each one.

## Why

I make small animated pages (Slow Cities: one per city in Calvino's *Invisible Cities*). Each has a test. After the first few I noticed the same three pieces copied into every test file: a fake canvas that logs calls, a fake clock, and a loop that reads "a thing is a `translate` followed by a fill in its colour". Twenty-two copies, each slightly different. This is those pieces, written once and tested.

The other thing the copies taught me: **a test that passes proves little until you've seen it fail.** My tests regularly checked less than their descriptions claimed. So the mutation runner is part of the library, not an afterthought.

## The pieces

### `loadPage(pathOrHtml, options)`

| option | default | |
|---|---|---|
| `viewport` | `{width:1600,height:1000}` | CSS px. Canvases are this size unless `rects` says otherwise. Make it equal to your drawing's world size and canvas px = world units. |
| `rects` | `{}` | `{ id: {left, top, width, height} }` for elements that need a specific box |
| `reducedMotion` | `false` | answer to `prefers-reduced-motion: reduce` |
| `colorScheme` | `'light'` | picks which `:root` variables apply |
| `devicePixelRatio` | `1` | |
| `expose` | — | `{ 'text in your script': 'expression' }` → `page.exposed`. Reach a closure variable without changing the page. |
| `mutations` | — | `[[find, replace], ...]`, used by the mutation runner |
| `scripts` | — | `{ 'https://cdn/x.js': 'code' }` for scripts that aren't on disk |
| `strictFinite` | `true` | throw when the page passes `NaN`/`Infinity` to the canvas (a browser silently draws nothing) |

Returns a `page`:

- `page.frame(ms?)` advances time by `ms` (default 1/60 s), runs due timers and the waiting animation frames, and returns the paint ops drawn meanwhile.
- `page.run(ms, step?)` runs frames for `ms`; returns the last frame's ops.
- `page.capture(fn)` returns the ops drawn while `fn` runs. Use it when nothing animates, e.g. in reduced motion.
- `page.click(target, x?, y?)`, `page.pointer(target, type, x, y)`, `page.drag(target, from, to)`, `page.input(target, value)`, `page.key(key)`, `page.fire(target, type, init)`, `page.resize(w, h)`.
- `page.text(id)`, `page.el(idOrSelector)`, `page.$$(selector)`, `page.canvas(id?)` (the recorder: `.ops`, `.calls`).
- `page.clock`, `page.window`, `page.document`, `page.cssVars`, `page.exposed`.

Targets are an id (`'drop'`), a selector (`'#why button'`) or an element.

### Paint ops

```js
{ op: 'fill', style: '#d0563b', fillStyle, strokeStyle, alpha, lineWidth, lineDash,
  points: [{x, y}, ...],  box: {x, y, w, h, cx, cy},  transform: [a, b, c, d, e, f],
  text /* fillText */, index /* into recorder.calls */ }
```

Helpers: `where(ops, { op, style, inForce, dashed, alpha, text, test })`, `origin(op)` (where `translate()` put the drawing origin), `objects(ops)` (consecutive ops sharing a transform, i.e. one drawn thing each), `centers`, `allInside`, `sameColor`.

`style` is the colour actually painted. `inForce` matches a colour that was the fill *or* stroke colour at the time. Use it when a page sets an object's colour up front, then paints parts of it in others.

### The mutation runner

```js
loadPage('ball.html', { mutations: [
  ['if (b.y > FLOOR - R) {', 'if (b.y > FLOOR) {'],     // ball sinks into the floor
  ['b.vy = -b.vy * 0.5;',    'b.vy = -b.vy * 1.02;'],   // never settles
]});
```

```
$ npx canvas-spy-mutate --env REDUCE=1 -- node ball.test.js
✓ unmutated: passes in default / REDUCE=1
✓ mutant 1: caught by default
✓ mutant 2: caught by default
...
✓ mutant 4: caught by REDUCE=1
6 mutants: 6 caught, 0 survived, 0 never ran
```

- It runs your test once per mutation (`CANVAS_SPY_MUTANT=k`). Your test must exit non-zero when it fails.
- `--env` adds another environment to run every mutant in. A mutant counts as caught if any environment fails on it. Some bugs only exist in one mode: an animation that flies upward can't be seen when reduced motion makes it land instantly.
- **A mutation whose text isn't in the page is reported as "never ran", not "caught".** That's the trap this exists for: rename a variable in the page, the mutation silently stops applying, the test still fails for some other reason, and you count a catch that never happened.
- It refuses to start if the test fails without any mutation.

## Example

`examples/falling-ball/`: a page and a test that reads ball positions from the drawing in normal and reduced motion, with six mutations.

```
node examples/falling-ball/ball.test.js
node bin/canvas-spy-mutate.js --env REDUCE=1 -- node examples/falling-ball/ball.test.js
node --test test/*.test.js        # the library's own tests
```

## Limits worth knowing

- One tolerant HTML tokenizer, not a spec parser. Hand-written pages are fine; arbitrary web pages are not the target.
- Selectors: tags, `#id`, `.class`, `[attr]`, `[attr=value]` (and `^= $= *= ~= |=`), descendant and child combinators. No pseudo-classes.
- Microtasks (`Promise.then`) run when your test's synchronous code yields, as in Node. `document.fonts.ready` callbacks run at load.
- Text width from `measureText` is a guess (0.6 × font size per character).

MIT.
