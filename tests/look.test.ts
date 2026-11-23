import { expect, test } from 'claude-code/testing'

import {
  INERT,
  elementCode,
  fire,
  matterOf,
  newGame,
  setForge,
  settleNow,
  stepParticle,
  tick,
  trigger,
  type Game,
  type Particle,
  type Round,
  type ShotSpec,
} from '../hooks/engine'
import { fly } from '../hooks/replay'
import { animation, backdrop, useClock, vector, type Recording } from '../hooks/vector'

const ROUND: Round = {
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
}

function thing(name: string, extra: Partial<ShotSpec> = {}): ShotSpec {
  return {
    id: name,
    prompt: name,
    name,
    width: 1.6,
    height: 1,
    density: 3,
    friction: 0.5,
    bounce: 0.1,
    color: '#3b3b48',
    shape: 'box',
    points: [],
    ability: 'none',
    power: { name: '', from: [0, 0], facing: 'right', aim: 'target', round: ROUND },
    matter: matterOf({}),
    traits: [],
    art: '',
    quip: '',
    ...extra,
  }
}

function flung(level: number, item: ShotSpec, aim: { x: number; y: number }): Game {
  const g = newGame(level, 0)
  settleNow(g)
  g.loaded = item
  g.phase = 'aiming'
  g.aim = aim
  expect(fire(g)).toBe(true)

  return g
}

/** Every tag's attributes named once, and every element closed: a slip in either blanks the whole picture. */
function wellFormed(svg: string): void {
  for (const tag of svg.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    const names = [...tag.matchAll(/\s([a-zA-Z:-]+)=/g)].map(m => m[1])
    expect(new Set(names).size).toBe(names.length)
  }
  const opens = (svg.match(/<[a-zA-Z][^>]*>/g) ?? []).filter(t => !t.endsWith('/>')).length
  expect(opens).toBe((svg.match(/<\/[a-zA-Z]+>/g) ?? []).length)
}

