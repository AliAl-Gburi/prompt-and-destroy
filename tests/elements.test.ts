import { expect, test } from 'claude-code/testing'

import {
  INERT,
  fire,
  matterOf,
  newGame,
  settleNow,
  tick,
  trigger,
  type Body,
  type Game,
  type Matter,
  type Pellet,
  type Round,
  type ShotSpec,
} from '../hooks/engine'
import { fly } from '../hooks/replay'
import { animation, vector } from '../hooks/vector'

/** A thing the Forge might make: rated on the nine numbers, and nothing else said about it. */
function thing(name: string, matter: Partial<Matter>, size = { width: 0.6, height: 0.6 }, extra: Partial<ShotSpec> = {}): ShotSpec {
  return {
    id: name,
    prompt: name,
    name,
    ...size,
    density: 1,
    friction: 0.6,
    bounce: 0.05,
    color: '#8899aa',
    shape: 'box',
    points: [],
    ability: 'none',
    power: { name: '', from: [0, 0], facing: 'right', aim: 'target', round: drop({}) },
    matter: matterOf(matter),
    traits: [],
    art: '',
    quip: '',
    ...extra,
  }
}

function drop(matter: Partial<Matter>, r: Partial<Round> = {}): Round {
  return {
    art: '',
    look: '',
    width: 0.2,
    height: 0.2,
    color: '#ffffff',
    count: 1,
    every: 0,
    spread: 0,
    speed: 15,
    gravity: 0,
    punch: 0.2,
    blast: 0,
    pierce: 'none',
    bounce: 0,
    matter: matterOf(matter),
    life: 2,
    fade: false,
    turn: 'upright',
    trail: '',
    ...r,
  }
}

/** A level, settled, with shots to spare. */
function level(n: number): Game {
  const g = newGame(n, 0)
  settleNow(g)
  g.shots = 99

  return g
}

/** `item` flung, then set down at x, y, as a shot of a turn gone by, or one landing there. */
function put(g: Game, item: ShotSpec, x: number, y: number, vy = 0): Body {
  g.loaded = item
  g.phase = 'aiming'
  g.aim = { x: 1, y: 1 }
  expect(fire(g)).toBe(true)
  const b = g.bodies[g.bodies.length - 1]!
  Object.assign(b, { x, y, vx: 0, vy, av: 0, a: 0 })
  g.active.delete(b.id)

  return b
}

function loose(g: Game, r: Round, x: number, y: number, vx: number, vy: number): Pellet {
  const p: Pellet = { round: r, x, y, vx, vy, age: 0, color: 0xffffff, done: false, bounces: 0 }
  g.pellets.push(p)

  return p
}

/** Ticks until `until` holds, at most `max` ticks; answers how many it took (-1: never). */
function until(g: Game, done: () => boolean, max = 200): number {
  for (let i = 0; i < max; i++) {
    if (done()) return i
    tick(g)
  }

  return done() ? max : -1
}

function blocks(g: Game, mat: string): Body[] {
  return g.bodies.filter(b => b.kind === 'block' && b.mat === mat && !b.dead)
}

// What these are is only their numbers: nothing in the game knows them by name.
const DRUM = thing('Oil Drum', { burns: 0.9, explodes: 0.6, conducts: 1, dissolves: 0.8 }, { width: 0.6, height: 0.9 })
const TORCH = thing('Torch', { heat: 1 }, { width: 0.3, height: 0.8 })
const ROD = thing('Iron Rod', { conducts: 1, dissolves: 0.8 }, { width: 0.8, height: 0.2 })
const STICK = thing('Stick', { burns: 0.6, dissolves: 0.4 }, { width: 0.8, height: 0.2 })
const CELL = thing('Battery', { electric: 0.6, conducts: 0.5 }, { width: 0.3, height: 0.3 })
const ICE = thing('Ice Block', { heat: -0.6, melts: 1, wet: 0.5 }, { width: 0.5, height: 0.5 })
const STOVE = thing('Hot Plate', { heat: 0.8, conducts: 1 }, { width: 1.4, height: 0.3 })
const FLASK = thing('Acid Flask', { acid: 1, wet: 0.5 }, { width: 0.3, height: 0.4 }, { traits: ['fragile'] })

