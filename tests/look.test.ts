import { expect, test } from 'claude-code/testing'

import {
  INERT,
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
import { animation, vector } from '../hooks/vector'

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
  // Still, the fireball's five lobes round its core.
  expect(vector(g).svg.match(/fill="#ff6a2a"/g)?.length).toBe(5)

  const svg = animation(fly(g).rec)
  // The lobes swell and drift out, the flash is gone in a seventh of a second.
  expect(svg.match(/<circle r="[\d.]+" fill="#ff6a2a" transform="translate/g)?.length).toBe(5)
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
  // Five ticks on, a new frame starts its animations a fifth of a second in.
  const later = vector(g).svg
  expect(later).toContain('begin="-0.2s" repeatCount="indefinite"')
  expect(later).not.toContain('begin="0s" repeatCount="indefinite"')
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