test('an explosion is a flash and a fireball, smoke left hanging, and the world shaken', () => {
  const g = flung(2, thing('Bomb', { width: 0.6, height: 0.6, shape: 'circle', ability: 'explode' }), { x: 1.85, y: 1.3 })
  for (let i = 0; i < 26; i++) tick(g)
  expect(trigger(g)).toBe(true)
  expect(g.effects.some(fx => fx.kind === 'blast' && fx.r > 1.5)).toBe(true)
  expect(g.particles.filter(p => p.kind === 'smoke').length).toBeGreaterThanOrEqual(4)
  expect(g.particles.filter(p => p.kind === 'spark').length).toBeGreaterThanOrEqual(10)
  // Still, the fireball's five lobes round its core, its light thrown round it.
  const still = vector(g).svg
  expect(still.match(/<circle cx="[-\d.]+" cy="[-\d.]+" r="[\d.]+" fill="url\(#pd-fireball\)"\/>/g)?.length).toBe(5)
  expect(still).toContain('fill="url(#pg-ff9a3a)"')
  expect(still).toContain('<radialGradient id="pd-fireball">')

  const svg = animation(fly(g).rec)
  // The lobes swell and drift out, the flash is gone in a seventh of a second.
  expect(svg.match(/<circle r="[\d.]+" fill="url\(#pd-fireball\)" transform="translate/g)?.length).toBe(5)
  expect(svg).toContain('<animate attributeName="opacity" values="0.9;0" begin="0s" dur="0.14s" fill="freeze"/>')
  // The world shakes from the first tick, the bar along the top does not.
  expect(svg).toMatch(/^<svg[^>]*><g><animateTransform attributeName="transform" type="translate" values="0 0;-[\d.]+ [\d.]+;/)
  wellFormed(svg)
})

test('a squashed bug leaves a puff and its points rising', () => {
  const g = flung(1, thing('Piano'), { x: 1.9, y: 1.25 })
  const bugs = g.bodies.filter(b => b.kind === 'bug').length
  let popped = false
  for (let i = 0; i < 120 && !popped; i++) {
    tick(g)
    popped = g.effects.some(fx => fx.kind === 'score')
  }
  expect(popped).toBe(true)
  expect(g.bodies.filter(b => b.kind === 'bug').length).toBeLessThan(bugs)
  expect(g.effects.find(fx => fx.kind === 'score')?.text).toBe('+500')
  expect(vector(g).svg).toContain('font-weight="800" fill="#ffd166">+500</text>')
})

test('a broken block flies apart in tumbling pieces that settle on the ground', () => {
  const g = flung(1, thing('Piano'), { x: 1, y: 1 })
  const block = g.bodies.find(b => b.kind === 'block')!
  block.hit = 99
  tick(g)
  expect(block.dead).toBe(true)
  const chunks = g.particles.filter(p => p.kind === 'chunk')
  expect(chunks.length).toBeGreaterThanOrEqual(3)
  // Pieces of what it was made of: a wooden post breaks into wood.
  expect(block.mat).toBe('wood')
  expect(chunks.some(p => p.color === 0xb47c43) && chunks.some(p => p.color === 0x6e4a26)).toBe(true)
  expect(chunks.every(p => p.spin !== 0)).toBe(true)
  // However high it starts, a chunk comes down and stays on the ground.
  const p: Particle = { kind: 'chunk', x: 0, y: 3, vx: 1, vy: 4, life: 3, max: 3, color: 0, size: 0.2, spin: 6 }
  for (let i = 0; i < 60; i++) stepParticle(p, 0.04)
  expect(Math.abs(p.y - 0.1)).toBeLessThan(1e-9)
  // Smoke rises and slows; a spark falls.
  const smoke: Particle = { ...p, kind: 'smoke', y: 1, vx: 0, vy: 0 }
  const spark: Particle = { ...p, kind: 'spark', y: 1, vx: 0, vy: 0 }
  for (let i = 0; i < 10; i++) {
    stepParticle(smoke, 0.04)
    stepParticle(spark, 0.04)
  }
  expect(smoke.y).toBeGreaterThan(1)
  expect(spark.y).toBeLessThan(1)
})

test('the shot leaves a dotted path to the first thing it touches, dimmed while the next is aimed', () => {
  const g = flung(1, thing('Piano'), { x: 1.9, y: 1.25 })
  const rec = fly(g).rec
  expect(rec.path.length).toBeGreaterThan(10)
  // Laid as it flew: each dot from the tick it was laid.
  expect(rec.path.every((p, i) => i === 0 || p.born >= rec.path[i - 1]!.born)).toBe(true)
  expect(g.pathDone).toBe(true)
  const svg = animation(rec)
  expect(svg).toContain('fill="#ffffff" opacity="0.75"')
  wellFormed(svg)
  // The turn over, it stays, dimmed.
  expect(g.phase).not.toBe('flying')
  expect(vector(g).svg).toContain('fill="#ffffff" opacity="0.35"')
})

test('a fire smokes and its embers drift up', () => {
  const g = flung(1, thing('Torch', { width: 0.3, height: 0.8, matter: matterOf({ heat: 1 }) }), { x: 1, y: 1 })
  const post = g.bodies.find(b => b.kind === 'block' && b.x < 16 && b.hh > 0.5)!
  post.fire = 4
  const kinds = new Set<string>()
  for (let i = 0; i < 40; i++) {
    tick(g)
    for (const p of g.particles) kinds.add(p.kind)
  }
  expect(kinds.has('ember')).toBe(true)
  expect(kinds.has('smoke')).toBe(true)
})

test('the Forge at work is a forge circle over the pouch, taken up where it was by every new frame', () => {
  const g = newGame(1, 0)
  settleNow(g)
  const work = { status: 'forging' as const, id: 'f1', prompt: 'a treasure chest' }
  setForge(g, work)
  const first = vector(g).svg
  expect(first).toContain('stroke-dasharray="11 5 2 5"')
  expect(first).toContain('begin="0s" repeatCount="indefinite"')
  // It animates itself: nothing is drawn again just because the Forge is at work.
  expect(tick(g)).toBe(false)
  for (let i = 0; i < 4; i++) {
    tick(g)
    setForge(g, work)
  }
  // Five ticks on, a new frame starts its animations a fifth of a second in: the ring turning, say.
  const later = vector(g).svg
  expect(later).toContain('from="0" to="360" dur="4s" begin="-0.2s" repeatCount="indefinite"')
  expect(later).not.toContain('from="0" to="360" dur="4s" begin="0s" repeatCount="indefinite"')
  wellFormed(later)
})

test('what the Forge made springs out of the forge in a flash, and settles', () => {
  const g = newGame(1, 0)
  settleNow(g)
  setForge(g, { status: 'forging', id: 'f1', prompt: 'a piano' })
  for (let i = 0; i < 10; i++) tick(g)
  setForge(g, { status: 'ready', item: thing('Piano'), note: null })
  const now = vector(g).svg
  expect(now).not.toContain('stroke-dasharray="11 5 2 5"')
  expect(now).toContain('type="scale" values="0.15;1.18;0.94;1" keyTimes="0;0.45;0.75;1" dur="0.5s" begin="0s" fill="freeze"')
  expect(now).toContain('fill="none" stroke="#ffd166" stroke-width="5"')
  wellFormed(now)
  for (let i = 0; i < 10; i++) tick(g)
  expect(vector(g).svg).toContain('dur="0.5s" begin="-0.4s" fill="freeze"')
  // A second on, it is simply in the pouch.
  for (let i = 0; i < 16; i++) tick(g)
  expect(vector(g).svg).not.toContain('type="scale" values="0.15;')
})

test('a blast sends a shock ring out past its fireball', () => {
  const g = flung(2, thing('Bomb', { width: 0.6, height: 0.6, shape: 'circle', ability: 'explode' }), { x: 1.85, y: 1.3 })
  for (let i = 0; i < 26; i++) tick(g)
  expect(trigger(g)).toBe(true)
  const svg = animation(fly(g).rec)
  expect(svg).toContain('fill="none" stroke="#fff1a8"')
  expect(svg).toContain('calcMode="spline" keySplines="0.2 0.7 0.4 1"')
  wellFormed(svg)
})

/** Every keyed animation in `svg`: one time per value, from 0 to 1, each later than the last. */
function keysValid(svg: string): number {
  let keyed = 0
  for (const tag of svg.match(/<animate(?:Transform)?\b[^>]*keyTimes="[^"]*"[^>]*>/g) ?? []) {
    const values = /values="([^"]*)"/.exec(tag)![1]!.split(';')
    const times = /keyTimes="([^"]*)"/.exec(tag)![1]!.split(';').map(Number)
    expect(times.length).toBe(values.length)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBe(1)
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!)
    keyed++
  }

  return keyed
}

