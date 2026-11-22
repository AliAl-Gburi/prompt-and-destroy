import { expect, test } from 'claude-code/testing'

import { INERT, felt, fire, matterOf, newGame, settleNow, tick, type Body, type Game, type Matter, type Pellet, type Round, type ShotSpec } from '../hooks/engine'
import { fly } from '../hooks/replay'
import { animation, vector } from '../hooks/vector'

// What the levels are built of, and how hard, keen or iron-bearing what is
// flung at them is: the same twelve numbers for both, and laws that read
// nothing else.

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
    punch: 0.1,
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

function level(n: number): Game {
  const g = newGame(n, 0)
  settleNow(g)
  g.shots = 99

  return g
}

/** `item` flung from x, y at vx, vy. */
function put(g: Game, item: ShotSpec, x: number, y: number, vx = 0, vy = 0): Body {
  g.loaded = item
  g.phase = 'aiming'
  g.aim = { x: 1, y: 1 }
  expect(fire(g)).toBe(true)
  const b = g.bodies[g.bodies.length - 1]!
  Object.assign(b, { x, y, vx, vy, av: 0, a: 0 })

  return b
}

function loose(g: Game, r: Round, x: number, y: number, vx: number, vy: number): Pellet {
  const p: Pellet = { round: r, x, y, vx, vy, age: 0, color: 0xffffff, done: false, bounces: 0 }
  g.pellets.push(p)

  return p
}

/** A tick of a turn kept running, whatever else would end it. */
function running(g: Game): void {
  g.phase = 'flying'
  g.phaseTime = 0.5
  tick(g)
}

function blocks(g: Game, mat: string): Body[] {
  return g.bodies.filter(b => b.kind === 'block' && b.mat === mat && !b.dead)
}

const FLAME = drop({ heat: 1, hard: 0 })
const WATER = drop({ wet: 1, hard: 0 })
const ACID = drop({ acid: 1, wet: 0.3, hard: 0 })

test('a blow hurts by how much harder the striker is than what it strikes', () => {
  // The same ball, the same throw, at the same concrete wall: soft, it hardly marks it; hard, it breaks it.
  const thrown = (hard: number) => {
    const g = level(7)
    const wall = blocks(g, 'concrete').sort((a, b) => a.x - b.x)[0]!
    put(g, thing('Ball', { hard }, { width: 0.6, height: 0.6 }, { density: 3 }), wall.x - wall.hw - 0.5, wall.y, 18, 0)
    for (let i = 0; i < 30; i++) tick(g)

    return wall
  }
  const soft = thrown(0.05)
  expect(soft.dead).toBe(false)
  expect(soft.wear).toBeLessThan(soft.strength * 0.3)
  expect(thrown(0.9).dead).toBe(true)
  // The one rule, whatever the two are: a soft thing barely scratches concrete, steel smashes wood, like on like as it lands.
  expect(felt(matterOf({ hard: 0.05 }), matterOf({ hard: 0.72 }))).toBeLessThan(0.4)
  expect(felt(matterOf({ hard: 0.9 }), matterOf({ hard: 0.35 }))).toBeGreaterThan(1.5)
  expect(felt(INERT, INERT)).toBe(1)
})

test('a hard, keen edge cuts clean through what is softer, and stops at steel', () => {
  const SWORD = thing('Sword', { hard: 0.9, sharp: 1, iron: 1 }, { width: 1, height: 0.15 }, { density: 2 })
  const g = level(1)
  const post = blocks(g, 'wood').sort((a, b) => a.x - b.x)[0]!
  const sword = put(g, SWORD, post.x - 1.2, post.y, 16, 0)
  for (let i = 0; i < 8; i++) tick(g)
  expect(post.dead).toBe(true)
  expect(sword.x).toBeGreaterThan(post.x + 1)

  const h = level(6)
  const steel = blocks(h, 'metal').sort((a, b) => a.x - b.x)[0]!
  const blade = put(h, SWORD, steel.x - 1.2, steel.y, 16, 0)
  for (let i = 0; i < 8; i++) tick(h)
  expect(steel.dead).toBe(false)
  expect(blade.x).toBeLessThan(steel.x)
  // An edge adds to a blow only on what is softer than it.
  const club = matterOf({ hard: 0.9, iron: 1 })
  const edge = matterOf({ hard: 0.9, sharp: 1, iron: 1 })
  expect(felt(edge, matterOf({ hard: 0.35 }))).toBeGreaterThan(2 * felt(club, matterOf({ hard: 0.35 })))
  expect(felt(edge, matterOf({ hard: 0.9 }))).toBe(felt(club, matterOf({ hard: 0.9 })))
})

