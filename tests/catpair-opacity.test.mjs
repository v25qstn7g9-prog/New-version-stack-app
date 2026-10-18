import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// A single-pixel Canvas 2D compositing model. Source alpha comes from a
// transparent synthetic sprite, and save/restore and ellipse clips are real
// state, so the test catches opacity dips without a browser/native dependency.
function pixelContext(x, y) {
  let alpha = 0, clip = null, path = null;
  const stack = [], draws = [];
  const ctx = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', draws,
    get alpha() { return alpha; },
    clearRect() { if (!clip || clip(x, y)) alpha = 0; },
    save() { stack.push([this.globalAlpha, this.globalCompositeOperation, clip]); },
    restore() { [this.globalAlpha, this.globalCompositeOperation, clip] = stack.pop(); },
    translate() {}, scale() {}, beginPath() { path = null; },
    ellipse(cx, cy, rx, ry) { path = (px, py) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1; },
    clip() { const old = clip, next = path; clip = (px, py) => (!old || old(px, py)) && next(px, py); },
    drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
      draws.push({operation: this.globalCompositeOperation, clipped: !!clip});
      if (clip && !clip(x, y)) return;
      const source = image.alphaAt((x - dx) * sw / dw, (y - dy) * sh / dh) * this.globalAlpha;
      if (this.globalCompositeOperation === 'lighter') alpha = Math.min(1, alpha + source);
      else if (this.globalCompositeOperation === 'source-over') alpha = source + alpha * (1 - source);
      else throw new Error('Unexpected composite operation: ' + this.globalCompositeOperation);
    }
  };
  return ctx;
}

function harness(x, y) {
  const contexts = [];
  function element(tag) {
    const node = {tagName: tag.toUpperCase(), style: {}, children: [], classList: {add() {}},
      clientWidth: 390, isConnected: true, setAttribute() {}, addEventListener() {},
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      getContext() { const ctx = pixelContext(x, y); contexts.push(ctx); return ctx; }};
    return node;
  }
  const box = element('button'), face = element('span'), header = element('header');
  box.appendChild(face);
  const window = {__zaPhotoCat: {box, face}, matchMedia: () => ({matches: false, addEventListener() {}}), addEventListener() {}};
  const document = {head: element('head'), createElement: element, querySelector: () => header, addEventListener() {}};
  vm.runInNewContext(fs.readFileSync(new URL('../za-catpair.js', import.meta.url), 'utf8'), {
    window, document, Image: function () {}, Math,
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}
  });
  const {runtime, state} = window.__zaCatPairCore;
  runtime.external = true;
  state.reduced = false;
  const image = {width: 1280, height: 1280,
    alphaAt(px, py) { return py >= 40 && py <= 130 && px >= 60 && px <= 120 ? (px < 70 ? .5 : 1) : 0; }};
  runtime.assets.whiteActions = image;
  runtime.assets.tabbyActions = image;
  Object.assign(state.white, {mode: 'observe', clock: 0, facing: 1});
  state.time = 1;
  runtime.render(); // Establish the original open-eye pose.
  state.white.clock = 2.9; // Switch to the closed-eye pose.
  state.time = 2;
  runtime.render(); // Start its 100 ms transition.
  return {state, runtime, ctx: contexts[0]};
}

test('transparent sprite crossfades keep opaque and translucent pixels equally opaque throughout', () => {
  for (const [x, y, expected] of [[80, 60, 1], [65, 60, .5], [20, 20, 0]]) {
    const {state, runtime, ctx} = harness(x, y);
    for (const mix of [0, .25, .5, .75, 1]) {
      state.time = 2 + mix * .1;
      runtime.render();
      assert.ok(Math.abs(ctx.alpha - expected) < 1e-10,
        `pixel ${x},${y} at blend ${mix}: alpha ${ctx.alpha}, expected ${expected}`);
    }
  }
});

test('crossfade restores source-over before local breathing patches and preserves canvas state', () => {
  const {state, runtime, ctx} = harness(80, 60);
  const before = [ctx.globalAlpha, ctx.globalCompositeOperation];
  ctx.draws.length = 0;
  state.time = 2.05;
  runtime.render();
  assert.equal(ctx.draws[0].operation, 'source-over');
  assert.equal(ctx.draws[1].operation, 'lighter');
  const patches = ctx.draws.filter(draw => draw.clipped);
  assert.ok(patches.length > 0, 'exercise the breathing/tail patch redraws');
  assert.ok(patches.every(draw => draw.operation === 'source-over'));
  assert.deepEqual([ctx.globalAlpha, ctx.globalCompositeOperation], before);
});

test('crossfade restores the caller’s alpha and compositing state', () => {
  const {state, runtime, ctx} = harness(80, 60);
  ctx.globalAlpha = .4;
  ctx.globalCompositeOperation = 'lighter';
  state.time = 2.05;
  runtime.render();
  assert.equal(ctx.globalAlpha, .4);
  assert.equal(ctx.globalCompositeOperation, 'lighter');
});