test('a busy flight keeps every key it needs and only those, within what a post carries at full detail', () => {
  // Level 24's tall glass tower hit by a swarm that splits: a busy flight.
  const g = newGame(24, 0)
  settleNow(g)
  g.loaded = thing('Bees', { width: 0.7, height: 0.7, density: 2, ability: 'split' })
  g.phase = 'aiming'
  g.aim = { x: 1.9, y: 1.3 }
  fire(g)
  for (let i = 0; i < 18; i++) tick(g)
  trigger(g)
  const rec = fly(g).rec
  const svg = animation(rec)
  expect(svg.length).toBeLessThan(92_000)
  // Bodies are keyed tick by tick where they curve, and not where they glide.
  expect(keysValid(svg)).toBeGreaterThan(10)
  wellFormed(svg)
  // The bar along the top drawn once, its numbers each time they change.
  expect(svg.split('PROMPT &amp; DESTROY').length - 1).toBe(1)
  const scores = new Set(rec.hud.map(h => /Score <tspan font-weight="700">(\d+)/.exec(h)?.[1]))
  expect(scores.size).toBeGreaterThan(1)
  expect(svg.split('>Score <tspan').length - 1).toBe(scores.size)
  // One bug, defined once and used by every bug.
  expect(svg.split('id="pd-bug"').length - 1).toBe(1)
  expect(svg.split('<use href="#pd-bug"/>').length - 1).toBe(rec.tracks.filter(t => t.body.kind === 'bug').length)
})

