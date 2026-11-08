import { expect, test } from 'claude-code/testing'

import {
  INERT,
  cloneGame,
  fire,
  newGame,
  setForge,
  settleNow,
  statusLine,
  tick,
  trigger,
  type Body,
  type Game,
  type Pellet,
  type Power,
  type Round,
  type ShotSpec,
} from '../hooks/engine'
import { fly } from '../hooks/replay'
import { animation, vector } from '../hooks/vector'

/** A round as the Forge might set one out: a thing thrown, unless told otherwise. */
function round(r: Partial<Round> = {}): Round {
  return {
    art: '',
    look: '',
    width: 0.15,
    height: 0.15,
    color: '#ffd166',
    count: 5,
    every: 0.1,
    spread: 4,
    speed: 18,
    gravity: 0.6,
    punch: 1,
    blast: 0,
    pierce: 'none',
    bounce: 0,
    matter: INERT,
    life: 2,
    fade: false,
    turn: 'spin',
    trail: '',
    ...r,
  }
}

function spec(name: string, power: Power, size = { width: 0.6, height: 0.4 }): ShotSpec {
  return {
    id: name,
    prompt: name,
    name,
    ...size,
    density: 1.5,
    friction: 0.5,
    bounce: 0.2,
    color: '#8899aa',
    shape: 'box',
    points: [],
    ability: 'shoot',
    power,
    matter: INERT,
    traits: [],
    art: '',
    quip: '',
  }
}

const BULLET = round({ width: 0.04, height: 0.015, count: 7, every: 0.053, spread: 2, speed: 38, gravity: 0.05, punch: 2.2, life: 0.8, turn: 'point', trail: '#fff3c4' })
const GUN = spec('Gun', { name: 'Open Fire', from: [0.3, 0.1], facing: 'right', aim: 'target', round: BULLET })
const DROP = round({ look: 'water', width: 0.26, height: 0.26, color: '#7fd4ff', count: 28, every: 0.013, spread: 7, speed: 15, gravity: 1, punch: 0.6, life: 1.6, turn: 'upright' })
const WHALE = spec('Whale', { name: 'Blowhole Spout', from: [0.4, 0.5], facing: 'up', aim: 'up', round: DROP }, { width: 2, height: 1 })
const NEEDLE = round({ width: 0.25, height: 0.05, count: 12, speed: 26, gravity: 0.35, punch: 1.3, pierce: 'glass', life: 1.1, turn: 'point' })
const CACTUS = spec('Cactus', { name: 'Needle Storm', from: [0, 0], facing: 'around', aim: 'target', round: NEEDLE })
const ROCKET = round({ width: 0.6, height: 0.15, count: 1, speed: 24, gravity: 0.1, punch: 1.5, blast: 2, life: 3, turn: 'point', trail: '#cccccc' })

/** Level 1, the spec flung along `aim` and flying for `ticks` ticks. */
function flung(item: ShotSpec, aim: { x: number; y: number }, ticks = 10): Game {
  const g = newGame(1, 0)
  settleNow(g)
  setForge(g, { status: 'ready', item, note: null })
  g.aim = aim
  expect(fire(g)).toBe(true)
  for (let i = 0; i < ticks; i++) tick(g)

  return g
}

function shotOf(g: Game): Body {
  const b = g.bodies.find(b => b.kind === 'shot')
  if (!b) throw new Error('no shot in flight')

  return b
}

const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2))

/** Ticks on, collecting every round fired, until the shot has none left and they are all spent. */
function rounds(g: Game, limit = 200): Pellet[] {
  const seen = new Set<Pellet>()
  for (let i = 0; i < limit; i++) {
    tick(g)
    for (const p of g.pellets) seen.add(p)
    if (g.pellets.length === 0 && !g.bodies.some(b => b.ammoLeft > 0)) break
  }

  return [...seen]
}

/** A round put in the air by hand, as a shot would have fired it. */
function loose(g: Game, r: Round, x: number, y: number, vx: number, vy: number): Pellet {
  const p: Pellet = { round: r, x, y, vx, vy, age: 0, color: 0xffd166, done: false, bounces: 0 }
  g.pellets.push(p)

  return p
}