test('magnets pull steel, and leave wood where it is', () => {
  const MAGNET = thing('Magnet', { hard: 0.9, iron: 1 }, { width: 0.5, height: 0.5 }, { density: 4, traits: ['magnetic'] })
  const g = level(6)
  const steel = blocks(g, 'metal').sort((a, b) => a.x - b.x)[0]!
  const wood = blocks(g, 'wood').sort((a, b) => b.x - a.x)[0]!
  const s0 = { x: steel.x, y: steel.y }
  const w0 = { x: wood.x, y: wood.y }
  // Held in the air between them.
  const magnet = put(g, MAGNET, (steel.x + wood.x) / 2, 3.5)
  magnet.noGravity = 99
  for (let i = 0; i < 25; i++) {
    magnet.vx = 0
    magnet.vy = 0
    tick(g)
  }
  expect(Math.hypot(steel.x - s0.x, steel.y - s0.y)).toBeGreaterThan(0.5)
  expect(Math.hypot(wood.x - w0.x, wood.y - w0.y)).toBeLessThan(0.05)
})

test('steel carries heat: hot at one end, it burns the bug on it, glows, and water cools it', () => {
  // Level 6: a steel cage, a bug sitting on its slab; flames play on the slab's far end, nowhere near the bug.
  const g = level(6)
  const slab = blocks(g, 'metal').find(b => b.hw > 1)!
  const bug = g.bodies.find(b => b.kind === 'bug' && Math.abs(b.x - slab.x) < 0.5 && b.y > slab.y)!
  let hottest = 0
  let glowed = false
  for (let k = 0; k < 120 && !bug.dead; k++) {
    if (k % 2 === 0) loose(g, FLAME, slab.x - slab.hw - 0.6, slab.y, 12, 0)
    running(g)
    hottest = Math.max(hottest, slab.warm)
    glowed ||= vector(g).svg.includes('#ffb03a')
  }
  expect(bug.dead).toBe(true)
  expect(hottest).toBeGreaterThan(0.6)
  expect(glowed).toBe(true)
  // Steel takes the heat without burning, and with next to no melting.
  expect(slab.fire).toBe(0)
  expect(slab.decay).toBeLessThan(0.1)
  // Water on it hisses off, and it cools at once.
  const before = slab.warm
  for (let k = 0; k < 6; k++) {
    loose(g, WATER, slab.x + slab.hw + 0.6, slab.y, -12, 0)
    running(g)
  }
  expect(slab.warm).toBeLessThan(before - 0.2)
})

test('acid eats steel away, and what is half eaten breaks at less of a knock', () => {
  const g = level(6)
  const post = blocks(g, 'metal').sort((a, b) => a.x - b.x)[0]!
  for (let k = 0; k < 6; k++) loose(g, ACID, post.x - 1, post.y + (k % 3) * 0.2 - 0.2, 15, 0)
  for (let k = 0; k < 12; k++) running(g)
  expect(post.decay).toBeGreaterThan(0.3)
  let k = 0
  while (!post.dead && k++ < 200) running(g)
  expect(post.dead).toBe(true)

  // Two sound posts and the same knock, 60% of what breaks a whole one: only the one half eaten breaks.
  const h = level(6)
  const [left, right] = blocks(h, 'metal').filter(b => b.hh > 0.5).sort((a, b) => a.x - b.x)
  left!.decay = 0.6
  for (const p of [left!, right!]) p.hit = p.strength * 0.6
  running(h)
  expect(left!.dead).toBe(true)
  expect(right!.dead).toBe(false)
})