test('rounds fired are keyed with exact times, so none jumps along its path', () => {
  const GUN = thing('Gun', {
    width: 0.6,
    height: 0.4,
    ability: 'shoot',
    power: { name: 'Fire', from: [0.3, 0.1], facing: 'right', aim: 'target', round: { ...ROUND, width: 0.04, height: 0.015, count: 7, every: 0.053, spread: 2, speed: 38, gravity: 0.05, punch: 2.2, life: 0.8, turn: 'point' } },
  })
  const g = flung(1, GUN, { x: 1.8, y: 1.4 })
  for (let i = 0; i < 10; i++) tick(g)
  trigger(g)
  const svg = animation(fly(g).rec)
  // Each key's own time, rising: rounded to a tenth, neighbouring keys shared one and the round jumped.
  keysValid(svg)
  wellFormed(svg)
})

test('what burnt stays blackened after the fire is out', () => {
  const g = flung(4, thing('Torch', { width: 0.3, height: 0.8, matter: matterOf({ heat: 1 }) }), { x: 1, y: 1 })
  const post = g.bodies.find(b => b.kind === 'block' && b.mat === 'wood')!
  post.fire = 1
  for (let i = 0; i < 40; i++) tick(g)
  expect(post.fire).toBe(0)
  expect(post.char).toBeGreaterThan(0.12)
  expect(elementCode(post)).toContain('c')
  // The still frame tints it, and the animation keeps the tint from when it charred on.
  expect(vector(g).svg).toMatch(/fill="#160b04" stroke="none"[^>]* opacity="0\.\d+"/)
})

test('a boomerang turned behind a tower comes back fast and flat through it', () => {
  const g = flung(1, thing('Boomerang', { width: 0.7, height: 0.25, density: 1.2, ability: 'boomerang' }), { x: 2.2, y: 0.9 })
  for (let i = 0; i < 12; i++) tick(g)
  const shot = g.bodies.find(b => b.kind === 'shot')!
  const [x0, y0] = [shot.x, shot.y]
  expect(trigger(g)).toBe(true)
  expect(shot.vx).toBeLessThan(-10)
  expect(shot.vy).toBe(0)
  for (let i = 0; i < 6; i++) tick(g)
  // A fifth of a second on: well back the way it came, at about the height it turned.
  expect(shot.x).toBeLessThan(x0 - 2)
  expect(Math.abs(shot.y - y0)).toBeLessThan(0.3)
})

test('a body that breaks takes its cracks, tints and glow with it', () => {
  // Shown "from a moment on", each sets its own visibility, which a hidden
  // parent cannot override: the body must go entirely, display and all.
  const g = flung(2, thing('Piano'), { x: 1.9, y: 1.25 })
  const rec = fly(g).rec
  const died = rec.tracks.filter(t => t.died >= 0).length
  expect(died).toBeGreaterThan(0)
  const svg = animation(rec)
  expect(svg.split('<set attributeName="display" to="none"').length - 1).toBe(died + rec.pellets.filter(p => p.died >= 0).length)
  wellFormed(svg)
})