test('a gun turns to the nearest bug and fires its rounds at it', () => {
  const g = flung(GUN, { x: 1.8, y: 1.4 })
  expect(statusLine(g, false).text).toBe('Click or press space: OPEN FIRE!')
  expect(trigger(g)).toBe(true)
  expect(g.banner?.text).toBe('Open Fire!')
  // A sixth of a second turning, seen, before the first round.
  for (let i = 0; i < 3; i++) tick(g)
  expect(g.pellets.length).toBe(0)
  tick(g)
  expect(g.pellets.length).toBe(1)
  const gun = shotOf(g)
  const bugs = g.bodies.filter(b => b.kind === 'bug')
  const bug = bugs.reduce((a, b) => (Math.hypot(a.x - gun.x, a.y - gun.y) < Math.hypot(b.x - gun.x, b.y - gun.y) ? a : b))
  const toBug = Math.atan2(bug.y - gun.y, bug.x - gun.x)
  // Turned to it, allowing for its own drift across the line.
  expect(Math.abs(wrap(gun.a - toBug))).toBeLessThan(0.35)
  const first = g.pellets[0]!
  expect(first.round).toBe(BULLET)
  // The round itself flies at the bug, the gun's speed and all: within its 2 degrees of
  // spread and the 8% its speed varies by, which tilts it against the gun's own motion
  // (at worst 0.127 over 3,000 runs).
  expect(Math.abs(wrap(Math.atan2(first.vy, first.vx) - toBug))).toBeLessThan(0.15)
  expect(rounds(g).length).toBe(BULLET.count)
  expect(g.pellets.length).toBe(0)
})

test('a round fired all at once leaves together', () => {
  const shotgun = spec('Shotgun', { name: 'Blam', from: [0.3, 0], facing: 'right', aim: 'target', round: round({ ...BULLET, count: 8, every: 0, spread: 12 }) })
  const g = flung(shotgun, { x: 1.8, y: 1.4 })
  trigger(g)
  for (let i = 0; i < 4; i++) tick(g)
  expect(g.pellets.length).toBe(8)
})

test('a whale turns upright and spouts water up, the spout shoving it down', () => {
  const g = flung(WHALE, { x: 1.6, y: 1.6 })
  shotOf(g).a = 1.2
  const plain = cloneGame(g)
  trigger(g)
  for (let i = 0; i < 8; i++) {
    tick(g)
    tick(plain)
  }
  const whale = shotOf(g)
  expect(Math.abs(wrap(whale.a))).toBeLessThan(0.1)
  expect(g.pellets.length).toBeGreaterThan(3)
  expect(g.pellets.every(p => p.round === DROP && p.vy > 0)).toBe(true)
  // Out of the blowhole: over the whale's back.
  expect(g.pellets.every(p => p.y > whale.y + 0.3)).toBe(true)
  expect(whale.vy).toBeLessThan(shotOf(plain).vy - 0.3)
})

test('a cactus fires its needles all around at once', () => {
  const g = flung(CACTUS, { x: 1.6, y: 1.6 })
  trigger(g)
  tick(g)
  const shot = shotOf(g)
  expect(g.pellets.length).toBe(NEEDLE.count)
  const quadrants = new Set(g.pellets.map(p => `${Math.sign(p.x - shot.x)},${Math.sign(p.y - shot.y)}`))
  expect(quadrants.size).toBe(4)
})

test('a round with a blast goes off where it hits, shoving and breaking what is near', () => {
  const g = flung(spec('Rock', GUN.power), { x: 0, y: 1 }, 2)
  const bug = g.bodies.find(b => b.kind === 'bug')!
  const near = g.bodies.filter(b => b.kind === 'block' && Math.hypot(b.x - bug.x, b.y - bug.y) < 1.5)
  const p = loose(g, ROCKET, bug.x - 3, bug.y, 24, 0)
  for (let i = 0; i < 6; i++) tick(g)
  expect(p.done).toBe(true)
  expect(g.effects.some(fx => fx.kind === 'ring' && fx.r === ROCKET.blast)).toBe(true)
  expect(bug.dead).toBe(true)
  expect(near.some(b => b.dead || Math.hypot(b.vx, b.vy) > 1)).toBe(true)
})

test('a round with a blast goes off when its life runs out, even in the air', () => {
  const g = flung(spec('Rock', GUN.power), { x: 0, y: 1 }, 2)
  const p = loose(g, round({ ...ROCKET, life: 0.2, gravity: 0 }), 12, 9, 0, 0)
  // A fifth of a second is five ticks.
  for (let i = 0; i < 4; i++) tick(g)
  expect(p.done).toBe(false)
  for (let i = 0; i < 2; i++) tick(g)
  expect(p.done).toBe(true)
  expect(g.effects.some(fx => fx.kind === 'ring' && fx.r === ROCKET.blast)).toBe(true)
})

test('a bouncy round bounces off the ground; a plain one stops there', () => {
  const g = flung(spec('Rock', GUN.power), { x: 0, y: 1 }, 2)
  const ball = loose(g, round({ bounce: 0.7, gravity: 1 }), 8, 2, 0, -10)
  const rock = loose(g, round({ gravity: 1 }), 9, 2, 0, -10)
  for (let i = 0; i < 6; i++) tick(g)
  expect(ball.done).toBe(false)
  expect(ball.bounces).toBe(1)
  expect(rock.done).toBe(true)
})