const HOT = drop({ heat: 1 })
const WATER = drop({ wet: 1 })
const COLD = drop({ heat: -1 })
const ACID = drop({ acid: 1, wet: 0.3 })

test('something hot set against what burns and explodes lights it, and it goes off', () => {
  // Level 1: a wooden room at x 16, its left post's outer face at 14.7.
  const g = level(1)
  const drum = put(g, DRUM, 14.39, 0.45)
  expect(until(g, () => g.phase === 'waiting', 400)).toBeGreaterThanOrEqual(0)
  expect(drum.dead).toBe(false)
  const bugs = g.bodies.filter(b => b.kind === 'bug').length

  // The next turn: something hot lands on it.
  put(g, TORCH, drum.x, drum.y + 0.95, -2)
  expect(until(g, () => drum.fire > 0, 60)).toBeGreaterThan(0)
  expect(drum.fuse).toBeGreaterThanOrEqual(0)
  expect(until(g, () => drum.dead, 60)).toBeGreaterThan(0)
  expect(g.effects.some(fx => fx.kind === 'ring' && fx.r > 2)).toBe(true)
  // Its blast breaks or lights what is near, and the turn runs on while anything burns.
  until(g, () => g.phase !== 'flying', 400)
  expect(g.bodies.filter(b => b.kind === 'bug').length).toBeLessThan(bugs)
})

test('fire spreads through wood that touches, and not through stone', () => {
  // Level 3: a stone room with a wooden slab at x 15; a torch laid on the slab.
  const g = level(3)
  const slab = blocks(g, 'wood').find(b => Math.abs(b.x - 15) < 0.1)!
  const posts = blocks(g, 'stone').filter(b => Math.abs(b.x - 15) < 1.5)
  put(g, TORCH, 14.3, slab.y + slab.hh + 0.45, -1)
  expect(until(g, () => slab.fire > 0, 60)).toBeGreaterThan(0)
  for (let i = 0; i < 60; i++) tick(g)
  expect(posts.length).toBe(2)
  expect(posts.every(p => p.fire === 0 && p.decay === 0)).toBe(true)

  // Level 1, all wood: the slab lit, the posts under it catch.
  const h = level(1)
  const top = blocks(h, 'wood').find(b => b.hw > 1)!
  const legs = blocks(h, 'wood').filter(b => b !== top)
  put(h, TORCH, 15.1, top.y + top.hh + 0.45, -1)
  expect(until(h, () => legs.some(l => l.fire > 0), 150)).toBeGreaterThan(0)
})

test('what burns burns away, and the turn waits for it', () => {
  const g = level(1)
  const post = blocks(g, 'wood').find(b => b.x < 16 && b.hh > 0.5)!
  put(g, TORCH, 13.5, 0.4)
  loose(g, HOT, post.x - 1, post.y, 15, 0)
  loose(g, HOT, post.x - 1, post.y + 0.2, 15, 0)
  expect(until(g, () => post.fire > 0, 10)).toBeGreaterThan(0)
  expect(until(g, () => post.dead || g.phase !== 'flying', 400)).toBeGreaterThan(0)
  expect(post.dead).toBe(true)
})

test('water puts fire out, and what is soaked will not light', () => {
  const g = level(1)
  const post = blocks(g, 'wood').find(b => b.x < 16 && b.hh > 0.5)!
  put(g, TORCH, 13.5, 0.4)
  for (const y of [0, 0.2]) loose(g, HOT, post.x - 1, post.y + y, 15, 0)
  expect(until(g, () => post.fire > 0, 10)).toBeGreaterThan(0)
  loose(g, WATER, post.x - 1, post.y, 15, 0)
  expect(until(g, () => post.fire === 0, 10)).toBeGreaterThan(0)
  expect(post.soak).toBeGreaterThan(0)
  for (const y of [0, 0.2, -0.2]) loose(g, HOT, post.x - 1, post.y + y, 15, 0)
  for (let i = 0; i < 5; i++) tick(g)
  expect(post.fire).toBe(0)
})