test('the world lives: bugs breathe and blink, clouds drift, stars twinkle, all on the one clock', () => {
  const g = newGame(1, 0)
  settleNow(g)
  try {
    useClock(10_000)
    const a = vector(g).svg
    useClock(10_500)
    const b = vector(g).svg
    // Each bug breathes and blinks, at its own pace.
    const breaths = [...a.matchAll(/type="scale" values="1 1;1\.04 0\.96;1 1" dur="([\d.]+)s" begin="(-[\d.]+)s"/g)]
    expect(breaths.length).toBe(g.bodies.filter(x => x.kind === 'bug').length)
    expect(a.match(/values="1 0;1 0;1 1;1 0" keyTimes="0;0\.9;0\.95;1"/g)?.length).toBe(breaths.length)
    // Half a second later on the clock, a frame takes each loop up half a second further.
    const later = [...b.matchAll(/type="scale" values="1 1;1\.04 0\.96;1 1" dur="([\d.]+)s" begin="(-[\d.]+)s"/g)]
    breaths.forEach((m, i) => {
      const period = Number(m[1])
      const step = (((Number(m[2]) - Number(later[i]![2])) % period) + period) % period
      expect(Math.min(Math.abs(step - 0.5), Math.abs(step - 0.5 - period))).toBeLessThan(0.002)
    })
    // The sky moves in the frames, which are made fresh, and not in the backdrop, which is kept.
    expect(a).toContain('dur="150s"')
    expect(a).toMatch(/<circle cx="[\d.]+" cy="[\d.]+" r="[\d.]+" fill="#ffffff"><animate attributeName="opacity" values="0\.9;0\.15;0\.9"/)
    expect(backdrop()).not.toContain('<animate')
    wellFormed(a)
  } finally {
    useClock(0)
  }
})