test('heat melts a thing only once it is past its melting point', () => {
  // A tub that melts like plastic, set on something warm, then on something burning.
  const TUB = thing('Tub', { melts: 0.4, hard: 0.35 }, { width: 0.5, height: 0.4 })
  const melted = (heat: number) => {
    const g = level(1)
    put(g, thing('Plate', { heat }, { width: 1.4, height: 0.3 }), 9, 0.15)
    const tub = put(g, TUB, 9, 0.55, 0, -1)
    for (let i = 0; i < 60; i++) running(g)

    return tub.decay
  }
  expect(melted(0.5)).toBe(0)
  expect(melted(1)).toBeGreaterThan(0.1)
})

test('a thing rated before there was hardness counts as middling hard, blunt, and without iron', () => {
  const { hard: _h, sharp: _s, iron: _i, ...old } = matterOf({ conducts: 1 })
  const g = level(1)
  const b = put(g, thing('Old Rod', {}, { width: 0.8, height: 0.2 }, { matter: old as Matter }), 13, 0.5, 6, 0)
  expect(b.matter).toMatchObject({ hard: 0.5, sharp: 0, iron: 0, conducts: 1 })
  loose(g, drop({}, { matter: old as Matter, punch: 1 }), 15, 0.6, 12, 0)
  for (let i = 0; i < 40; i++) tick(g)
  for (const x of g.bodies) for (const v of [x.x, x.y, x.wear, x.decay, x.warm]) expect(Number.isFinite(v)).toBe(true)
  expect(felt(old as Matter, INERT)).toBe(1)
})

test('steel and concrete look their own, and so do their knocks and pits, stage by stage', () => {
  const g = level(7)
  const draw = () => vector(g).svg
  const steel = blocks(g, 'metal')[0]!
  const slab = blocks(g, 'concrete')[0]!
  const whole = draw()
  // Steel: riveted plates; concrete: grit, and the holes its forms were tied with.
  expect(whole).toContain('fill="#8ea2b6"')
  expect(whole).toContain('stroke="#2a333e" stroke-width="3.4"')
  expect(whole).toContain('fill="#b3ada2"')
  expect(whole).toContain('stroke="#827c71"')
  // Knocked about: steel dents, then buckles; concrete cracks, then spalls to its bars.
  steel.wear = steel.strength * 0.3
  slab.wear = slab.strength * 0.3
  const knocked = draw()
  expect(knocked).toContain('fill="#3f4d5c"')
  expect(knocked).toContain('stroke="#4a463f"')
  expect(knocked).not.toContain('fill="#8c867b"')
  steel.wear = slab.wear = 100
  steel.strength = slab.strength = 120
  const battered = draw()
  expect(battered).toContain('fill="#8c867b"')
  expect(battered).toContain('stroke="#9a5b33"')
  // Eaten: pits, rust running from steel's; then a bite out of the top.
  steel.decay = 0.2
  const pitted = draw()
  expect(pitted).toContain('stroke="#b45f22"')
  expect(pitted).toContain('stroke="#9b4a1a"')
  steel.decay = 0.5
  expect(draw().length).toBeGreaterThan(pitted.length)
  // What fire took shows as char, not pits.
  steel.char = 0.5
  expect(draw()).not.toContain('stroke="#b45f22"')
})

test('a flight shows a block glow, and pits come in from the tick acid reached them', () => {
  const g = level(6)
  const slab = blocks(g, 'metal').find(b => b.hw > 1)!
  const post = blocks(g, 'metal').sort((a, b) => a.x - b.x)[0]!
  // A shot in the air, and flames and acid on their way.
  put(g, thing('Pebble', { hard: 0.7 }, { width: 0.3, height: 0.3 }), 9, 6, 0, 0)
  for (let k = 0; k < 8; k++) loose(g, FLAME, slab.x - slab.hw - 0.6 - k * 0.3, slab.y, 12, 0)
  for (let k = 0; k < 6; k++) loose(g, ACID, post.x - 1 - k * 0.25, post.y, 15, 0)
  const rec = fly(g).rec
  const svg = animation(rec)
  const track = rec.tracks.find(t => t.body === post)!
  expect(track.eaten[0]).toBeGreaterThan(0)
  expect(svg).toContain('stroke="#b45f22"')
  expect(svg).toContain('stroke="#ffb03a"')
  expect(svg.length).toBeLessThan(100_000)
})
