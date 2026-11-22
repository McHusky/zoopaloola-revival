'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { initGame, publicGame, POCKETS } = require('../game');

// Simulate the actual Canvas 2D constraint: negative arc radii throw
// IndexSizeError. Verify each trap effect through the real browser render loop.
function createRenderHarness(effect) {
  const scheduled = [];
  const radii = [];
  const gradient = {addColorStop() {}};
  const rawCtx = {
    arc(x, y, radius) {
      if (!Number.isFinite(radius) || radius < 0) {
        const error = new RangeError(`Invalid circle radius: ${radius}`);
        error.name = 'IndexSizeError';
        throw error;
      }
      radii.push(radius);
    },
    ellipse(x, y, rx, ry) {
      assert.ok(rx >= 0 && ry >= 0, 'ellipse radii must not be negative');
    },
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; }
  };
  const ctx = new Proxy(rawCtx, {
    get(target, key) {
      if (key in target) return target[key];
      return () => {};
    }
  });
  class MockElement {
    constructor(id) {
      this.id = id;
      this.handlers = {};
      this.style = {};
      this.dataset = {};
      this.value = id === 'playerName' ? 'Test' : 'normal';
      this.textContent = '';
      this.classes = new Set();
      this.classList = {
        add: name => this.classes.add(name),
        remove: name => this.classes.delete(name),
        toggle: (name, active) => {
          const on = active === undefined ? !this.classes.has(name) : active;
          if (on) this.classes.add(name); else this.classes.delete(name);
          return on;
        }
      };
    }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    setAttribute() {}
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
  };
  element('gameCanvas').getContext = () => ctx;
  const game = publicGame(initGame());
  game.events = [
    {seq: 1, type: 'pocket', owner: 0, x: 830, y: 607,
      pocketX: 852, pocketY: 624, effect, pieceId: 'p0-0'}
  ];
  const context = {
    document: {getElementById: element, querySelectorAll: () => [], hidden: false},
    window: {}, location: {origin: 'http://localhost', search: ''},
    history: {replaceState() {}},
    localStorage: {setItem() {}, getItem() { return null; }, removeItem() {}},
    fetch: async url => {
      assert.equal(url, '/api/rooms');
      return {ok: true, json: async () => ({
        code: 'ABC234', token: 'token', seat: 0, local: true, bot: false,
        seq: 1, phase: 'playing',
        players: [{name: 'Human', species: 'lion'}, {name: 'CPU', species: 'elephant'}],
        game
      })};
    },
    requestAnimationFrame: fn => { scheduled.push(fn); },
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    URLSearchParams,
    console
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'),
    context, {filename: 'public/app.js'});
  return {
    start: () => element('localRoom').handlers.click(),
    nextFrame: time => {
      assert.ok(scheduled.length, 'animation should schedule another frame');
      scheduled.shift()(time);
    },
    scheduled,
    radii
  };
}

for (const {id, effect} of POCKETS) {
  test(`the ${id} (${effect}) pocket animates without crashing the rendering loop`, async () => {
    const h = createRenderHarness(effect);
    await h.start();
    for (let frame = 1; frame <= 100; frame++) {
      h.nextFrame(frame * 16);
      assert.equal(h.scheduled.length, 1, 'render loop must remain alive');
    }
    assert.ok(h.radii.length > 100, 'Canvas circles should be drawn');
  });
}