test('electricity runs through what conducts to the bug, and not through wood', () => {
  const shock = (bar: ShotSpec) => {
    // Level 1: a bug on the slab at x 16; a bar on the slab against it, a battery dropped on the bar.
    const g = level(1)
    const top = g.bodies.filter(b => b.kind === 'bug').sort((a, b) => b.y - a.y)[0]!
    const slab = blocks(g, 'wood').find(b => b.hw > 1)!
    const y = slab.y + slab.hh + 0.1
    const rod = put(g, bar, top.x - top.hw - 0.4, y)
    put(g, CELL, rod.x - 0.15, y + 0.3, -1)
    for (let i = 0; i < 40; i++) tick(g)

    return top
  }
  expect(shock(ROD).dead).toBe(true)
  expect(shock(STICK).dead).toBe(false)
})

test('acid eats metal and what lives, and hardly touches glass', () => {
  const g = level(2)
  const pane = blocks(g, 'glass')[0]!
  const rod = put(g, ROD, 9, 0.1)
  loose(g, ACID, pane.x - 1, pane.y, 15, 0)
  loose(g, ACID, rod.x - 1, rod.y + 0.05, 15, 0)
  for (let i = 0; i < 20; i++) tick(g)
  expect(rod.decay).toBeGreaterThan(0.2)
  expect(pane.decay).toBeLessThan(0.02)

  const h = level(1)
  const bug = h.bodies.find(b => b.kind === 'bug')!
  put(h, ROD, 9, 0.1)
  loose(h, ACID, bug.x, bug.y + 1.2, 0, -10)
  expect(until(h, () => bug.dead, 60)).toBeGreaterThan(0)
})

test('cold freezes what is wet, and what is frozen breaks at a knock', () => {
  const g = level(1)
  const post = blocks(g, 'wood').find(b => b.x < 16 && b.hh > 0.5)!
  put(g, ROD, 9, 0.1)
  loose(g, WATER, post.x - 1, post.y, 15, 0)
  loose(g, COLD, post.x - 1, post.y + 0.2, 15, 0)
  loose(g, COLD, post.x - 1, post.y - 0.2, 15, 0)
  expect(until(g, () => post.frost > 0, 10)).toBeGreaterThan(0)
  // Half the blow that breaks it unfrozen.
  post.hit = post.strength * 0.5
  tick(g)
  expect(post.dead).toBe(true)
})

test('heat melts what melts', () => {
  const g = level(1)
  const stove = put(g, STOVE, 9, 0.15)
  const ice = put(g, ICE, 9, 0.6, -1)
  expect(until(g, () => ice.dead, 200)).toBeGreaterThan(0)
  expect(stove.dead).toBe(false)
})

test('what breaks open spills what it held', () => {
  const g = level(3)
  const post = blocks(g, 'stone')[0]!
  const flask = put(g, FLASK, post.x - post.hw - 0.4, post.y, 0)
  flask.vx = 12
  expect(until(g, () => flask.dead, 20)).toBeGreaterThan(0)
  expect(post.corrode).toBeGreaterThan(0)
  for (let i = 0; i < 20; i++) tick(g)
  expect(post.decay).toBeGreaterThan(0)
})

test('fire, frost and the rest are drawn on what they are at work on, as they come and go', () => {
  const g = level(1)
  const post = blocks(g, 'wood').find(b => b.x < 16 && b.hh > 0.5)!
  put(g, TORCH, 13.5, 0.4)
  for (const y of [0, 0.2]) loose(g, HOT, post.x - 1, post.y + y, 15, 0)
  until(g, () => post.fire > 0, 10)
  const still = vector(g).svg
  expect(still).toContain('<g id="pd-fire">')
  expect(still).toContain('href="#pd-fire"')

  // A flight in which the drum catches and goes off: flames shown from the tick it caught, the fuse's pulse too.
  const h = level(1)
  const drum = put(h, DRUM, 14.39, 0.45)
  until(h, () => h.phase === 'waiting', 400)
  put(h, TORCH, drum.x, drum.y + 0.95, -2)
  const svg = animation(fly(h).rec)
  expect(svg).toContain('<g id="pd-fire">')
  expect(svg).toContain('<g id="pd-fuse">')
  expect(svg).toMatch(/<g visibility="hidden"><set attributeName="visibility" to="visible" begin="[\d.]+s" fill="freeze"\/>(?:<set[^>]*\/>)?<use href="#pd-fire"/)
  expect(svg.length).toBeLessThan(100_000)
})

