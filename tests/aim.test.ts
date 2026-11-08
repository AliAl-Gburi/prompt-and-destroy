import { expect, test } from 'claude-code/testing'

import { INERT, newGame, pointer, setForge, settleNow, type ShotSpec } from '../hooks/engine'
import { aimCells, backdrop, hudMarkup, pictureSize, vector } from '../hooks/vector'

const BALL: ShotSpec = {
  id: 'ball',
  prompt: 'a ball',
  name: 'Ball',
  width: 0.5,
  height: 0.5,
  density: 2,
  friction: 0.5,
  bounce: 0.3,
  color: '#e3350d',
  shape: 'circle',
  points: [],
  ability: 'none',
  power: {
    name: '',
    from: [0, 0],
    facing: 'around',
    aim: 'target',
    round: {
      art: '',
      look: '',
      width: 0.15,
      height: 0.15,
      color: '',
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
    },
  },
  matter: INERT,
  traits: [],
  art: '',
  quip: '',
}

function aimed() {
  const g = newGame(1, 0)
  settleNow(g)
  setForge(g, { status: 'ready', item: BALL, note: null })
  pointer(g, 'down', 50, 20)
  pointer(g, 'up', 50, 20)
  pointer(g, 'move', 38, 30)

  return g
}

test('the arc is braille dots with a target, and nothing of the sling', () => {
  const cells = aimCells(aimed(), 96, 24)
  expect(cells.filter(c => /[\u2801-\u28ff]/.test(c.text)).length).toBeGreaterThan(10)
  expect(cells.some(c => c.text === '◎')).toBe(true)
  // The sling, the Forge's drawing in its pouch, is the picture's.
  expect(cells.every(c => c.color === '#ffffff' || c.color === '#ff8a3d')).toBe(true)
})

test('nothing is drawn over the picture with nothing loaded', () => {
  const g = newGame(1, 0)
  settleNow(g)
  expect(aimCells(g, 96, 24)).toEqual([])
})

test('the picture takes the pane\'s shape: more sky in a tall one, more land in a wide one', () => {
  const base = pictureSize(100, 22)
  expect(base).toMatchObject({ W: 880, H: 440, view: { x0: 0, x1: 26, y0: -1, y1: 12, k: 1 } })

  // Tall: the whole level across, the rows under the Forge field filled with sky.
  const tall = pictureSize(60, 40)
  expect(tall.H).toBe(800)
  expect(tall.view).toMatchObject({ x0: 0, x1: 26, y0: -1 })
  expect(tall.view.y1).toBeGreaterThan(30)
  expect(Math.abs((tall.view.y1 - tall.view.y0) / (tall.view.x1 - tall.view.x0) - tall.H / tall.W)).toBeLessThan(0.01)
  // Narrow, so its words are drawn bigger.
  expect(tall.view.k).toBeGreaterThan(1)

  // Wide: the whole level up, land either side, the level in the middle.
  const wide = pictureSize(120, 20)
  expect(wide).toMatchObject({ W: 1056, H: 400 })
  expect(wide.view).toMatchObject({ y0: -1, y1: 12 })
  expect(wide.view.x0).toBeLessThan(0)
  expect(Math.abs(wide.view.x1 - 26 + wide.view.x0)).toBeLessThan(0.05)

  // Past the tallest shape it stops filling the pane's height, past the widest its width.
  expect(pictureSize(40, 200)).toMatchObject({ W: 352, H: 704 })
  expect(pictureSize(200, 12)).toMatchObject({ W: 800, H: 240 })
})

test('the scenery and the frames over it are drawn for the same view', () => {
  const g = aimed()
  const { view } = pictureSize(60, 40)
  const box = (svg: string) => /viewBox="([^"]+)"/.exec(svg)![1]
  const sky = backdrop(view)
  const frame = vector(g, view, false).svg
  expect(box(sky)).toBe(box(frame))
  expect(box(sky)).toBe(`0 0 1040 ${Math.round((view.y1 - view.y0) * 40)}`)
  // The ground is at the foot of the picture, however tall: its grass a meter's height above it.
  const grass = /<rect x="0" y="([\d.]+)" width="1040" height="9" fill="#4c8a3f"\/>/.exec(sky)
  expect(Math.abs(Number(grass![1]) - ((view.y1 - view.y0) * 40 - 40))).toBeLessThan(1)
})

test('a narrow picture keeps the bar along the top on one line, the name dropped first', () => {
  const g = aimed()
  const wideBar = hudMarkup(g)
  expect(wideBar).toContain('PROMPT &amp; DESTROY')
  vector(g, pictureSize(40, 40).view, false)
  const narrow = hudMarkup(g)
  expect(narrow).not.toContain('PROMPT &amp; DESTROY')
  expect(narrow).toContain('Score <tspan font-weight="700">')
  expect(Number(/font-size="([\d.]+)" fill="#e6ecff">Level/.exec(narrow)![1])).toBeGreaterThan(15)
})

test('in a tall pane the arc still meets the level at the picture\'s foot', () => {
  const cells = aimCells(aimed(), 60, 40)
  const target = cells.find(c => c.text === '◎')!
  expect(target).toBeDefined()
  // The level stands on the ground in the bottom third of the picture's 40 rows.
  expect(target.row).toBeGreaterThan(26)
  expect(target.row).toBeLessThan(40)
  expect(cells.every(c => c.row >= 0 && c.col >= 0 && c.col < 60)).toBe(true)
})
