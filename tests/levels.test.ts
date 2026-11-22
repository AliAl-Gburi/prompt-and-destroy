import { expect, test } from 'claude-code/testing'

import { WORLD_W, bugsLeft, newGame, settleNow, tick, type Game } from '../hooks/engine'

/** A level as it opens, and how far anything moved while it settled. */
function opened(n: number): { g: Game; drift: number } {
  const g = newGame(n, 0)
  const start = new Map(g.bodies.map(b => [b.id, { x: b.x, y: b.y }]))
  settleNow(g)
  let drift = 0
  for (const b of g.bodies) {
    const s = start.get(b.id)
    if (b.kind !== 'ground' && s) drift = Math.max(drift, Math.hypot(b.x - s.x, b.y - s.y))
  }

  return { g, drift }
}

test('every level, handmade and generated, opens standing still with bugs to squash', () => {
  for (let n = 1; n <= 30; n++) {
    const { g, drift } = opened(n)
    expect(g.phase).toBe('waiting')
    expect(drift).toBeLessThan(0.15)
    expect(bugsLeft(g)).toBeGreaterThan(1)
    expect(g.shots).toBeGreaterThanOrEqual(3)
    expect(g.shots).toBeLessThanOrEqual(6)
    for (const b of g.bodies) {
      if (b.kind === 'ground') continue
      expect(b.dead).toBe(false)
      // Clear of the launcher, inside the world, under its sky.
      expect(b.x - b.hw).toBeGreaterThan(10)
      expect(b.x + b.hw).toBeLessThan(WORLD_W)
      expect(b.y + b.hh).toBeLessThan(9)
    }
  }
})

test('a level left alone stays standing', () => {
  for (const n of [4, 5, 11, 23]) {
    const { g } = opened(n)
    const at = g.bodies.map(b => ({ x: b.x, y: b.y }))
    g.phase = 'settling'
    for (let i = 0; i < 150; i++) {
      tick(g)
      g.phase = 'settling'
      g.phaseTime = 0
    }
    g.bodies.forEach((b, i) => expect(Math.hypot(b.x - at[i]!.x, b.y - at[i]!.y)).toBeLessThan(0.1))
  }
})

test('generated levels each differ, and are the same each time they are played', () => {
  const layout = (n: number) => newGame(n, 0).bodies.map(b => `${b.mat}@${b.x.toFixed(2)},${b.y.toFixed(2)}`).join(' ')
  const seen = new Set<string>()
  for (let n = 6; n <= 30; n++) {
    expect(layout(n)).toBe(layout(n))
    seen.add(layout(n))
  }
  expect(seen.size).toBe(25)
  // Themed by name, numbered by level.
  expect(newGame(12, 0).title).toMatch(/^(Bug nest|Timber yard|Glass works|Stone fort|Steel mill|Bunker line) #12$/)
})

test('steel and concrete come in after the first five levels, each with a level of its own', () => {
  const mats = (n: number) => new Set(newGame(n, 0).bodies.map(b => b.mat))
  for (let n = 1; n <= 5; n++) {
    expect(mats(n).has('metal')).toBe(false)
    expect(mats(n).has('concrete')).toBe(false)
  }
  expect(mats(6).has('metal')).toBe(true)
  expect(mats(7).has('concrete')).toBe(true)
  // And the generated levels build with them too.
  const later = new Set<string>()
  for (let n = 8; n <= 30; n++) for (const m of mats(n)) later.add(m)
  for (const m of ['wood', 'stone', 'glass', 'metal', 'concrete']) expect(later.has(m)).toBe(true)
})

test('running out of shots says how many bugs got away', () => {
  const { g } = opened(1)
  g.shots = 0
  g.phase = 'flying'
  g.phaseTime = 20
  tick(g)
  expect(g.phase).toBe('lost')
  expect(g.banner?.text).toBe('Out of shots. 2 bugs survive... for now.')
})