test('a power that fires something hot lights what it hits', () => {
  const FLAMER = thing('Flamer', {}, { width: 0.6, height: 0.3 }, {
    ability: 'shoot',
    power: { name: 'Flame', from: [0.3, 0], facing: 'right', aim: 'target', round: drop({ heat: 1 }, { count: 12, every: 0.03, speed: 20, punch: 0.1, life: 1.2 }) },
  })
  const g = level(1)
  g.loaded = FLAMER
  g.phase = 'aiming'
  g.aim = { x: 1.8, y: 1.4 }
  fire(g)
  for (let i = 0; i < 10; i++) tick(g)
  expect(trigger(g)).toBe(true)
  expect(until(g, () => g.bodies.some(b => b.kind !== 'shot' && b.fire > 0), 120)).toBeGreaterThan(0)
})

test('matter that does nothing changes nothing', () => {
  expect(matterOf({})).toEqual(INERT)
})

/** Every tag's attributes named once: a repeated one makes the whole picture fail to draw. */
function attributesOnce(svg: string): string[] {
  const bad: string[] = []
  for (const tag of svg.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    const names = [...tag.matchAll(/\s([a-zA-Z:-]+)=/g)].map(m => m[1])
    if (new Set(names).size !== names.length) bad.push(tag)
  }

  return bad
}

test('whatever is at work on whatever body, the picture stays well formed', () => {
  const g = level(1)
  const rod = put(g, ROD, 9, 0.1)
  const states: Partial<Body>[] = [{ fire: 2 }, { fuse: 0.5 }, { soak: 2 }, { frost: 2 }, { zap: 0.2 }, { corrode: 2 }]
  for (const body of [rod, g.bodies.find(b => b.kind === 'bug')!, blocks(g, 'wood')[0]!]) {
    for (const st of states) {
      Object.assign(body, { fire: 0, fuse: -1, soak: 0, frost: 0, zap: 0, corrode: 0 }, st)
      expect(attributesOnce(vector(g).svg)).toEqual([])
    }
    Object.assign(body, { fire: 1, fuse: 0.5, soak: 1, frost: 1, zap: 0.2, corrode: 1 })
    expect(attributesOnce(vector(g).svg)).toEqual([])
    Object.assign(body, { fire: 0, fuse: -1, soak: 0, frost: 0, zap: 0, corrode: 0 })
  }
})

test('a thing that bursts throws what it held over what is near', () => {
  const g = level(1)
  const post = blocks(g, 'wood').find(b => b.x < 16 && b.hh > 0.5)!
  put(g, TORCH, 13.5, 0.4)
  for (const y of [0, 0.2]) loose(g, HOT, post.x - 1, post.y + y, 15, 0)
  expect(until(g, () => post.fire > 0, 10)).toBeGreaterThan(0)
  // A water balloon flung over it, burst beside it.
  g.loaded = thing('Water Balloon', { wet: 1 }, { width: 0.5, height: 0.5 }, { ability: 'explode' })
  g.phase = 'aiming'
  g.aim = { x: 1, y: 1 }
  fire(g)
  const balloon = g.bodies[g.bodies.length - 1]!
  Object.assign(balloon, { x: post.x - 1.2, y: post.y + 0.6, vx: 0, vy: 0 })
  expect(trigger(g)).toBe(true)
  expect(post.fire).toBe(0)
  expect(post.soak).toBeGreaterThan(0)
})

test('a shot forged before there was matter still flies, fires and lands', () => {
  // As the Forge kept it then: no matter on the object or on what it fires.
  const { matter: _, ...old } = thing('Old Gun', {}, { width: 0.6, height: 0.3 }, {
    ability: 'shoot',
    power: { name: 'Bang', from: [0.3, 0], facing: 'right', aim: 'target', round: drop({}, { count: 6, every: 0.03, speed: 30, punch: 1 }) },
  })
  const { matter: __, ...round } = old.power.round
  const item = { ...old, power: { ...old.power, round } } as unknown as ShotSpec
  const g = level(1)
  g.loaded = item
  g.phase = 'aiming'
  g.aim = { x: 1.8, y: 1.4 }
  fire(g)
  for (let i = 0; i < 10; i++) tick(g)
  expect(trigger(g)).toBe(true)
  expect(until(g, () => g.phase !== 'flying', 400)).toBeGreaterThan(0)
  expect(animation(fly(level(1)).rec).length).toBeGreaterThan(0)
})