test('a level won rains confetti, and stars pop round its words while they show', () => {
  const g = flung(1, thing('Piano'), { x: 1.9, y: 1.25 })
  for (const b of g.bodies) if (b.kind === 'bug') b.hit = 99
  for (let i = 0; i < 400 && g.phase === 'flying'; i++) tick(g)
  expect(g.phase).toBe('won')
  const now = vector(g).svg
  expect(now.match(/<rect x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+" rx="1" fill="#(?:ffd166|ff6b6b|7ee787|5fb8ff|c6a8ff|ff8a3d)">/g)?.length).toBe(36)
  expect(now.match(/<polygon points="[^"]+" fill="#ffd166" stroke="#7a4a00"/g)?.length).toBe(3)
  // The words spring in.
  expect(now).toContain('values="0.4;1.15;0.95;1"')
  wellFormed(now)
  // Once the words are gone, the confetti keeps falling, the stars go with them.
  for (let i = 0; i < 100; i++) tick(g)
  expect(g.banner).toBe(null)
  const later = vector(g).svg
  expect(later).toContain('rx="1" fill="#ffd166">')
  expect(later).not.toContain('stroke="#7a4a00" stroke-width="0.9"')
})

test('out of shots, the bugs that got away hop for joy', () => {
  const g = flung(3, thing('Piano'), { x: 0.3, y: -0.2 })
  g.shots = 0
  for (let i = 0; i < 400 && g.phase === 'flying'; i++) tick(g)
  expect(g.phase).toBe('lost')
  const svg = vector(g).svg
  expect(svg.match(/type="translate" values="0 0;0 -14;0 0" keyTimes="0;0\.45;1" calcMode="spline"/g)?.length).toBe(g.bodies.filter(b => b.kind === 'bug').length)
  wellFormed(svg)
})

test('a banner springs in, in a frame from when it went up and in a flight from its tick', () => {
  const g = newGame(1, 0)
  settleNow(g)
  // Just up: springing in from its start.
  expect(vector(g).svg).toMatch(/type="scale" values="0\.4;1\.15;0\.95;1" keyTimes="0;0\.55;0\.8;1" dur="0\.4s" begin="-?0s"/)
  for (let i = 0; i < 5; i++) tick(g)
  expect(vector(g).svg).toContain('dur="0.4s" begin="-0.2s"')
  // Up a while: just standing there.
  for (let i = 0; i < 10; i++) tick(g)
  expect(vector(g).svg).not.toContain('values="0.4;1.15;0.95;1"')
  // In a flight, each banner springs in at the tick it shows.
  const h = flung(1, thing('Piano'), { x: 1.9, y: 1.25 })
  const rec = fly(h).rec
  const banners = new Set(rec.words.map(w => /font-weight="800"[^>]*>([^<]+)</.exec(w)?.[1]).filter(Boolean)).size
  expect(banners).toBeGreaterThan(0)
  const svg = animation(rec)
  expect(svg.split('values="0.4;1.15;0.95;1"').length - 1).toBeGreaterThanOrEqual(banners)
  wellFormed(svg)
})

/** Every paint `svg` fills or strokes with, each defined in it exactly once. */
function paintsDefined(svg: string): number {
  const used = new Set([...svg.matchAll(/url\(#([\w-]+)\)/g)].map(m => m[1]!))
  for (const id of used) expect(`${id}: ${svg.split(`id="${id}"`).length - 1}`).toBe(`${id}: 1`)

  return used.size
}

test('every picture defines each paint it is lit with, once, wherever it is drawn', () => {
  // The scenery, kept under every frame.
  expect(paintsDefined(backdrop())).toBeGreaterThan(10)
  // A still frame mid-blast, with fire and bugs in it; then the flight it is part of, the scenery and all.
  const g = flung(4, thing('Bomb', { width: 0.6, height: 0.6, shape: 'circle', ability: 'explode' }), { x: 2.2, y: 0.9 })
  for (let i = 0; i < 22; i++) tick(g)
  expect(trigger(g)).toBe(true)
  g.bodies.find(b => b.kind === 'block' && b.mat === 'wood')!.fire = 2
  for (let i = 0; i < 3; i++) tick(g)
  const still = vector(g).svg
  expect(paintsDefined(still)).toBeGreaterThan(10)
  const svg = animation(fly(g).rec)
  expect(paintsDefined(svg)).toBeGreaterThan(10)
  // A paint made for a color: smoke soft at its edge, sparks glowing.
  expect(svg).toMatch(/fill="url\(#ps-[0-9a-f]{6}\)"/)
  expect(svg).toMatch(/fill="url\(#pk-[0-9a-f]{6}\)"/)
  wellFormed(svg)
})

test('a block stands in its own shadow, and one broken where it stood takes only that shadow with it', () => {
  const g = newGame(1, 0)
  settleNow(g)
  const standing = g.bodies.filter(b => b.kind === 'block' && b.y - b.hh < 0.12)
  expect(standing.length).toBeGreaterThan(0)
  const still = vector(g).svg
  expect(still.match(/ry="5.5" fill="url\(#pd-shadow\)"/g)?.length).toBe(standing.length)
  // A post that breaks without moving first: what hides its shadow must hide nothing else.
  const post = standing[0]!
  const ticks = 10
  const rec: Recording = {
    ticks,
    tracks: [{ body: post, born: 0, died: 5, poses: Array.from({ length: 6 }, () => [post.x, post.y, post.a]).flat(), cracked: [-1, -1], eaten: [-1, -1], flash: -1, states: Array(6).fill('') }],
    pellets: [],
    sparks: [],
    effects: [],
    path: [],
    joints: [],
    hud: Array(ticks + 1).fill(''),
    words: Array(ticks + 1).fill(''),
    ready: Array(ticks + 1).fill(null),
    look: null,
  }
  const svg = animation(rec)
  expect(svg).toContain('fill="url(#pd-shadow)"')
  // Each `display` set sits inside a group of its own, never straight in the world's (the svg, then the shaken world, then it).
  const stack: string[] = []
  let sets = 0
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    if (m[1]) {
      stack.pop()
      continue
    }
    if (m[2] === 'set' && m[3]!.includes('attributeName="display"')) {
      sets++
      expect(stack.length).toBeGreaterThanOrEqual(3)
    }
    if (!m[4]) stack.push(m[2]!)
  }
  expect(sets).toBe(2)
  wellFormed(svg)
})