test('a hot round sets wood alight and leaves stone be', () => {
  const g = newGame(3, 0)
  settleNow(g)
  const wood = g.bodies.find(b => b.mat === 'wood')!
  const stone = g.bodies.find(b => b.mat === 'stone')!
  setForge(g, { status: 'ready', item: spec('Rock', GUN.power), note: null })
  g.aim = { x: 0, y: 1 }
  fire(g)
  const flame = round({ punch: 0.3, matter: { ...INERT, heat: 1 }, gravity: 0 })
  for (let k = 0; k < 2; k++) {
    loose(g, flame, wood.x - 1, wood.y, 15, 0)
    loose(g, flame, stone.x - 1, stone.y, 15, 0)
  }
  for (let i = 0; i < 4; i++) tick(g)
  expect(wood.fire).toBeGreaterThan(0)
  expect(stone.fire).toBe(0)
  for (let i = 0; i < 25; i++) tick(g)
  expect(wood.decay).toBeGreaterThan(0.1)
  expect(stone.decay).toBe(0)
})

test('what passes through everything chokes the bugs it covers and leaves blocks standing', () => {
  // Flung straight up, it lands by the sling and leaves the towers be.
  const g = flung(spec('Rock', GUN.power), { x: 0, y: 1 }, 2)
  const bug = g.bodies.find(b => b.kind === 'bug')!
  const block = g.bodies.find(b => b.kind === 'block' && Math.abs(b.x - bug.x) < 3)!
  const gas = round({ width: 1.1, height: 1.1, speed: 0, gravity: 0, punch: 0.5, pierce: 'all', life: 2.8, fade: true })
  for (const at of [bug, block]) for (let i = 0; i < 3; i++) loose(g, gas, at.x, at.y, 0, 0)
  for (let i = 0; i < 20; i++) tick(g)
  expect(bug.dead).toBe(true)
  expect(block.dead).toBe(false)
})

test('the turn waits for the rounds to land', () => {
  const g = flung(WHALE, { x: 1.6, y: 1.6 })
  trigger(g)
  for (let i = 0; i < 8; i++) tick(g)
  expect(g.pellets.length).toBeGreaterThan(0)
  expect(g.phase).toBe('flying')
})

test('a flight that shoots is animated round by round, each reaching where it struck', () => {
  const art = '<rect x="0" y="0" width="60" height="15" fill="#556b2f"/><path d="M60 0L60 15" stroke="#1b1b2b"/>'
  const launcher = spec('Launcher', { ...GUN.power, round: { ...ROCKET, count: 3, every: 0.2, art } })
  const g = flung(launcher, { x: 1.8, y: 1.4 })
  trigger(g)
  for (let i = 0; i < 6; i++) tick(g)
  // The still frame draws its own drawing of the round, defined once.
  const still = vector(g).svg
  expect(still).toContain('<g id="pd-round-0"')
  expect(still).toContain('<use href="#pd-round-0"/>')

  const { rec } = fly(g)
  expect(rec.pellets.length).toBeGreaterThan(0)
  // A round is hidden the tick after its last pose, where it ended.
  for (const pt of rec.pellets) if (pt.died >= 0) expect(pt.poses.length / 2).toBe(pt.died - pt.born)
  const svg = animation(rec)
  expect(svg.length).toBeLessThan(100_000)
  expect(svg).toContain('keyTimes=')
  expect(svg.split('<g id="pd-round-0"').length - 1).toBe(1)
  expect(svg.split('<use href="#pd-round-0"/>').length - 1).toBe(rec.pellets.length)
  // Their trail, and the blasts where they went off.
  expect(svg).toContain('stroke="#cccccc"')
})

test('a spout of water is animated within what a post carries', () => {
  const g = flung(WHALE, { x: 1.6, y: 1.6 })
  trigger(g)
  const { rec } = fly(g)
  expect(rec.pellets.length).toBe(DROP.count)
  const svg = animation(rec)
  expect(svg.length).toBeLessThan(100_000)
  expect((svg.match(/<circle r="5.5"/g) ?? []).length).toBe(DROP.count)
})

test('a flight picked up at a moment of another starts with the shot where that one has it', () => {
  const g = flung(GUN, { x: 1.8, y: 1.4 }, 0)
  const first = fly(g)
  const k = 14
  const later = first.snaps[k]!
  expect(trigger(later)).toBe(true)
  const second = fly(later)
  const before = first.rec.tracks.find(t => t.body.kind === 'shot')!
  const after = second.rec.tracks.find(t => t.body.kind === 'shot')!
  const i = k - before.born
  expect(after.born).toBe(0)
  expect(after.poses.slice(0, 3)).toEqual(before.poses.slice(3 * i, 3 * i + 3))
  // Its power flashes from that first moment on, and nothing is fired before it shows.
  expect(after.flash).toBe(0)
  expect(second.rec.pellets.every(p => p.born > 0)).toBe(true)
})
