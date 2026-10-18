import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function crossing() {
  const window = {}, context = vm.createContext({window, Math});
  for (const name of ['za-catspace.js', 'za-catlife.js']) {
    vm.runInContext(fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8'), context);
  }
  const life = window.__zaCatLifeCore, space = window.__zaCatSpaceCore;
  const layout = {width: 390, height: 844, allowTextTransit: true, footprint: {w: 53, h: 53},
    protect: [{x: 0, y: 320, w: 390, h: 32}], forbid: []};
  const state = life.create(layout, () => .8), actor = state.actors[0], other = state.actors[1];
  other.hidden = true;
  state.socialWait = Infinity;
  const route = space.planRoute(layout, {x: 20, y: 100}, {x: 300, y: 650}, {directOnly: true});
  assert.ok(route.ok);
  for (let i = 1; i < 100; i++) {
    const routeTime = route.duration * i / 100, point = space.sampleRoute(route, routeTime);
    if (space.isLegalPosition(layout, point)) continue;
    Object.assign(actor, point, {mode: 'hop', route, routeTime, facing: -point.facing,
      departure: null, turn: null, speed: 1, blocked: 0});
    break;
  }
  assert.equal(space.isLegalPosition(layout, actor), false);
  assert.equal(space.isLegalTransitPosition(layout, actor), true);
  return {life, space, state, actor, other, route, layout};
}

test('waking a cat crossing soft content queues its response until a legal landing', () => {
  const {life, space, state, actor, route} = crossing();
  const before = [actor.x, actor.y];
  life.wake(state, 0);
  life.wake(state, 0);
  assert.equal(actor.route, route, 'wake must not strand the cat over text by clearing its route');
  assert.deepEqual([actor.x, actor.y], before, 'requesting a wake must not teleport the cat');
  for (let i = 0; actor.route && i < 200; i++) life.step(state, .05);
  assert.equal(actor.route, null);
  assert.equal(actor.mode, 'wake');
  assert.equal(actor.hidden, false);
  assert.deepEqual([actor.x, actor.y], [route.to.x, route.to.y]);
  assert.ok(space.isLegalPosition(life.actorLayout(state, actor), actor));
});

function blockNextStep(h) {
  const {actor, other} = h;
  Object.assign(other, {hidden: false, x: actor.x + 58.5, y: actor.y,
    mode: 'observe', route: null, wait: 999, hold: 999});
  actor.blocked = 1.19;
}

test('collision cancellation over soft content recovers the nearest legal route endpoint', () => {
  const h = crossing(), {life, space, state, actor, route} = h;
  blockNextStep(h);
  life.step(state, .05);
  assert.equal(actor.route, null, 'exercise collision timeout cancellation');
  assert.equal(actor.hidden, false);
  assert.deepEqual([actor.x, actor.y], [route.from.x, route.from.y]);
  assert.ok(space.isLegalPosition(life.actorLayout(state, actor), actor));
});

test('collision recovery skips an unsafe near endpoint and uses the legal far endpoint', () => {
  const h = crossing(), {life, space, state, actor, route} = h;
  blockNextStep(h);
  state.layout.forbid.push({x: route.from.x, y: route.from.y, w: 53, h: 53});
  life.step(state, .05);
  assert.equal(actor.route, null);
  assert.equal(actor.hidden, false);
  assert.deepEqual([actor.x, actor.y], [route.to.x, route.to.y]);
  assert.ok(space.isLegalPosition(life.actorLayout(state, actor), actor));
});

test('collision recovery hides safely when neither route endpoint remains legal', () => {
  const h = crossing(), {life, state, actor, route} = h;
  blockNextStep(h);
  for (const p of [route.from, route.to]) state.layout.forbid.push({...p, w: 53, h: 53});
  life.step(state, .05);
  assert.equal(actor.route, null);
  assert.equal(actor.hidden, true, 'an interrupted cat must not rest visibly on protected content');
});

test('a queued wake is honored after collision recovery reaches a legal endpoint', () => {
  const h = crossing(), {life, space, state, actor} = h;
  life.wake(state, 0);
  blockNextStep(h);
  life.step(state, .05);
  assert.equal(actor.route, null);
  assert.equal(actor.mode, 'wake');
  assert.equal(actor.hidden, false);
  assert.ok(space.isLegalPosition(life.actorLayout(state, actor), actor));
});

test('a layout change that ends transit honors and clears the queued wake at its safe placement', () => {
  const {life, space, state, actor, route, layout} = crossing();
  life.wake(state, 0);
  life.relayout(state, {...layout, forbid: [{...route.to, w: 53, h: 53}]});
  assert.equal(actor.route, null);
  assert.equal(actor.hidden, false);
  assert.ok(space.isLegalPosition(life.actorLayout(state, actor), actor));
  assert.equal(actor.mode, 'wake');
  assert.equal(actor.pendingWake, false, 'do not replay this request after a later unrelated route');
});
