// Prompt & Destroy as vectors, for the surfaces that draw `Svg` (the desktop
// app): the scenery once (backdrop); over it, while aiming, one transparent
// SVG document per frame with everything that moves (vector); and for a shot
// in flight, the whole flight recorded (replay.ts) and drawn as one SVG
// animation (animation) that the surface plays at its own frame rate.
//
// Pure, like engine.ts. Shapes, strokes, gradients, opacity and SMIL, and
// `<use>` of what a picture defines itself: what the desktop's sanitizer keeps
// (no filters, which cost every frame an animation redraws). Each picture
// defines the gradients it uses once, at its end (`withPaints`).

import {
  BUG,
  LAUNCHER_X,
  MATERIALS,
  TICK_MS,
  TIP_L,
  TIP_R,
  WORLD_H,
  WORLD_W,
  bugsLeft,
  elementCode,
  hexColor,
  jointAnchor,
  mix,
  parseColor,
  pouchPosition,
  shade,
  shapeOf,
  statusLine,
  stepParticle,
  trajectory,
  visible,
  type Ammo,
  type Body,
  type Effect,
  type Game,
  type Particle,
  type Pellet,
  type Round,
  type ShapeInfo,
  type ShotSpec,
} from './engine'

/** Picture units per meter. */
const S = 40

/**
 * What a picture shows of the world, in meters: from x0 to x1 across, from
 * y0 (a meter under the ground) up to y1. The whole level always shows; a
 * pane taller than the world's 2:1 shows more sky over it, a wider one more
 * land either side. `k` scales the words and bars to stay readable on a
 * narrow picture.
 */
export type View = { x0: number; x1: number; y0: number; y1: number; k: number }
/** The world as it was made: 26 by 13 meters. */
export const BASE_VIEW: View = { x0: 0, x1: WORLD_W, y0: -1, y1: WORLD_H - 1, k: 1 }
/** The tallest and the widest a picture gets, height over width: past them it fills the pane one way only. */
const MAX_TALL = 2
const MAX_WIDE = 0.3
/** A picture's words are drawn at least this many pixels to a unit of type. */
const MIN_TYPE = 0.62

// The view being drawn: everything below draws through sx and sy and these.
let view = BASE_VIEW
let VIEW_W = WORLD_W * S
let VIEW_H = WORLD_H * S

/** Draws what follows for this view. */
/**
 * The wall clock, in ms, when the picture being drawn was made. Loops that
 * run all the time (bugs breathing and blinking, clouds drifting, stars
 * twinkling) begin as far into themselves as this clock is, so every
 * picture, made whenever and shown over whichever, has them at the same
 * point: nothing jumps when a flight goes over a frame. 0 until set.
 */
let clock = 0

export function useClock(ms: number): void {
  clock = ms
}

/** Seconds to the tenth: a loop's period, written as it is reckoned with. */
function tenths(v: number): number {
  return Math.round(v * 10) / 10
}

/** A SMIL begin for a loop of `period` seconds, at the clock's point in it, `shift` seconds along. */
function loop(period: number, shift = 0): string {
  const t = (((clock / 1000 + shift) % period) + period) % period

  return `${-Math.round(t * 1000) / 1000}s`
}

export function useView(v: View): void {
  if (v.x0 === view.x0 && v.x1 === view.x1 && v.y0 === view.y0 && v.y1 === view.y1 && v.k === view.k) return
  view = v
  VIEW_W = Math.round((v.x1 - v.x0) * S)
  VIEW_H = Math.round((v.y1 - v.y0) * S)
  scenery = ''
  emptyBand = ''
}
/** A frame past this many characters drops detail (a Client post holds 100,000). */
const BUDGET = 90_000

/**
 * A desktop cell in pixels, measured from a screenshot of a ruler drawn in
 * the pane: 96 columns spanned 844 pixels, 9 rows 180.
 */
export const CELL_W = 8.8
export const CELL_H = 20

/**
 * How big the game is drawn in a desktop pane `cols` wide with `rows` under
 * the Forge field, and what of the world it shows: it fills them.
 */
export function pictureSize(cols: number, rows: number): { W: number; H: number; view: View } {
  const room = Math.max(8, rows) * CELL_H
  let W = Math.round(Math.max(320, cols * CELL_W))
  let aspect = Math.min(MAX_TALL, room / W)
  // Past the widest shape, as tall as the room and no wider than that shape.
  if (aspect < MAX_WIDE) {
    W = Math.round(room / MAX_WIDE)
    aspect = MAX_WIDE
  }
  const H = Math.round(W * aspect)
  const round = (v: number) => Math.round(v * 100) / 100
  let v: View
  if (aspect >= WORLD_H / WORLD_W) {
    v = { ...BASE_VIEW, y1: round(BASE_VIEW.y0 + WORLD_W * aspect) }
  } else {
    const wide = WORLD_H / aspect
    const x0 = round((WORLD_W - wide) / 2)
    v = { ...BASE_VIEW, x0, x1: round(x0 + wide) }
  }
  // Pixels to a picture unit: past the floor, the words grow to keep it.
  const px = W / ((v.x1 - v.x0) * S)
  v.k = round(Math.min(1.8, Math.max(1, MIN_TYPE / px)))

  return { W, H, view: v }
}
const FONT = 'ui-rounded, ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif'

const sx = (x: number) => (x - view.x0) * S
const sy = (y: number) => (view.y1 - y) * S

/** A number short: one decimal at most. */
function n(v: number): string {
  const r = Math.round(v * 10) / 10

  return Object.is(r, -0) ? '0' : String(r)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hash(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)

  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Places a body's own frame (y up, meters) on screen (y down, pixels). */
function place(x: number, y: number, a: number): string {
  const deg = (-a * 180) / Math.PI

  return `translate(${n(sx(x))} ${n(sy(y))})${Math.abs(deg) > 0.05 ? ` rotate(${n(deg)})` : ''}`
}

// ---------------------------------------------------------------------------
// Paints: the gradients the pictures are lit with. Each is drawn on the box
// of what it fills, so one wood serves every plank, a diagonal one lighting
// a plank from above and a post from its left; and a picture defines only the
// ones it uses, once, at its end (`withPaints`).

const stop = (at: number, color: string, alpha = 1) => `<stop offset="${at}" stop-color="${color}"${alpha < 1 ? ` stop-opacity="${alpha}"` : ''}/>`
const linear = (id: string, stops: string, dir: string) => `<linearGradient id="${id}"${dir}>${stops}</linearGradient>`
const radial = (id: string, stops: string, at = '') => `<radialGradient id="${id}"${at}>${stops}</radialGradient>`
/** Top to bottom, and top left to bottom right. */
const DOWN = ' x2="0" y2="1"'
const SLANT = ' x2="1" y2="1"'

const PAINTS: Record<string, string> = {
  // Blocks, lit from the upper left.
  'pd-wood': linear('pd-wood', stop(0, '#dca46a') + stop(0.5, '#b47c43') + stop(1, '#87582b'), SLANT),
  'pd-stone': linear('pd-stone', stop(0, '#b9bec8') + stop(0.5, '#9298a2') + stop(1, '#6b717c'), SLANT),
  'pd-concrete': linear('pd-concrete', stop(0, '#d6d0c4') + stop(0.5, '#b3ada2') + stop(1, '#8b857a'), SLANT),
  'pd-metal': linear('pd-metal', stop(0, '#c8d5e2') + stop(0.28, '#8ea2b6') + stop(0.5, '#c2d0de') + stop(0.72, '#7b8fa4') + stop(1, '#5a6c80'), SLANT),
  'pd-glass': linear('pd-glass', stop(0, '#e2f8ff', 0.75) + stop(0.45, '#9fdcf5', 0.35) + stop(1, '#4fb0d8', 0.6), SLANT),
  // A block's edges catching the light: lit along its top and left, shaded along its foot and right; steel's brighter.
  'pd-bevel': linear('pd-bevel', stop(0, '#ffffff', 0.55) + stop(0.42, '#ffffff', 0.06) + stop(0.58, '#000000', 0.06) + stop(1, '#000000', 0.42), SLANT),
  'pd-sheen': linear('pd-sheen', stop(0, '#ffffff', 0.9) + stop(0.4, '#ffffff', 0.12) + stop(0.6, '#000000', 0.08) + stop(1, '#000000', 0.5), SLANT),
  // A bug's round shell, its eyes, and the shadow under things.
  'pd-shell': radial('pd-shell', stop(0, '#f2c2ff') + stop(0.35, '#c865e0') + stop(0.8, '#9234b0') + stop(1, '#6a1f84'), ' fx="0.36" fy="0.28"'),
  'pd-eye': radial('pd-eye', stop(0, '#ffffff') + stop(0.7, '#f3efff') + stop(1, '#cdc3e6'), ' fx="0.42" fy="0.36"'),
  'pd-shadow': radial('pd-shadow', stop(0, '#000000', 0.5) + stop(0.55, '#000000', 0.22) + stop(1, '#000000', 0)),
  // Fire, from its red tips down to its yellow root; its heart; a thing glowing hot; frost.
  'pd-flame': linear('pd-flame', stop(0, '#ff2a12', 0.55) + stop(0.35, '#ff5420') + stop(0.75, '#ff9a1c') + stop(1, '#ffc93c'), DOWN),
  'pd-core': linear('pd-core', stop(0, '#ffb347') + stop(0.55, '#ffe066') + stop(1, '#fff8d0'), DOWN),
  'pd-heat': radial('pd-heat', stop(0, '#fff3a6', 0.95) + stop(0.35, '#ffb020', 0.85) + stop(0.75, '#ff6a1a', 0.7) + stop(1, '#ff3300', 0.55)),
  'pd-ice': linear('pd-ice', stop(0, '#ffffff', 0.9) + stop(0.5, '#d6f4ff', 0.55) + stop(1, '#8fd6ff', 0.7), SLANT),
  // A fireball: white at its heart, out through yellow and orange to a red that fades.
  'pd-fireball': radial('pd-fireball', stop(0, '#fff7cc') + stop(0.3, '#ffd166') + stop(0.62, '#ff8a2a') + stop(0.86, '#e8451e', 0.9) + stop(1, '#b8261a', 0)),
  // The bars and the words.
  'pd-bar': linear('pd-bar', stop(0, '#111a40', 0.92) + stop(1, '#070b1a', 0.8), DOWN),
  'pd-rule': linear('pd-rule', stop(0, '#ff8a3d', 0) + stop(0.12, '#ff8a3d') + stop(0.88, '#ffd166') + stop(1, '#ffd166', 0), ''),
  'pd-gold': linear('pd-gold', stop(0, '#fff5bf') + stop(0.5, '#ffd166') + stop(1, '#ff9a1f'), DOWN),
  'pd-brand': linear('pd-brand', stop(0, '#ff6f2a') + stop(1, '#ffc34d'), ''),
  'pd-coin': radial('pd-coin', stop(0, '#fff7d4') + stop(0.5, '#ffd166') + stop(1, '#d4870f'), ' fx="0.35" fy="0.3"'),
  'pd-leather': linear('pd-leather', stop(0, '#8a5d36') + stop(1, '#4a2d16'), SLANT),
  'pd-cloud': radial('pd-cloud', stop(0, '#cdd8ff', 0.16) + stop(0.55, '#b9c6f5', 0.08) + stop(1, '#b9c6f5', 0)),
  'pd-meteor': linear('pd-meteor', stop(0, '#ffffff') + stop(1, '#c8d4ff', 0), ''),
}

/**
 * A paint made for a color, named for it (short: a flight has many): `ps-`
 * a soft round puff of it, `pk-` a white-hot point glowing out into it,
 * `pg-` light of it fading out, `pl-` a ball of it lit from its upper left.
 */
function colorPaint(id: string): string {
  const m = /^p([skgl])-([0-9a-f]{6})$/.exec(id)
  if (!m) return ''
  const c = `#${m[2]}`
  switch (m[1]) {
    case 's':
      return radial(id, stop(0, c, 0.9) + stop(0.5, c, 0.6) + stop(1, c, 0))
    case 'k':
      return radial(id, stop(0, '#ffffff') + stop(0.28, c) + stop(1, c, 0))
    case 'g':
      return radial(id, stop(0, c, 0.55) + stop(0.4, c, 0.22) + stop(1, c, 0))
    default: {
      const v = parseInt(m[2]!, 16)

      return radial(id, stop(0, hexColor(mix(v, 0xffffff, 0.5))) + stop(0.5, c) + stop(1, hexColor(shade(v, 0.55))), ' fx="0.34" fy="0.3"')
    }
  }
}

/** A color's paint of a kind (see `colorPaint`): soft, spark, glow or lit, as a fill or stroke. */
function tinted(kind: 's' | 'k' | 'g' | 'l', color: number): string {
  return `url(#p${kind}-${hexColor(color).slice(1)})`
}

/** `body`, and after it every paint it uses and does not define itself, each once. */
function withPaints(body: string): string {
  let defs = ''
  const done = new Set<string>()
  for (const m of body.matchAll(/url\(#(p[a-z]{0,2}-[a-z0-9-]+)\)/g)) {
    const id = m[1]!
    if (done.has(id)) continue
    done.add(id)
    if (!body.includes(`id="${id}"`)) defs += PAINTS[id] ?? SKY_PAINTS[id] ?? colorPaint(id)
  }

  return defs ? `${body}<defs>${defs}</defs>` : body
}

// ---------------------------------------------------------------------------
// The scenery, drawn once

let scenery = ''

/** A number to the whole pixel: what never moves is drawn at whole pixels, and its markup is the shorter. */
const px = (v: number) => String(Math.round(v))

function hillPath(f: (x: number) => number): string {
  // One line command, its points following: a point every half meter is smooth at this size.
  let d = `M-4 ${px(sy(-1))}L-4 ${px(sy(f(view.x0)))}`
  for (let x = view.x0; x <= view.x1 + 0.01; x += 0.5) d += ` ${px(sx(x))} ${px(sy(f(x)))}`

  return `${d} ${VIEW_W + 4} ${px(sy(f(view.x1)))} ${VIEW_W + 4} ${px(sy(-1))}Z`
}

/** The scenery: what never moves, drawn once a view, and what drifts and twinkles over it. */
function drawScenery(): string {
  return stillScenery() + ambience()
}

/**
 * What moves in the sky, at the clock's point: soft clouds drifting slowly
 * to and fro, spread over the sky's width and, in a tall one, down it (two
 * more there, where the world's own sky has no room for them); a few stars
 * twinkling; now and then a shooting star.
 */
function ambience(): string {
  const across = VIEW_W / (WORLD_W * S)
  const bar = 34 * view.k
  const deep = (sy(4) - bar) / (WORLD_H - 5) / S
  const clouds: [number, number, number][] = [
    [190, 92, 120],
    [560, 58, 90],
    [700, 140, 150],
  ]
  if (deep > 1.6) clouds.push([330, 230, 110], [860, 280, 140])
  let out = ''
  clouds.forEach(([x, y, w], i) => {
    const cx = x * across
    const cy = bar + (y - 34) * Math.max(1, deep)
    const period = 150 + i * 23
    // A long low body and the puffs heaped on it, each soft at its edge.
    const puff = (dx: number, dy: number, rx: number, ry: number) => `<ellipse cx="${n(cx + dx * w)}" cy="${n(cy + dy * w)}" rx="${n(rx * w)}" ry="${n(ry * w)}"/>`
    out +=
      `<g fill="url(#pd-cloud)"><animateTransform attributeName="transform" type="translate" values="0 0;${n(40 + w / 3)} 0;0 0" dur="${period}s" begin="${loop(period, i * 37)}" repeatCount="indefinite"/>` +
      puff(0.05, 0.02, 0.62, 0.2) +
      puff(-0.18, -0.07, 0.3, 0.17) +
      puff(0.16, -0.09, 0.36, 0.21) +
      `</g>`
  })
  // Twinkling stars, each at its own pace, none over the moon.
  const mx = VIEW_W - 160
  const my = 44 + 34 * view.k
  for (let i = 0; i < Math.round(9 * across); i++) {
    const x = hash(i + 909) * VIEW_W
    const y = 40 + hash(i + 919) * Math.max(10, sy(4) - 60)
    if (Math.hypot(x - mx, y - my) < 90) continue
    const period = tenths(2.2 + hash(i + 929) * 2.6)
    out +=
      `<circle cx="${n(x)}" cy="${n(y)}" r="${n(1 + hash(i + 939) * 0.8)}" fill="#ffffff">` +
      `<animate attributeName="opacity" values="0.9;0.15;0.9" dur="${n(period)}s" begin="${loop(period, i * 0.7)}" repeatCount="indefinite"/></circle>`
  }
  // A shooting star across the high sky every quarter of a minute or so, gone in a moment.
  const period = 13.7
  const sx0 = VIEW_W * 0.78
  const sy0 = bar + 30
  const time = `dur="${period}s" begin="${loop(period, 5)}" repeatCount="indefinite"`
  out +=
    `<g opacity="0"><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.01;0.035;0.06;1" ${time}/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;${n(-VIEW_W * 0.26)} 95;${n(-VIEW_W * 0.26)} 95" keyTimes="0;0.06;1" ${time}/>` +
    `<path d="M${n(sx0)} ${n(sy0)}l70 -26" stroke="url(#pd-meteor)" stroke-width="2.2" stroke-linecap="round"/></g>`

  return out
}

/** The scenery's own paints, defined in it, so a flight drawn over it has them too. */
const SKY_PAINTS: Record<string, string> = {
  'pds-sky': linear('pds-sky', stop(0, '#070b1f') + stop(0.62, '#18275a') + stop(0.88, '#2f3d76') + stop(1, '#4b4a82'), DOWN),
  'pds-dusk': radial('pds-dusk', stop(0, '#a07ee6', 0.34) + stop(0.5, '#6d61c9', 0.13) + stop(1, '#6d61c9', 0)),
  'pds-band': radial('pds-band', stop(0, '#dfe6ff', 0.1) + stop(0.6, '#c9d3ff', 0.04) + stop(1, '#c9d3ff', 0)),
  'pds-star': radial('pds-star', stop(0, '#ffffff', 0.75) + stop(0.25, '#dfe6ff', 0.25) + stop(1, '#dfe6ff', 0)),
  'pds-halo': radial('pds-halo', stop(0, '#fff6d6', 0.42) + stop(0.24, '#f4efd8', 0.15) + stop(1, '#c8d4ff', 0)),
  'pds-moon': radial('pds-moon', stop(0, '#fffef6') + stop(0.55, '#f2ecce') + stop(1, '#d2c79a'), ' fx="0.36" fy="0.32"'),
  'pds-far': linear('pds-far', stop(0, '#3a5089') + stop(1, '#1e2b55'), DOWN),
  'pds-mid': linear('pds-mid', stop(0, '#27386a') + stop(1, '#131d3d'), DOWN),
  'pds-near': linear('pds-near', stop(0, '#1b2649') + stop(1, '#0c1429'), DOWN),
  'pds-mist': linear('pds-mist', stop(0, '#aab8ff', 0) + stop(0.5, '#aab8ff', 0.11) + stop(1, '#aab8ff', 0), DOWN),
  'pds-soil': linear('pds-soil', stop(0, '#5f432c') + stop(0.3, '#48331f') + stop(1, '#22170e'), DOWN),
  'pds-turf': linear('pds-turf', stop(0, '#a3e886') + stop(0.3, '#62b14c') + stop(1, '#2c5925'), DOWN),
  'pds-blade': linear('pds-blade', stop(0, '#b3f093') + stop(1, '#3a7631'), DOWN),
  'pds-post': linear('pds-post', stop(0, '#c99360') + stop(0.45, '#97663a') + stop(1, '#5b3a1e'), ''),
  'pds-vignette': radial('pds-vignette', stop(0.55, '#000000', 0) + stop(1, '#01020a', 0.42), ' cy="0.42" r="0.78"'),
}

function stillScenery(): string {
  if (scenery) return scenery
  const parts: string[] = []
  const top = sy(0)
  const across = VIEW_W / (WORLD_W * S)
  // The sky: deep overhead, dusky violet at the horizon where its glow lies
  // low behind the hills; the galaxy's band rising across it, thick with
  // faint stars.
  parts.push(
    `<rect width="${VIEW_W}" height="${px(top + 2)}" fill="url(#pds-sky)"/>`,
    `<ellipse cx="${px(VIEW_W * 0.42)}" cy="${px(top)}" rx="${px(VIEW_W * 0.78)}" ry="${px(Math.min(top * 0.6, 280))}" fill="url(#pds-dusk)"/>`,
  )
  const bx = (t: number) => VIEW_W * (0.02 + 0.96 * t)
  const by = (t: number) => top * (0.86 - 0.8 * t)
  const tilt = n((Math.atan2(by(1) - by(0), bx(1) - bx(0)) * 180) / Math.PI)
  let band = ''
  for (let k = 0; k < 5; k++) {
    const t = (k + 0.5) / 5
    band += `<ellipse cx="${px(bx(t))}" cy="${px(by(t))}" rx="${px(VIEW_W * 0.16)}" ry="${px(20 + hash(k + 51) * 16)}" transform="rotate(${tilt} ${px(bx(t))} ${px(by(t))})"/>`
  }
  parts.push(`<g fill="url(#pds-band)">${band}</g>`)
  const dust: [number, number][] = []
  for (let i = 0; i < Math.round(36 * across); i++) {
    const t = hash(i + 1201)
    const off = (hash(i + 1301) - 0.5) * (hash(i + 1401) + 0.2) * 60
    dust.push([Math.round(bx(t) - off * 0.3), Math.round(by(t) + off)])
  }
  parts.push(`<path d="${dots(dust)}" stroke="#dfe6ff" stroke-width="1.1" stroke-linecap="round" opacity="0.5"/>`)
  // Stars, as many to a patch of sky however much there is, in four
  // brightnesses; a few of the brightest glowing, with a twinkle's cross.
  const stars = Math.round((70 * VIEW_W * sy(3.5)) / (WORLD_W * S * (WORLD_H - 4.5) * S))
  const lit: [number, number][][] = [[], [], [], []]
  let crosses = ''
  let glows = ''
  for (let i = 0; i < stars; i++) {
    const x = Math.round(hash(i) * VIEW_W)
    const y = Math.round(hash(i + 101) * sy(3.5))
    const o = Math.min(3, Math.floor(hash(i + 303) * 4))
    if (i % 11 === 0) {
      const k = Math.round(3 + hash(i + 202) * 3)
      crosses += `M${x - k} ${y}h${2 * k}M${x} ${y - k}v${2 * k}`
      glows += `<circle cx="${x}" cy="${y}" r="${px(k * 1.6)}"/>`
    }
    lit[o]!.push([x, y])
  }
  lit.forEach((pts, o) => parts.push(`<path d="${dots(pts)}" stroke="#e6ecff" stroke-width="${n(1.3 + o * 0.6)}" stroke-linecap="round" opacity="${n(0.42 + o * 0.17)}"/>`))
  if (glows) parts.push(`<g fill="url(#pds-star)">${glows}</g>`, `<path d="${crosses}" stroke="#eef2ff" stroke-width="1" opacity="0.7"/>`)
  // The moon, high on the right under the bar along the top: its light
  // spread round it, lit from the upper left, its far side in shadow, its
  // seas and craters soft.
  const mx = VIEW_W - 160
  const my = 44 + 34 * view.k
  parts.push(
    `<circle cx="${mx}" cy="${n(my)}" r="150" fill="url(#pds-halo)"/>`,
    `<circle cx="${mx}" cy="${n(my)}" r="32" fill="url(#pds-moon)"/>`,
    `<path d="M${mx + 6} ${n(my - 31.4)}A32 32 0 0 1 ${mx + 6} ${n(my + 31.4)}A24 32 0 0 0 ${mx + 6} ${n(my - 31.4)}Z" fill="#b8ad82" opacity="0.32"/>`,
    `<g fill="#d8cfa6" opacity="0.7"><ellipse cx="${mx - 9}" cy="${n(my - 9)}" rx="9" ry="6.5"/><ellipse cx="${mx + 8}" cy="${n(my + 9)}" rx="7" ry="5"/></g>`,
    `<g fill="none" stroke="#c9bf95" stroke-width="1.2"><circle cx="${mx - 14}" cy="${n(my + 11)}" r="3.4"/><circle cx="${mx + 10}" cy="${n(my - 14)}" r="2.6"/><circle cx="${mx - 2}" cy="${n(my + 20)}" r="2"/></g>`,
  )
  // (The clouds, twinkling stars and shooting stars move: they are drawn fresh, in `ambience`.)
  // Three ranges of hills, hazier the further off, each lit along its ridge
  // by the moon; mist lying in the valley before the nearest; pines on it.
  const far = (x: number) => 3.4 + 1.1 * Math.sin(x * 0.15 + 0.4) + 0.4 * Math.sin(x * 0.5 + 1)
  const mid = (x: number) => 2.2 + 0.9 * Math.sin(x * 0.23 + 1.3) + 0.5 * Math.sin(x * 0.61)
  const near = (x: number) => 1.1 + 0.6 * Math.sin(x * 0.37 + 4) + 0.3 * Math.sin(x * 1.1 + 2)
  parts.push(
    `<path d="${hillPath(far)}" fill="url(#pds-far)" stroke="#6f86c9" stroke-width="1.5" stroke-opacity="0.45" opacity="0.8"/>`,
    `<path d="${hillPath(mid)}" fill="url(#pds-mid)" stroke="#4e65a8" stroke-width="2" stroke-opacity="0.6"/>`,
    `<rect y="${n(sy(1.9))}" width="${VIEW_W}" height="${n(sy(0.5) - sy(1.9))}" fill="url(#pds-mist)"/>`,
  )
  let pines = ''
  for (let x = view.x0 + 0.3; x < view.x1; x += 0.7 + hash(Math.round(x * 10) + 77) * 0.9) {
    if (hash(Math.round(x * 10) + 99) < 0.3) continue
    const h = (0.45 + hash(Math.round(x * 10) + 88) * 0.45) * S
    const w = h * 0.56
    const tx = sx(x)
    const ty = sy(near(x)) + 3
    pines += `M${px(tx)} ${px(ty - h)}l${n(w * 0.32)} ${n(h * 0.45)}h${n(-w * 0.13)}l${n(w * 0.31)} ${n(h * 0.55)}h${n(-w)}l${n(w * 0.31)} ${n(-h * 0.55)}h${n(-w * 0.13)}Z`
  }
  parts.push(`<path d="${pines}" fill="#121b37"/>`, `<path d="${hillPath(near)}" fill="url(#pds-near)" stroke="#3a5088" stroke-width="2" stroke-opacity="0.7"/>`)
  // The ground: earth darkening with depth, pebbles in it; turf along its
  // top, blades of grass and a few flowers standing in it.
  parts.push(`<rect y="${n(top)}" width="${VIEW_W}" height="${n(VIEW_H - top)}" fill="url(#pds-soil)"/>`)
  const pebbles: [number, number][] = []
  for (let i = 0; i < Math.round(16 * across); i++) pebbles.push([Math.round(hash(i + 404) * VIEW_W), Math.round(top + 15 + hash(i + 505) * (VIEW_H - top - 18))])
  parts.push(`<path d="${dots(pebbles)}" stroke="#2a1d14" stroke-width="4.4" stroke-linecap="round"/>`)
  parts.push(`<rect y="${n(top)}" width="${VIEW_W}" height="10" fill="url(#pds-turf)"/>`, `<rect y="${n(top + 9)}" width="${VIEW_W}" height="3" fill="#1b3016" opacity="0.85"/>`)
  let tufts = ''
  for (let x = 4; x < VIEW_W; x += 10 + hash(x) * 11) {
    const h = Math.round(4 + hash(x + 1) * 7)
    tufts += `M${Math.round(x)} ${n(top + 1.5)}l2-${h} 1 ${Math.round(h * 0.7)} 2-${Math.round(h * 0.75)} 1 ${h}z`
  }
  parts.push(`<path d="${tufts}" fill="url(#pds-blade)" stroke="#1d3318" stroke-width="0.8" stroke-linejoin="round"/>`)
  const flowers: [number, number][][] = [[], [], []]
  for (let i = 0; i < Math.round(12 * across); i++) {
    const x = hash(i + 707) * VIEW_W
    if (Math.abs(x - sx(LAUNCHER_X)) < 30) continue
    flowers[i % 3]!.push([Math.round(x), Math.round(top - 3 - hash(i + 717) * 4)])
  }
  ;['#ffd166', '#ff9ccf', '#c6b2ff'].forEach((c, i) => parts.push(`<path d="${dots(flowers[i]!)}" stroke="${c}" stroke-width="3.4" stroke-linecap="round"/>`))
  // The launcher's post and fork, in a shadow of its own: lit from the left,
  // bound with leather at its tips and its middle.
  const fork = `M${n(sx(LAUNCHER_X))} ${n(sy(0))}V${n(sy(1.4))}M${n(sx(LAUNCHER_X))} ${n(sy(1.4))}L${n(sx(TIP_L.x))} ${n(sy(TIP_L.y))}M${n(sx(LAUNCHER_X + 0.05))} ${n(sy(1.4))}L${n(sx(TIP_R.x))} ${n(sy(TIP_R.y))}`
  const lx = sx(LAUNCHER_X)
  parts.push(
    `<ellipse cx="${n(lx + 4)}" cy="${n(top + 2)}" rx="26" ry="6" fill="url(#pd-shadow)"/>`,
    `<path d="${fork}" stroke="#1c1108" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    `<path d="${fork}" stroke="url(#pds-post)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    `<path d="M${n(lx - 2)} ${n(sy(0.1))}V${n(sy(1.3))}M${n(sx(TIP_L.x) + 1.5)} ${n(sy(TIP_L.y) + 4)}L${n(lx - 1)} ${n(sy(1.4) - 2)}" stroke="#e0ad78" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`,
    `<path d="M${n(lx - 6)} ${n(sy(0.55))}h12M${n(lx - 6)} ${n(sy(0.55) + 5)}h12" stroke="#3b2414" stroke-width="3" stroke-linecap="round"/>`,
    ...[TIP_L, TIP_R].map(
      t =>
        `<circle cx="${n(sx(t.x))}" cy="${n(sy(t.y) + 6)}" r="5" fill="#5a3a1f" stroke="#1c1108" stroke-width="2"/><circle cx="${n(sx(t.x) - 1.4)}" cy="${n(sy(t.y) + 4.6)}" r="1.6" fill="#a8774a"/>`,
    ),
  )
  // Darker toward the corners, as a lens sees a night.
  parts.push(`<rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#pds-vignette)"/>`)
  scenery = withPaints(parts.join(''))

  return scenery
}

// ---------------------------------------------------------------------------
// Blocks and bugs

/** How knocked about a block looks: 0, 1 or 2 stages of its own kind of damage (cracks, splits, dents). */
export function crackLevel(b: Body): number {
  const worn = b.wear / b.strength
  if (!Number.isFinite(worn) || worn < 0.25) return 0

  return worn > 0.6 ? 2 : 1
}

/** How eaten away a block looks, by acid or by melting: 0, 1 or 2 stages of pits. What fire took shows as char instead. */
export function eatenLevel(b: Body): number {
  const eaten = b.decay - b.char
  if (!(eaten >= 0.12)) return 0

  return eaten >= 0.4 ? 2 : 1
}

/** A crack's wandering line from an edge of a w by h block toward its middle, the same for the same seed. */
function crackPath(seed: number, w: number, h: number): string {
  let x = (hash(seed) - 0.5) * w
  let y = -h / 2
  if (hash(seed + 1) > 0.5) {
    x = -w / 2
    y = (hash(seed + 2) - 0.5) * h
  }
  let d = `M${n(x)} ${n(y)}`
  for (let i = 0; i < 4; i++) {
    x += (-x * 0.35 + (hash(seed + 3 + i) - 0.5) * w * 0.5) * 0.9
    y += (-y * 0.35 + (hash(seed + 9 + i) - 0.5) * h * 0.5) * 0.9 + h * 0.08
    d += `L${n(x)} ${n(y)}`
  }

  return d
}

/** A point inside a w by h block, `pad` in from its edges, the same for the same seed. */
function spotIn(seed: number, w: number, h: number, pad: number): [number, number] {
  return [(hash(seed) - 0.5) * Math.max(0, w - 2 * pad), (hash(seed + 1) - 0.5) * Math.max(0, h - 2 * pad)]
}

/** Dots, as one path: round-capped steps of next to nothing. */
function dots(pts: [number, number][]): string {
  return pts.map(([x, y]) => `M${n(x)} ${n(y)}h.01`).join('')
}

function stroke(d: string, color: string, width: number, extra = ''): string {
  return `<path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"${extra}/>`
}

/**
 * A block's two stages of knocks, in its frame, each its material's own: wood
 * splits along its grain then splinters, stone cracks, concrete cracks in
 * branches then spalls to show the steel bars inside, glass stars then webs,
 * and steel dents then buckles.
 */
function damageMarks(b: Body): [string, string] {
  const w = b.hw * 2 * S
  const h = b.hh * 2 * S
  const x0 = -w / 2
  const y0 = -h / 2
  const seed = b.id * 7
  switch (b.mat) {
    case 'wood': {
      const long = w >= h
      const split = (k: number) => {
        const s = seed + k * 13
        const across = (hash(s) - 0.5) * 0.6
        const reach = 0.45 + hash(s + 1) * 0.3
        let d = ''
        for (let i = 0; i <= 4; i++) {
          const along = k ? 0.5 - (i / 4) * reach : (i / 4) * reach - 0.5
          const wob = (hash(s + 2 + i) - 0.5) * 2.4
          d += `${i ? 'L' : 'M'}${n(long ? along * w : across * w + wob)} ${n(long ? across * h + wob : along * h)}`
        }

        return d
      }
      const notch = long
        ? `M${n(w * 0.12)} ${n(y0)}L${n(w * 0.2)} ${n(y0 + h * 0.4)}L${n(w * 0.3)} ${n(y0)}Z`
        : `M${n(x0)} ${n(h * 0.1)}L${n(x0 + w * 0.4)} ${n(h * 0.18)}L${n(x0)} ${n(h * 0.28)}Z`

      return [stroke(split(0), '#2b1a0b', 1.8), stroke(split(1), '#2b1a0b', 1.8) + `<path d="${notch}" fill="#3a2412" stroke="#2b1a0b" stroke-width="1"/>`]
    }
    case 'glass': {
      const [cx, cy] = spotIn(seed, w, h, 4)
      const inside = (v: number, size: number) => Math.max(-size / 2 + 1, Math.min(size / 2 - 1, v))
      const len = Math.max(w, h) * 0.45
      const rays = (from: number, count: number, reach: number) => {
        let d = ''
        for (let i = 0; i < count; i++) {
          const ang = ((i + hash(seed + from + i) * 0.6) / count) * Math.PI * 2
          const r = reach * (0.5 + hash(seed + from + 20 + i) * 0.7)
          d += `M${n(cx)} ${n(cy)}L${n(inside(cx + Math.cos(ang) * r, w))} ${n(inside(cy + Math.sin(ang) * r, h))}`
        }

        return d
      }
      let web = ''
      for (let i = 0; i <= 6; i++) {
        const ang = (i / 6) * Math.PI * 2
        web += `${i ? 'L' : 'M'}${n(inside(cx + Math.cos(ang) * len * 0.3, w))} ${n(inside(cy + Math.sin(ang) * len * 0.3, h))}`
      }

      return [stroke(rays(0, 5, len), '#ffffff', 1.2, ' opacity="0.9"'), stroke(rays(40, 4, len * 1.3) + web, '#ffffff', 1, ' opacity="0.75"')]
    }
    case 'concrete': {
      const cw = Math.min(w * 0.4, 18)
      const ch = Math.min(h * 0.45, 14)
      const right = hash(seed + 5) > 0.5
      const sx = right ? -x0 : x0
      const dir = right ? -1 : 1
      const sy = -y0
      const spall = `M${n(sx)} ${n(sy - ch)}L${n(sx + dir * cw * 0.5)} ${n(sy - ch * 0.9)}L${n(sx + dir * cw)} ${n(sy - ch * 0.3)}L${n(sx + dir * cw * 0.8)} ${n(sy)}L${n(sx)} ${n(sy)}Z`
      const bar = `M${n(sx + dir * cw * 0.85)} ${n(sy - ch * 0.5)}L${n(sx)} ${n(sy - ch * 0.5)}`

      return [
        stroke(crackPath(seed, w, h), '#4a463f', 2) + stroke(crackPath(seed + 5, w * 0.6, h * 0.6), '#4a463f', 1.3),
        stroke(crackPath(seed + 13, w, h), '#4a463f', 2) +
          `<path d="${spall}" fill="#8c867b" stroke="#5f5a52" stroke-width="1" stroke-linejoin="round"/>` +
          stroke(bar, '#9a5b33', 2.4) +
          stroke(bar, '#d0946a', 0.8),
      ]
    }
    case 'metal': {
      const r = Math.max(3, Math.min(9, Math.min(w, h) * 0.3))
      // A dent: shadowed at its upper left, lit at its lower right, its floor a little darker than the plate.
      const dent = (s: number, rx: number) => {
        const [cx, cy] = spotIn(s, w, h, rx + 2)
        const ry = rx * 0.7
        const oval = (dx: number, dy: number, k: number, fill: string, opacity: number) =>
          `<ellipse cx="${n(cx + dx * rx)}" cy="${n(cy + dy * ry)}" rx="${n(rx * k)}" ry="${n(ry * k)}" fill="${fill}" opacity="${opacity}"/>`

        return oval(0, 0, 1, '#3f4d5c', 0.55) + oval(0.14, 0.2, 0.84, '#dfe8f1', 0.7) + oval(-0.06, -0.06, 0.74, '#7d91a5', 1)
      }
      const crease = w >= h ? `M${n(x0 + w * 0.3)} ${n(y0 + 2)}L${n(x0 + w * 0.45)} ${n(-y0 - 2)}` : `M${n(x0 + w * 0.1)} ${n(y0 + h * 0.3)}L${n(-x0 - w * 0.12)} ${n(y0 + h * 0.42)}`

      return [dent(seed, r), dent(seed + 9, r * 0.8) + stroke(crease, '#26303b', 1.6) + `<g transform="translate(1 1)">${stroke(crease, '#e6eef7', 0.9, ' opacity="0.6"')}</g>`]
    }
    default:
      return [stroke(crackPath(seed, w, h), '#33373d', 1.6, ' opacity="0.85"'), stroke(crackPath(seed + 13, w, h), '#33373d', 1.6, ' opacity="0.85"')]
  }
}

/** How each material's pits look: the shadow round each, the lit lip at its foot, its depth, and what runs from it (steel's rust). */
const PITS: Record<string, { rim: string; lip: string; core: string; run: string }> = {
  wood: { rim: '#6e4a26', lip: '#d09a5e', core: '#1d1209', run: '' },
  stone: { rim: '#6a6f77', lip: '#c3c8cf', core: '#2f3237', run: '' },
  concrete: { rim: '#86806f', lip: '#dcd7cc', core: '#3f3b35', run: '' },
  glass: { rim: '#e8f8ff', lip: '#ffffff', core: '#ffffff', run: '' },
  metal: { rim: '#b45f22', lip: '#e39257', core: '#40200c', run: '#9b4a1a' },
}

/** A block's two stages of being eaten away, in its frame: pits, then more and a ragged bite out of its top. */
function eatenMarks(b: Body): [string, string] {
  const w = b.hw * 2 * S
  const h = b.hh * 2 * S
  const x0 = -w / 2
  const y0 = -h / 2
  const look = PITS[b.mat] ?? PITS.stone!
  const r = Math.max(2, Math.min(6, Math.min(w, h) * 0.22))
  // Each pit a hole: its shadow, a lit lip at its foot, and its dark depth; every other one smaller.
  const pits = (from: number, count: number, size: number) => {
    let out = ''
    for (const k of [1, 0.7]) {
      const pts: [number, number][] = []
      for (let i = k === 1 ? 0 : 1; i < count; i += 2) pts.push(spotIn(b.id * 11 + from + i * 3, w, h, size))
      if (pts.length === 0) continue
      const z = size * k
      out +=
        `<path d="${dots(pts)}" stroke="${look.rim}" stroke-width="${n(z * 2)}" stroke-linecap="round" opacity="0.85"/>` +
        `<path d="${dots(pts.map(([x, y]) => [x, y + z * 0.35]))}" stroke="${look.lip}" stroke-width="${n(z * 1.2)}" stroke-linecap="round" opacity="0.6"/>` +
        `<path d="${dots(pts.map(([x, y]) => [x, y - z * 0.12]))}" stroke="${look.core}" stroke-width="${n(z * 1.15)}" stroke-linecap="round"/>`
    }

    return out
  }
  let runs = ''
  if (look.run) {
    for (let i = 0; i < 3; i++) {
      const [x, y] = spotIn(b.id * 11 + i * 3, w, h, r)
      const len = Math.min(10, h / 2 - y - r)
      if (len > 1) runs += `M${n(x)} ${n(y + r)}v${n(len)}`
    }
  }
  const xa = x0 + w * (0.2 + hash(b.id * 11 + 90) * 0.3)
  const span = w * 0.3
  const depth = Math.min(h * 0.35, 9)
  let bite = `M${n(xa)} ${n(y0)}`
  for (let i = 1; i < 5; i++) bite += `L${n(xa + (span * i) / 5)} ${n(y0 + depth * (0.5 + hash(b.id * 11 + 91 + i) * 0.5))}`
  bite += `L${n(xa + span)} ${n(y0)}Z`

  return [pits(0, 3, r) + (runs ? stroke(runs, look.run, 1.4, ' opacity="0.75"') : ''), pits(50, 4, r * 1.3) + `<path d="${bite}" fill="${look.core}" opacity="0.85"/>`]
}

/** What a block shows of the knocks it took and what has eaten it, up to the stages given. */
function blockMarks(b: Body, cracked: number, eaten: number): string {
  return eatenMarks(b).slice(0, eaten).join('') + damageMarks(b).slice(0, cracked).join('')
}

function drawBlock(b: Body): string {
  return `<g transform="${place(b.x, b.y, b.a)}">${blockLook(b, blockMarks(b, crackLevel(b), eatenLevel(b)))}${atWork(b)}`
}

/**
 * Closes a body's turned group with what is at work on it, and draws what
 * stays upright round it.
 */
function atWork(b: Body): string {
  const code = elementCode(b)
  if (!code) return '</g>'
  const l = elementLayers(b, code)

  return `${l.turned}</g>${l.near ? `<g transform="translate(${n(sx(b.x))} ${n(sy(b.y))})">${l.near}</g>` : ''}`
}

/**
 * A block in its own frame (pixels, y down), with `marks` (its damage) drawn
 * over it: its material's paint, lit from the upper left, the grain or
 * courses or rivets of it, and its edges caught by the light, lit along its
 * top and left and shaded along its foot and right.
 */
function blockLook(b: Body, marks: string): string {
  const w = b.hw * 2 * S
  const h = b.hh * 2 * S
  const x0 = -w / 2
  const y0 = -h / 2
  const rect = (fill: string, edge: string) =>
    `<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(h)}" rx="3" fill="${fill}" stroke="${edge}" stroke-width="2.6"/>`
  const bevel = (paint = 'pd-bevel') =>
    w > 7 && h > 7 ? `<rect x="${n(x0 + 2.1)}" y="${n(y0 + 2.1)}" width="${n(w - 4.2)}" height="${n(h - 4.2)}" rx="1.5" fill="none" stroke="url(#${paint})" stroke-width="1.7"/>` : ''
  const long = w >= h
  let body = ''
  if (b.mat === 'wood') {
    body += rect('url(#pd-wood)', '#3a2412')
    // Grain along the long side, a knot on big pieces, and a pair of nails at each end of a long one.
    let grain = ''
    for (const t of [-0.28, 0.06, 0.3]) {
      grain += long
        ? `M${n(x0 + 4)} ${n(h * t)}Q${n(0)} ${n(h * t + 2)} ${n(-x0 - 4)} ${n(h * t - 1)}`
        : `M${n(w * t)} ${n(y0 + 4)}Q${n(w * t + 2)} ${n(0)} ${n(w * t - 1)} ${n(-y0 - 4)}`
    }
    body += `<path d="${grain}" stroke="#7a4d24" stroke-width="1.3" fill="none" opacity="0.6"/>`
    if (w * h > 900) body += `<ellipse cx="${n(w * 0.18)}" cy="${n(h * 0.12)}" rx="3.2" ry="2.1" fill="#8a5a2c" stroke="#5c3a1c" stroke-width="1.2"/>`
    if (Math.max(w, h) > 70 && Math.min(w, h) > 9) {
      const e = Math.max(w, h) / 2 - 6
      const s = Math.min(w, h) * 0.22
      const nails: [number, number][] = long
        ? [[-e, -s], [-e, s], [e, -s], [e, s]]
        : [[-s, -e], [s, -e], [-s, e], [s, e]]
      body += `<path d="${dots(nails)}" stroke="#3b2a1a" stroke-width="2.6" stroke-linecap="round"/><path d="${dots(nails.map(([x, y]) => [x - 0.4, y - 0.4]))}" stroke="#d9b48a" stroke-width="0.9" stroke-linecap="round"/>`
    }
    body += bevel()
  } else if (b.mat === 'stone') {
    body += rect('url(#pd-stone)', '#2c3036')
    // Mortar: courses and staggered joints, each stone's foot lit just under its line.
    let mortar = ''
    const course = 18
    const rows = Math.max(1, Math.round(h / course))
    for (let r = 1; r < rows; r++) mortar += `M${n(x0 + 2)} ${n(y0 + (r * h) / rows)}H${n(-x0 - 2)}`
    for (let r = 0; r < rows; r++) {
      const ya = y0 + (r * h) / rows
      const yb = y0 + ((r + 1) * h) / rows
      for (let x = x0 + (r % 2 ? 14 : 26); x < -x0 - 6; x += 28) mortar += `M${n(x)} ${n(ya + 1)}V${n(yb - 1)}`
    }
    if (mortar) body += `<path d="${mortar}" stroke="#d7dbe2" stroke-width="1" fill="none" opacity="0.45" transform="translate(1 1.3)"/><path d="${mortar}" stroke="#555b64" stroke-width="1.5" fill="none"/>`
    body += bevel()
  } else if (b.mat === 'concrete') {
    body += rect('url(#pd-concrete)', '#4a463f')
    // Cast in one piece: grit through it, and the holes its form was tied with on big pieces.
    const dark: [number, number][] = []
    const light: [number, number][] = []
    const count = Math.min(14, Math.max(4, Math.round((w * h) / 140)))
    for (let i = 0; i < count; i++) (i % 3 ? dark : light).push(spotIn(b.id * 31 + i * 2, w, h, 4))
    body += `<path d="${dots(dark)}" stroke="#827c71" stroke-width="2" stroke-linecap="round"/><path d="${dots(light)}" stroke="#e2ddd2" stroke-width="1.6" stroke-linecap="round"/>`
    if (w * h > 1100) {
      const ties: [number, number][] = long ? [[-w * 0.28, 0], [w * 0.28, 0]] : [[0, -h * 0.28], [0, h * 0.28]]
      body += `<path d="${dots(ties)}" stroke="#57524a" stroke-width="3.2" stroke-linecap="round"/><path d="${dots(ties.map(([x, y]) => [x + 0.5, y + 0.7]))}" stroke="#e8e3d8" stroke-width="1" stroke-linecap="round" opacity="0.6"/>`
    }
    body += bevel()
  } else if (b.mat === 'metal') {
    body += rect('url(#pd-metal)', '#232b35')
    // Brushed along its length, a seam on long plates, a rivet at each corner, lit on its upper left.
    let brush = ''
    for (const t of [-0.3, -0.1, 0.12, 0.32]) brush += long ? `M${n(x0 + 3)} ${n(h * t)}H${n(-x0 - 3)}` : `M${n(w * t)} ${n(y0 + 3)}V${n(-y0 - 3)}`
    body += `<path d="${brush}" stroke="#dfe8f2" stroke-width="0.8" opacity="0.22"/>`
    const k = Math.min(w, h)
    if (long && w > 80) body += `<path d="M0 ${n(y0 + 2)}V${n(-y0 - 2)}" stroke="#3d4a58" stroke-width="1.2"/><path d="M1.2 ${n(y0 + 2)}V${n(-y0 - 2)}" stroke="#e6eef7" stroke-width="0.7" opacity="0.5"/>`
    const inset = Math.max(3, Math.min(5, k * 0.25))
    const corners: [number, number][] = [
      [x0 + inset, y0 + inset],
      [-x0 - inset, y0 + inset],
      [x0 + inset, -y0 - inset],
      [-x0 - inset, -y0 - inset],
    ]
    body += `<path d="${dots(corners)}" stroke="#2a333e" stroke-width="3.4" stroke-linecap="round"/><path d="${dots(corners.map(([x, y]) => [x - 0.6, y - 0.6]))}" stroke="#f4f8fc" stroke-width="1.2" stroke-linecap="round"/>`
    body += bevel('pd-sheen')
  } else {
    body += rect('url(#pd-glass)', '#1f5a78')
    body += `<rect x="${n(x0 + 2.5)}" y="${n(y0 + 2.5)}" width="${n(w - 5)}" height="${n(h - 5)}" rx="1.5" fill="none" stroke="#e4f8ff" stroke-width="1.2" opacity="0.7"/>`
    // Two streaks of shine, and a glint at its corner.
    const k = Math.min(w, h)
    body += `<path d="M${n(x0 + k * 0.25)} ${n(-y0 - 3)}L${n(x0 + k * 0.75)} ${n(y0 + 3)}M${n(x0 + k * 0.55)} ${n(-y0 - 3)}L${n(x0 + k * 0.85)} ${n(y0 + k * 0.5)}" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.55"/>`
    body += `<path d="M${n(x0 + 4.5)} ${n(y0 + 4.5)}h.01" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>`
  }

  return body + marks
}

function drawBug(b: Body, look: { x: number; y: number } | null): string {
  return `<g transform="${place(b.x, b.y, b.a)}">${bugLook(b, look)}${atWork(b)}`
}

/** The soft shadow at a bug's feet, round its center (pixels): it stands on whatever it stands on. */
const BUG_SHADOW = '<ellipse cy="15.5" rx="17" ry="4.2" fill="url(#pd-shadow)"/>'

function bugShadow(b: Body): string {
  return `<g transform="translate(${n(sx(b.x))} ${n(sy(b.y))})">${BUG_SHADOW}</g>`
}

/**
 * Everything of a bug but where it looks, defined once a picture for every
 * bug to use: a round purple beetle, its shell lit from the upper left and
 * glossy, its antennae glowing at their tips, blushing under big eyes.
 */
const BUG_DEF =
  `<g id="pd-bug">` +
  `<path d="${[-11, -3, 6].map(x => `M${x} 9l-3 7M${x + 6} 9l3 7`).join('')}" stroke="#2e1236" stroke-width="2.8" stroke-linecap="round"/>` +
  `<path d="M-6 -12Q-10 -21 -15 -20M6 -12Q10 -21 15 -20" stroke="#4a1f55" stroke-width="2" fill="none" stroke-linecap="round"/>` +
  `<g fill="url(#pg-ffd166)"><circle cx="-15" cy="-20" r="7"/><circle cx="15" cy="-20" r="7"/></g>` +
  `<g fill="#ffe08a" stroke="#2e1236" stroke-width="1.2"><circle cx="-15" cy="-20" r="2.6"/><circle cx="15" cy="-20" r="2.6"/></g>` +
  `<ellipse cx="0" cy="1" rx="17.5" ry="14" fill="url(#pd-shell)" stroke="#2e1236" stroke-width="2.8"/>` +
  `<path d="M-12 7Q0 13 12 7" stroke="#6d2382" stroke-width="1.6" fill="none"/>` +
  `<g fill="#86289f" opacity="0.75"><circle cx="-9" cy="7" r="2.4"/><circle cx="10" cy="6" r="2"/><circle cx="1" cy="10" r="1.6"/></g>` +
  `<g fill="#ff8fd8" opacity="0.45"><ellipse cx="-12.5" cy="2.6" rx="3" ry="1.7"/><ellipse cx="12.5" cy="2.6" rx="3" ry="1.7"/></g>` +
  `<ellipse cx="-10" cy="-8" rx="4.6" ry="2.2" fill="#ffffff" opacity="0.4" transform="rotate(-35 -10 -8)"/><circle cx="-14" cy="-3" r="1.2" fill="#ffffff" opacity="0.7"/>` +
  `<g fill="url(#pd-eye)" stroke="#2e1236" stroke-width="1.6"><circle cx="-6" cy="-4" r="5.4"/><circle cx="6" cy="-4" r="5.4"/></g></g>`

/** The bug drawing's definition, for a picture with bugs in it. */
function bugDefs(any: boolean): string {
  return any ? `<defs>${BUG_DEF}</defs>` : ''
}

function bugLook(b: Body, look: { x: number; y: number } | null): string {
  const c = Math.cos(b.a)
  const s = Math.sin(b.a)
  // Where to look, in the bug's own frame, y down.
  let ex = -1
  let ey = 0
  if (look) {
    const dx = look.x - b.x
    const dy = look.y - b.y
    const d = Math.hypot(dx, dy) || 1
    ex = (c * dx + s * dy) / d
    ey = -(-s * dx + c * dy) / d
  }
  // Each pupil with the moon caught in it.
  const pupil = (x: number) => `<circle cx="${n(x + ex * 2.3)}" cy="${n(-4 + ey * 2.3)}" r="2.6"/>`
  const glint = (x: number) => `<circle cx="${n(x + ex * 2.3 - 0.9)}" cy="${n(-5 + ey * 2.3)}" r="0.9"/>`
  // Alive: a slow breath, and a blink every few seconds, each bug at its own pace.
  // Periods in tenths, the same written as reckoned with, so frames agree on where each loop is.
  const breath = tenths(1.5 + hash(b.id * 7 + 1) * 0.7)
  const blink = tenths(2.8 + hash(b.id * 7 + 2) * 2.4)

  return (
    `<g><animateTransform attributeName="transform" type="scale" values="1 1;1.04 0.96;1 1" dur="${n(breath)}s" begin="${loop(breath, b.id * 0.37)}" repeatCount="indefinite"/>` +
    `<use href="#pd-bug"/><g fill="#1b0f22">${pupil(-6)}${pupil(6)}</g><g fill="#ffffff">${glint(-6)}${glint(6)}</g>` +
    `<g transform="translate(0 -4)"><g transform="scale(1 0)">` +
    `<animateTransform attributeName="transform" type="scale" values="1 0;1 0;1 1;1 0" keyTimes="0;0.9;0.95;1" dur="${n(blink)}s" begin="${loop(blink, b.id * 1.3)}" repeatCount="indefinite"/>` +
    `<g fill="#c45fdc" stroke="#2e1236" stroke-width="1.6"><ellipse cx="-6" cy="0" rx="6.3" ry="6.3"/><ellipse cx="6" cy="0" rx="6.3" ry="6.3"/></g></g></g></g>`
  )
}

/** A bug hopping for joy, out of the player's reach: its own rhythm, the clock's beat. */
function hopping(b: Body, inner: string): string {
  return (
    `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -14;0 0" keyTimes="0;0.45;1" calcMode="spline" keySplines="0.2 0.6 0.4 1;0.6 0 0.8 0.4" dur="0.6s" begin="${loop(0.6, b.id * 0.17)}" repeatCount="indefinite"/>` +
    `${inner}</g>`
  )
}

// ---------------------------------------------------------------------------
// Shots

/** The outline of a shape as an SVG element, in the body frame, pixels, y down. */
function outline(info: ShapeInfo, fill: string, stroke: string, extra = ''): string {
  if (info.shape === 'circle') {
    return `<circle cx="0" cy="0" r="${n(info.rad * S)}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${extra}/>`
  }
  let pts = ''
  for (let i = 0; i < info.verts.length; i += 2) pts += `${n(info.verts[i]! * S)},${n(-info.verts[i + 1]! * S)} `

  return `<polygon points="${pts.trim()}" fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"${extra}/>`
}

/** A shot's look: the Forge's art where there is one, its colored outline otherwise. */
function shotLook(spec: ShotSpec | null, info: ShapeInfo, color: number, scale: number, art: boolean): string {
  if (spec && spec.art && art) {
    const k = (S / 100) * scale
    const W = spec.width * 100
    const H = spec.height * 100

    return `<g transform="translate(${n(info.artX * S)} ${n(-info.artY * S)}) scale(${Math.round(k * 1000) / 1000}) translate(${n(-W / 2)} ${n(-H / 2)})">${spec.art}</g>`
  }
  const edge = hexColor(shade(color, 0.35))
  let look = outline(info, tinted('l', color), edge)
  if (info.shape === 'circle') {
    const r = info.rad * S
    look += `<path d="M${n(-r * 0.8)} 0H${n(r * 0.8)}" stroke="${edge}" stroke-width="2" opacity="0.6"/>`
    look += `<circle cx="${n(-r * 0.35)}" cy="${n(-r * 0.35)}" r="${n(r * 0.28)}" fill="#ffffff" opacity="0.3"/>`
  } else {
    look += `<ellipse cx="${n(-info.hw * S * 0.3)}" cy="${n(-info.hh * S * 0.35)}" rx="${n(info.hw * S * 0.35)}" ry="${n(info.hh * S * 0.18)}" fill="#ffffff" opacity="0.25"/>`
  }

  return look
}

// ---------------------------------------------------------------------------
// What is at work on a body (engine's `elementCode`): char, a glow of heat,
// fire, a lit fuse, water, frost, a shock, acid. A tint over the body, turned with it, and a
// look round it that stays upright (flames rise whichever way it lies), each
// look defined once per picture for every body showing it to use.

/** The letters of `elementCode`, in the order they are drawn, bottom up. */
const ELEMENTS = 'chwiafzx'

/**
 * A tongue of fire: its light round it, breathing over `glow` seconds; its
 * three layers, red tips to a white-hot root, flickering through `flicker`'s
 * scales. Two of them, so fires side by side differ.
 */
function flame(id: string, glow: [string, number], flicker: [string, number], outer: string, middle: string, inner: string): string {
  return (
    `<g id="${id}"><ellipse cx="0" cy="-36" rx="72" ry="68" fill="url(#pg-ff8a3d)" opacity="0.8"><animate attributeName="opacity" values="${glow[0]}" dur="${glow[1]}s" repeatCount="indefinite"/></ellipse>` +
    `<g><animateTransform attributeName="transform" type="scale" values="${flicker[0]}" dur="${flicker[1]}s" repeatCount="indefinite"/>` +
    `<path d="${outer}" fill="url(#pd-flame)"/><path d="${middle}" fill="url(#pd-core)"/><path d="${inner}" fill="#fff6c8"/></g></g>`
  )
}

const ELEMENT_DEFS: Record<string, string> = {
  f:
    flame(
      'pd-fire2',
      ['0.95;0.6;0.95', 0.43],
      ['1 0.92;0.93 1.12;1.05 0.88;1 0.92', 0.37],
      'M-46 0Q-50 -46 -28 -58Q-28 -40 -12 -36Q-16 -64 6 -96Q14 -66 30 -60Q28 -74 42 -80Q54 -40 46 0Z',
      'M-30 0Q-32 -26 -16 -40Q-14 -26 -2 -22Q-2 -50 12 -66Q18 -42 28 -38Q36 -18 30 0Z',
      'M-14 0Q-16 -16 -2 -28Q4 -14 10 -32Q18 -16 14 0Z',
    ) +
    flame(
      'pd-fire',
      ['0.6;1;0.6', 0.5],
      ['1 1;1.06 0.84;0.94 1.1;1 1', 0.42],
      'M-48 0Q-54 -40 -22 -62Q-26 -38 -8 -30Q-10 -70 12 -100Q16 -60 34 -52Q30 -66 40 -72Q58 -36 48 0Z',
      'M-32 0Q-34 -30 -14 -46Q-14 -28 -2 -24Q0 -54 14 -72Q16 -40 30 -34Q38 -18 32 0Z',
      'M-16 0Q-18 -18 -4 -30Q2 -16 8 -36Q20 -18 16 0Z',
    ),
  x: `<g id="pd-fuse"><circle r="56" fill="url(#pg-ff2a2a)" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="0.24s" repeatCount="indefinite"/></circle></g>`,
  z:
    `<g id="pd-zap"><animate attributeName="opacity" values="1;0.15;0.9;0" calcMode="discrete" dur="0.18s" repeatCount="indefinite"/>` +
    `<circle r="62" fill="url(#pg-fff36b)"/>` +
    `<g fill="none" stroke-linejoin="round" stroke-linecap="round"><polyline points="-50,-6 -30,12 -12,-14 6,10 24,-12 50,4" stroke="#fff36b" stroke-width="7"/>` +
    `<polyline points="-20,-48 -6,-20 -22,0 4,22 -8,48" stroke="#9ff6ff" stroke-width="5"/>` +
    `<path d="M-50 -6L-30 12L-12 -14L6 10L24 -12L50 4M-20 -48L-6 -20L-22 0L4 22L-8 48" stroke="#ffffff" stroke-width="2"/></g></g>`,
  a: `<g id="pd-bubbles">${[
    [-25, 7, 0.8, 0],
    [5, 5, 0.65, -0.3],
    [28, 6, 0.9, -0.5],
  ]
    .map(
      ([x, r, dur, begin]) =>
        `<circle cx="${x}" cy="0" r="${r! * 1.6}" fill="url(#pk-b6ff6a)" opacity="0"><animate attributeName="cy" values="0;-60" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
        `<animate attributeName="opacity" values="1;0" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`,
    )
    .join('')}</g>`,
  w:
    `<g id="pd-drip"><g opacity="0"><path d="M0 -6Q5 2 0 6Q-5 2 0 -6Z" fill="#7fd4ff"/><circle cx="-1.2" cy="1" r="1.1" fill="#ffffff" opacity="0.8"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 26" dur="0.7s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="1;0" dur="0.7s" repeatCount="indefinite"/></g></g>`,
}

/** The looks the letters in `codes` need, defined once. */
function elementDefs(codes: Iterable<string>): string {
  const used = new Set<string>()
  for (const c of codes) for (const ch of c) used.add(ch)
  const defs = [...ELEMENTS].filter(ch => used.has(ch) && ELEMENT_DEFS[ch]).map(ch => ELEMENT_DEFS[ch]).join('')

  return defs ? `<defs>${defs}</defs>` : ''
}

/** A body's own shape filled over, in its frame (a bug's round shell, else its outline). */
function overShape(b: Body, fill: string, opacity: number, stroke = 'none'): string {
  const extra = ` opacity="${opacity}"`
  if (b.kind === 'bug') return `<ellipse cx="0" cy="1" rx="17.5" ry="14" fill="${fill}" stroke="${stroke}" stroke-width="2.5"${extra}/>`

  return outline(b, fill, stroke, extra)
}

/**
 * What `letter` looks like on `b`: `turned`, in the body's frame, turned with
 * it; `near`, round its center, upright.
 */
function elementLayer(b: Body, letter: string): { turned: string; near: string } {
  const reach = Math.min(b.r, 1.4)
  const low = Math.min(b.hh, b.hw, b.r)
  const use = (id: string, transform: string) => `<use href="#${id}" transform="${transform}"/>`
  switch (letter) {
    case 'c':
      // Blackened, the more the more it burnt; soot streaks on the worst.
      return {
        turned:
          overShape(b, '#160b04', Math.round((0.18 + 0.5 * b.char) * 100) / 100) +
          (b.char > 0.45 && b.kind === 'block'
            ? `<path d="M${n(-b.hw * S * 0.6)} ${n(-b.hh * S * 0.3)}l${n(b.hw * S * 0.35)} ${n(b.hh * S * 0.5)}M${n(b.hw * S * 0.1)} ${n(-b.hh * S * 0.5)}l${n(b.hw * S * 0.3)} ${n(b.hh * S * 0.7)}" stroke="#000000" stroke-width="2" stroke-linecap="round" opacity="0.35"/>`
            : ''),
        near: '',
      }
    case 'h':
      // Glowing hot: red at its edges, orange to yellow at its heart, breathing; its outline lit.
      return {
        turned:
          `<g>${overShape(b, 'url(#pd-heat)', 0.9)}<animate attributeName="opacity" values="0.6;1;0.6" dur="0.9s" repeatCount="indefinite"/></g>` +
          overShape(b, 'none', 0.85, '#ffb03a'),
        near: '',
      }
    case 'f':
      return {
        turned: overShape(b, '#1a0d05', 0.15),
        near: use(b.id % 2 ? 'pd-fire2' : 'pd-fire', `translate(0 ${n(low * 0.4 * S)}) scale(${n((reach * 0.75 * S) / 50)} ${n(((reach * 0.6 + 0.4) * 1.2 * S) / 100)})`),
      }
    case 'x':
      return { turned: '', near: use('pd-fuse', `scale(${n(((Math.min(b.r, 1.6) + 0.2) * S) / 50)})`) }
    case 'w':
      return { turned: overShape(b, '#3fa7ff', 0.3), near: use('pd-drip', `translate(0 ${n(low * S)})`) }
    case 'i':
      return {
        turned:
          overShape(b, 'url(#pd-ice)', 0.9, '#ffffff') +
          `<path d="M-6 0H6M0 -6V6M-4 -4L4 4M-4 4L4 -4" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/>`,
        near: '',
      }
    case 'z':
      return { turned: overShape(b, '#fff36b', 0.25), near: use('pd-zap', `scale(${n(((reach + 0.15) * S) / 50)})`) }
    case 'a':
      return { turned: overShape(b, '#8cff3a', 0.3), near: use('pd-bubbles', `scale(${n((Math.min(b.r, 1.2) * S) / 50)})`) }
    default:
      return { turned: '', near: '' }
  }
}

/** Everything in `code` at work on `b` at once, for a still frame. */
function elementLayers(b: Body, code: string): { turned: string; near: string } {
  let turned = ''
  let near = ''
  for (const ch of ELEMENTS) {
    if (!code.includes(ch)) continue
    const l = elementLayer(b, ch)
    turned += l.turned
    near += l.near
  }

  return { turned, near }
}

/** The stretches of ticks a letter is on in a per-tick list of codes: first tick, and the first it is off (-1: to the end). */
function spans(states: string[], letter: string): { from: number; until: number }[] {
  const out: { from: number; until: number }[] = []
  let start = -1
  states.forEach((s, i) => {
    const on = s.includes(letter)
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      out.push({ from: start, until: i })
      start = -1
    }
  })
  if (start >= 0) out.push({ from: start, until: -1 })

  return out
}

/** How much wider than the shot the light of an ability ready to fire reaches: soft, it fades out to its edge. */
const READY = 1.5

/** A power's flash: a fifth of a second, a little wider than the shot. */
const FLASH_TICKS = 5
function flashRadius(b: Body): number {
  return Math.min(b.r, 1) * 0.7 + 0.25
}

function drawShot(g: Game, b: Body, art: boolean, ready: boolean): string {
  let out = ''
  const speed = Math.hypot(b.vx, b.vy)
  // A piercing shot at speed leaves streaks behind it.
  if (b.spec?.traits.includes('piercing') && speed > 4) {
    const ux = b.vx / speed
    const uy = b.vy / speed
    let d = ''
    for (const o of [-0.25, 0, 0.25]) {
      const x = b.x - uy * o
      const y = b.y + ux * o
      d += `M${n(sx(x - ux * 0.4))} ${n(sy(y - uy * 0.4))}L${n(sx(x - ux * 1.6))} ${n(sy(y - uy * 1.6))}`
    }
    out += `<path d="${d}" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.45"/>`
  }
  // A magnet's field, pulsing.
  if (b.spec?.traits.includes('magnetic') && g.phase === 'flying') {
    const pulse = (g.frame % 12) / 12
    for (const k of [0, 0.5]) {
      const r = (b.r + 0.6 + ((pulse + k) % 1) * 2.4) * S
      out += `<circle cx="${n(sx(b.x))}" cy="${n(sy(b.y))}" r="${n(r)}" fill="none" stroke="#7fb2ff" stroke-width="2" stroke-dasharray="6 7" opacity="${n(0.5 * (1 - ((pulse + k) % 1)))}"/>`
    }
  }
  // Its power just went off: a flash round it.
  const since = b.powerAt >= 0 ? g.frame - b.powerAt : Infinity
  if (since < FLASH_TICKS) {
    const k = since / FLASH_TICKS
    out += `<circle cx="${n(sx(b.x))}" cy="${n(sy(b.y))}" r="${n((flashRadius(b) + 0.5 * k) * S)}" fill="#ffffff" opacity="${n(0.7 * (1 - k))}"/>`
  }
  // Ready to fire its ability: a beat of light around it.
  if (ready) {
    const glow = 0.6 + 0.35 * Math.sin(g.frame * 0.6)
    out += `<circle cx="${n(sx(b.x))}" cy="${n(sy(b.y))}" r="${n((b.r + 0.25) * S * READY)}" fill="url(#pg-ffd166)" opacity="${n(glow)}"/>`
  }
  out += `<g transform="${place(b.x, b.y, b.a)}">${shotLook(b.spec, b, b.color, b.scale, art && !b.shard)}${atWork(b)}`

  return out
}

// ---------------------------------------------------------------------------
// Rounds a shooting power fires

/** The five points of a star, outer radius 8. */
const STAR = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 ? 3.4 : 8
  const a = (i * Math.PI) / 5 - Math.PI / 2

  return `${n(Math.cos(a) * r)},${n(Math.sin(a) * r)}`
}).join(' ')
const ZAG = 'M-24 0L-15 -8L-7 4L1 -7L10 0'

const CONFETTI = ['#ffd166', '#ff6b6b', '#7ee787', '#5fb8ff', '#c6a8ff', '#ff8a3d']

/**
 * A level won, `e` seconds ago: confetti falling and swaying, spinning as it
 * goes, for as long as the win shows; while its words are up, three stars
 * popping out round them, one over them and one at either end.
 */
function celebration(e: number, words: string | null): string {
  let out = ''
  for (let i = 0; i < 36; i++) {
    const x = hash(i * 3 + 5000) * VIEW_W
    const dur = 2.6 + hash(i * 3 + 5001) * 1.8
    const sway = (hash(i * 3 + 5002) - 0.5) * 90
    const w = 6 + hash(i + 5100) * 5
    const t = (e + hash(i + 5300) * dur) % dur
    out +=
      `<g transform="translate(${n(x)} -20)"><animateTransform attributeName="transform" type="translate" values="${n(x)} -20;${n(x + sway)} ${n(VIEW_H * 0.55)};${n(x - sway * 0.4)} ${n(VIEW_H + 20)}" dur="${n(dur)}s" begin="${-Math.round(t * 1000) / 1000}s" repeatCount="indefinite"/>` +
      `<rect x="${n(-w / 2)}" y="${n(-w / 4)}" width="${n(w)}" height="${n(w / 2)}" rx="1" fill="${CONFETTI[i % CONFETTI.length]}">` +
      `<animateTransform attributeName="transform" type="rotate" values="0;360" dur="${n(0.7 + hash(i + 5200) * 0.9)}s" repeatCount="indefinite"/></rect></g>`
  }
  if (!words) return out
  // Where the banner stands and how wide it runs, as wordsMarkup sets it.
  const k = view.k
  const size = Math.min(30 * k, (VIEW_W - 40 * k) / (words.length * 0.56))
  const base = Math.max(sy(9.4), 34 * k + size * 1.4)
  const half = textWidth(words, size) / 2
  out += `<ellipse cx="${n(VIEW_W / 2)}" cy="${n(base - size * 0.4)}" rx="${n(half + 90 * k)}" ry="${n(size * 1.7)}" fill="url(#pg-ffd166)" opacity="0.5"><animate attributeName="opacity" values="0.35;0.6;0.35" dur="1.6s" repeatCount="indefinite"/></ellipse>`
  ;[-1, 0, 1].forEach((side, i) => {
    const x = VIEW_W / 2 + side * (half + 26 * k)
    const y = side === 0 ? base - size * 1.45 : base - size * 0.36
    const scale = (side === 0 ? 2.6 : 2.1) * k
    out +=
      `<g transform="translate(${n(x)} ${n(y)})"><g transform="scale(0)">` +
      `<animateTransform attributeName="transform" type="scale" values="0;${n(scale * 1.3)};${n(scale)}" keyTimes="0;0.6;1" dur="0.5s" begin="${since(e, 0.15 * i)}" fill="freeze"/>` +
      `<polygon points="${STAR}" fill="#ffd166" stroke="#7a4a00" stroke-width="0.9" stroke-linejoin="round"/></g></g>`
  })

  return out
}

/** A stock round drawn around 0,0 in picture units, pointing along +x. */
function stockLook(ammo: Ammo, color: number): string {
  const c = hexColor(color)
  switch (ammo) {
    case 'bullet':
      return `<path d="M-26 0H-4" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity="0.5"/><rect x="-7" y="-3" width="15" height="6" rx="3" fill="${c}" stroke="#2b1d08" stroke-width="1.2"/>`
    case 'laser':
      return `<path d="M-30 0H6" stroke="${c}" stroke-width="7" stroke-linecap="round" opacity="0.45"/><path d="M-28 0H4" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>`
    case 'water':
      return `<circle r="5.5" fill="${c}"/><circle cx="-1.8" cy="-1.8" r="1.7" fill="#ffffff" opacity="0.7"/>`
    case 'fire':
      return `<circle r="15" fill="${tinted('k', color)}"/>`
    case 'spike':
      return `<path d="M13 0L-13 -3L-10 0L-13 3Z" fill="${c}" stroke="#1b1b2b" stroke-width="1.2" stroke-linejoin="round"/>`
    case 'ball':
      return `<circle r="8" fill="${tinted('l', color)}" stroke="#1b1b2b" stroke-width="1.8"/><circle cx="-2.8" cy="-2.8" r="1.8" fill="#ffffff" opacity="0.7"/>`
    case 'note':
      return `<ellipse cx="-3" cy="5" rx="5" ry="3.6" transform="rotate(-20 -3 5)" fill="${c}" stroke="#1b1b2b" stroke-width="1"/><path d="M1.6 4V-11L9 -7" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    case 'star':
      return `<polygon points="${STAR}" fill="${c}" stroke="#ffffff" stroke-width="1" stroke-linejoin="round"/>`
    case 'bubble':
      return `<circle r="9" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="1.8"/><path d="M-5 -3A6 6 0 0 1 -1 -6.4" stroke="#ffffff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
    case 'gas':
      return `<g fill="${tinted('s', color)}" opacity="0.55"><circle r="17"/><circle cx="10" cy="-7" r="13"/><circle cx="-10" cy="6" r="14"/></g>`
    case 'zap':
      return `<path d="${ZAG}" stroke="${c}" stroke-width="6" fill="none" stroke-linejoin="round" stroke-linecap="round" opacity="0.55"/><path d="${ZAG}" stroke="#ffffff" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`
  }
}

/** How much bigger than life a round is drawn: a small one at least half a meter long, to be seen. */
function roundZoom(r: Round): number {
  return Math.max(1, 0.45 / Math.max(r.width, r.height, 0.01))
}

/** The ids of the rounds' own drawings in one picture, by drawing. */
type RoundIds = Map<string, string>

/** Each drawing among `rounds` defined once, centered on 0,0 at its drawn size, for each round to use. */
function roundDefs(rounds: Round[]): { defs: string; ids: RoundIds } {
  const ids: RoundIds = new Map()
  let defs = ''
  for (const r of rounds) {
    if (!r.art || ids.has(r.art)) continue
    const id = `pd-round-${ids.size}`
    ids.set(r.art, id)
    const k = (S / 100) * roundZoom(r)
    defs += `<g id="${id}" transform="scale(${n(k)}) translate(${n(-r.width * 50)} ${n(-r.height * 50)})">${r.art}</g>`
  }

  return { defs: defs ? `<defs>${defs}</defs>` : '', ids }
}

/** A round around 0,0, pointing along +x: the Forge's drawing of it, a stock one, or a plain shape in its color. */
function roundLook(r: Round, color: number, ids: RoundIds): string {
  const id = r.art ? ids.get(r.art) : undefined
  if (id) return `<use href="#${id}"/>`
  const c = hexColor(color)
  if (r.look) return stockLook(r.look, color)
  const z = roundZoom(r) * S
  const w = r.width * z
  const h = r.height * z

  return `<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(w, h) / 2)}" fill="${c}" stroke="#1b1b2b" stroke-width="1.2"/>`
}

/** The streak a round leaves, along -x from 0,0: as long as a twentieth of a second of its flight. */
function trailLook(r: Round): string {
  if (!r.trail) return ''
  const len = Math.min(70, r.speed * 0.05 * S)
  const w = Math.max(2, Math.min(10, Math.max(r.width, r.height) * roundZoom(r) * S * 0.5))

  return [0.55, 0.3, 0.12]
    .map((o, i) => `<path d="M${n((-len * i) / 3)} 0H${n((-len * (i + 1)) / 3)}" stroke="${r.trail}" stroke-width="${n(w * (1 - i * 0.25))}" stroke-linecap="round" opacity="${o}"/>`)
    .join('')
}

/** The way a round heads on the picture, in degrees. */
export function heading(vx: number, vy: number): number {
  return (-Math.atan2(vy, vx) * 180) / Math.PI
}

/** A round as it is now, for a still frame. */
function drawPellet(p: Pellet, ids: RoundIds): string {
  const r = p.round
  const t = Math.min(1, p.age / r.life)
  const head = heading(p.vx, p.vy)
  const deg = r.turn === 'point' ? head : r.turn === 'spin' ? (p.age * 600) % 360 : 0
  const puff = r.fade ? ` scale(${n(1 + 1.2 * t)})` : ''
  const fade = r.fade ? ` opacity="${n(1 - t * t)}"` : ''
  const at = `translate(${n(sx(p.x))} ${n(sy(p.y))})`
  const trail = r.trail ? `<g transform="${at} rotate(${n(head)})">${trailLook(r)}</g>` : ''

  return `${trail}<g transform="${at} rotate(${n(deg)})${puff}"${fade}>${roundLook(r, p.color, ids)}</g>`
}

// ---------------------------------------------------------------------------
// Particles, blasts, points won and the shot's path, as they are at a moment

/** How far through its life a particle is, 0 to 1. */
function aged(p: Particle): number {
  return Math.max(0, Math.min(1, 1 - p.life / p.max))
}

/** How much wider than its size a puff of smoke is drawn: soft, it fades out toward its edge. */
const SOFT = 1.4
/** How much wider a spark is drawn: a hot point in its own glow. */
const GLOW = 2.3

/** A particle around 0,0 as it looks `k` of the way through its life, `spun` degrees round. */
function particleLook(p: Particle, k: number, spun: number): string {
  if (p.kind === 'smoke') return `<circle r="${n(p.size * S * 0.5 * SOFT * (1 + 1.2 * k))}" fill="${tinted('s', p.color)}" opacity="${n(0.5 * (1 - k))}"/>`
  if (p.kind === 'chunk') {
    const w = p.size * S
    const h = w * 0.6

    return `<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" rx="1" fill="${hexColor(p.color)}" stroke="#1b1b2b" stroke-width="0.8" transform="rotate(${n(spun)})" opacity="${n(Math.min(1, (1 - k) * 4))}"/>`
  }
  const r = Math.max(1.1, p.size * S * 0.6 * (1 - 0.4 * k))

  return `<circle r="${n(r * GLOW)}" fill="${tinted('k', p.color)}" opacity="${n(Math.min(1, (1 - k) * 2.2))}"/>`
}

function drawParticle(p: Particle): string {
  const age = p.max - p.life

  return `<g transform="translate(${n(sx(p.x))} ${n(sy(p.y))})">${particleLook(p, aged(p), (-p.spin * age * 180) / Math.PI)}</g>`
}

/** Points won, outlined dark so they read on anything. */
function scoreText(text: string, color: number): string {
  return `<text text-anchor="middle" font-size="21" stroke="#1b1030" stroke-width="4.5" stroke-linejoin="round" paint-order="stroke" font-weight="800" fill="${hexColor(color)}">${esc(text)}</text>`
}

/** How far a blast's light reaches, and how much wider than its lobes its fireball is drawn (soft, it fades out at its edge). */
const LIGHT = 2.4
const BALL = 1.3

/**
 * A fireball's lobes: five blobs round a bright core, each from its first
 * radius to its last over the blast, as fractions of the blast's radius.
 */
const LOBES: [number, number, number, number][] = [0, 1, 2, 3, 4].map(i => {
  const a = (i * 2 * Math.PI) / 5 + 0.4

  return [Math.cos(a) * 0.28, Math.sin(a) * 0.24 - 0.05, 0.22 + (i % 2) * 0.06, 0.42 + (i % 3) * 0.06]
})

/** A blast and points won as they are `t` seconds in, for a still frame. */
function drawEffectNow(fx: Effect): string {
  const cx = n(sx(fx.x))
  const cy = n(sy(fx.y))
  const k = Math.min(1, fx.t / fx.life)
  if (fx.kind === 'blast') {
    const R = fx.r * S
    const hold = k < 0.35 ? 0.9 - (0.2 * k) / 0.35 : (0.7 * (1 - k)) / 0.65
    // Its light thrown wide round it, the fireball's lobes, and its white-hot heart.
    let out = `<circle cx="${cx}" cy="${cy}" r="${n(R * LIGHT)}" fill="url(#pg-ff9a3a)" opacity="${n(Math.max(0, 1 - k * 1.4))}"/>`
    out += `<g transform="translate(${cx} ${cy})" opacity="${n(hold)}">`
    for (const [dx, dy, r0, r1] of LOBES) out += `<circle cx="${n(dx * R * (1 + k))}" cy="${n(dy * R * (1 + k))}" r="${n(R * (r0 + (r1 - r0) * k) * BALL)}" fill="url(#pd-fireball)"/>`
    out += `<circle r="${n(R * (0.3 + 0.2 * k) * BALL)}" fill="url(#pd-fireball)"/><circle r="${n(R * (0.16 + 0.1 * k))}" fill="#fff1a8" opacity="${n(Math.max(0, 1 - k * 1.8))}"/></g>`
    if (fx.t < 0.14) out += `<circle cx="${cx}" cy="${cy}" r="${n(R * 0.45)}" fill="#ffffff" opacity="${n(0.9 * (1 - fx.t / 0.14))}"/>`

    return out
  }
  if (fx.kind === 'score') {
    const fade = k < 0.6 ? 1 : (1 - k) / 0.4

    return `<g transform="translate(${cx} ${n(sy(fx.y) - 48 * k)})" opacity="${n(fade)}">${scoreText(fx.text ?? '', fx.color)}</g>`
  }

  return ''
}

/** The shot's path: a dot every other tick, big and small by turns, as it flew. */
function pathDot(i: number, x: number, y: number, opacity = 0.75): string {
  return `<circle cx="${n(sx(x))}" cy="${n(sy(y))}" r="${i % 4 === 0 ? 4 : 2.6}" fill="#ffffff" opacity="${opacity}"/>`
}

/** The last shot's path; between shots dimmed, so the next one's aim reads over it. */
function drawPath(g: Game): string {
  const opacity = g.phase === 'flying' ? 0.75 : 0.35
  let out = ''
  for (let i = 2; i < g.path.length; i += 2) out += pathDot(i, g.path[i]!.x, g.path[i]!.y, opacity)

  return out
}

// ---------------------------------------------------------------------------
// The frame

/**
 * `arc`: draw the aim's arc here. On the desktop the game module draws it
 * under the pointer instead, as the frames trail the pointer. `from`: where
 * the pouch was in the frame before, for the sling to glide from it to where
 * it is now over `glide` ms, so frames a pane draws ten times a second move
 * it smoothly.
 */
type Detail = { art: number; particles: boolean; arc: boolean; from: { x: number; y: number } | null; glide: number }

/** The band across an empty launcher, drawn once a view. */
let emptyBand = ''
function drawEmptyBand(): string {
  const d = `M${n(sx(TIP_L.x))} ${n(sy(TIP_L.y))}Q${n(sx(LAUNCHER_X))} ${n(sy(TIP_L.y - 0.25))} ${n(sx(TIP_R.x))} ${n(sy(TIP_R.y))}`
  emptyBand ||=
    `<path d="${d}" stroke="#1c1108" stroke-width="7" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#e8b67a" stroke-width="4" fill="none" stroke-linecap="round"/>` +
    `<path d="${d}" stroke="#ffe7c2" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.55" transform="translate(0 -1)"/>`

  return emptyBand
}

/** How wide a run of text is drawn, near enough, at this size: what lays the words out. */
const textWidth = (text: string, size: number) => text.length * size * 0.56

/**
 * The bar along the top: level, shots, bugs, score, laid out left to right
 * at the view's size of type. On a narrow picture the name goes first, then
 * the best score, then the level's title, to keep the rest on one line.
 */
export function hudMarkup(g: Game): string {
  const k = view.k
  const bugs = bugsLeft(g)
  const best = Math.max(g.best, g.score)
  const gap = 26 * k
  const shotsW = (50 + g.maxShots * 15) * k
  const bugsW = textWidth(`Bugs ${bugs}`, 15 * k)
  let level = `Level ${g.level}: ${g.title}`
  let withBest = true
  const scoreW = () => textWidth(withBest ? `Score ${g.score}  Best ${best}` : `Score ${g.score}`, 15 * k)
  const room = () => VIEW_W - 28 * k - textWidth(level, 15 * k) - shotsW - bugsW - scoreW() - 2 * gap
  const brandW = textWidth('PROMPT & DESTROY', 16 * k) + 16 * k + gap
  const brand = room() >= brandW
  if (!brand && room() < 0) withBest = false
  if (!brand && room() < 0) level = `Level ${g.level}`

  const y = n(23 * k)
  let x = 14 * k
  // A dark glass bar, ruled underneath in the game's fire; the name lit in it.
  let out = `<rect x="0" y="0" width="${VIEW_W}" height="${n(34 * k)}" fill="url(#pd-bar)"/><rect x="0" y="${n(34 * k)}" width="${VIEW_W}" height="${n(2 * k)}" fill="url(#pd-rule)"/>`
  if (brand) {
    out += `<text x="${n(x)}" y="${y}" font-size="${n(16 * k)}" font-weight="800" fill="url(#pd-brand)" letter-spacing="1">PROMPT &amp; DESTROY</text>`
    x += brandW
  }
  out += `<text x="${n(x)}" y="${y}" font-size="${n(15 * k)}" fill="#e6ecff">${esc(level)}</text>`
  x += textWidth(level, 15 * k) + gap
  out += `<text x="${n(x)}" y="${y}" font-size="${n(13 * k)}" fill="#9aa5c4">Shots</text>`
  for (let i = 0; i < g.maxShots; i++) {
    const cx = n(x + (50 + i * 15) * k)
    out +=
      i < g.shots
        ? `<circle cx="${cx}" cy="${n(17 * k)}" r="${n(5.5 * k)}" fill="url(#pd-coin)" stroke="#7a4a00" stroke-width="${n(1.2 * k)}"/>`
        : `<circle cx="${cx}" cy="${n(17 * k)}" r="${n(5 * k)}" fill="#ffd166" fill-opacity="0.08" stroke="#ffd166" stroke-width="${n(1.5 * k)}" stroke-opacity="0.45"/>`
  }
  x += shotsW
  out += `<text x="${n(x)}" y="${y}" font-size="${n(15 * k)}" fill="#e6ecff">Bugs <tspan fill="#d68ae6" font-weight="700">${bugs}</tspan></text>`
  out +=
    `<text x="${n(VIEW_W - 14 * k)}" y="${y}" font-size="${n(15 * k)}" fill="#e6ecff" text-anchor="end">Score <tspan font-weight="700">${g.score}</tspan>` +
    (withBest ? `  <tspan fill="#9aa5c4">Best ${best}</tspan>` : '') +
    `</text>`

  return out
}

function frame(g: Game, detail: Detail): string {
  // The sky's drifting and twinkling over the backdrop, then everything else.
  const parts: string[] = [ambience()]
  const pouch = pouchPosition(g)

  // The sling: drawn where the pouch is, gliding there from where it was.
  const from = detail.from && Math.hypot(detail.from.x - pouch.x, detail.from.y - pouch.y) > 0.01 ? detail.from : null
  const dur = `${detail.glide / 1000}s`
  const band = (tip: { x: number; y: number }, color: string) => {
    const to = `M${n(sx(tip.x))} ${n(sy(tip.y))}L${n(sx(pouch.x))} ${n(sy(pouch.y))}`
    const glide = from ? `<animate attributeName="d" from="M${n(sx(tip.x))} ${n(sy(tip.y))}L${n(sx(from.x))} ${n(sy(from.y))}" to="${to}" dur="${dur}" fill="freeze"/>` : ''

    return (
      `<path d="${to}" stroke="#1c1108" stroke-width="8" stroke-linecap="round">${glide}</path><path d="${to}" stroke="${color}" stroke-width="4.5" stroke-linecap="round">${glide}</path>` +
      `<path d="${to}" stroke="#ffe7c2" stroke-width="1.2" stroke-linecap="round" opacity="0.55" transform="translate(0 -1.2)">${glide}</path>`
    )
  }
  if (!g.loaded) parts.push(drawEmptyBand())
  else parts.push(band(TIP_L, '#b98448'))

  // What the bugs watch: the shot in flight, else the pouch.
  const flying = g.bodies.find(b => b.kind === 'shot' && !b.shard)
  const look = flying ? { x: flying.x, y: flying.y } : g.loaded ? pouch : null
  let artLeft = detail.art
  const ready = g.phase === 'flying' && !g.abilityUsed && g.activeAbility !== 'none'
  parts.push(elementDefs(g.bodies.map(elementCode)), bugDefs(g.bodies.some(b => b.kind === 'bug')))
  let shadows = ''
  for (const b of g.bodies) if (b.kind === 'block' || b.kind === 'shot') shadows += groundShadow(b, b.x, b.y, b.a)
  parts.push(shadows, drawPath(g))
  for (const b of g.bodies) {
    if (b.kind === 'ground') continue
    if (b.kind === 'block') parts.push(drawBlock(b))
    else if (b.kind === 'bug') parts.push(bugShadow(b), g.phase === 'lost' ? hopping(b, drawBug(b, look)) : drawBug(b, look))
    else {
      const art = artLeft > 0 && !!b.spec?.art
      if (art) artLeft--
      parts.push(drawShot(g, b, art, ready && b === flying))
    }
  }
  for (const j of g.joints) {
    const p = jointAnchor(j)
    parts.push(
      `<circle cx="${n(sx(p.x))}" cy="${n(sy(p.y))}" r="6" fill="#9be564" stroke="#4f8a2a" stroke-width="1.5"/>`,
      `<circle cx="${n(sx(p.x) + 3)}" cy="${n(sy(p.y) + 7)}" r="2.6" fill="#9be564"/>`,
    )
  }

  if (g.loaded) {
    const spec = g.loaded
    const info = shapeOf(spec)
    const color = visible(parseColor(spec.color))
    // The whole arc in bold dots, outlined against sky and towers alike,
    // fading a little toward a target ring where it first hits.
    const arc = detail.arc ? trajectory(g) : { points: [], hit: null }
    const count = arc.points.length
    arc.points.forEach((p, i) => {
      const t = count > 1 ? i / (count - 1) : 0
      parts.push(
        `<circle cx="${n(sx(p.x))}" cy="${n(sy(p.y))}" r="${n(5 - t * 2)}" fill="#ffffff" stroke="#0b1026" stroke-width="1.5" opacity="${n(0.95 - t * 0.4)}"/>`,
      )
    })
    if (arc.hit) {
      const hx = n(sx(arc.hit.x))
      const hy = n(sy(arc.hit.y))
      parts.push(
        `<circle cx="${hx}" cy="${hy}" r="13" fill="none" stroke="#0b1026" stroke-width="6" opacity="0.6"/>`,
        `<circle cx="${hx}" cy="${hy}" r="13" fill="none" stroke="#ff8a3d" stroke-width="3"/>`,
        `<path d="M${hx} ${n(sy(arc.hit.y) - 19)}v12M${hx} ${n(sy(arc.hit.y) + 7)}v12M${n(sx(arc.hit.x) - 19)} ${hy}h12M${n(sx(arc.hit.x) + 7)} ${hy}h12" stroke="#ff8a3d" stroke-width="3" stroke-linecap="round"/>`,
      )
    }
    // Just made: it springs out of the forge in a flash.
    const shown = (g.frame - g.loadedAt) * TICK_S
    const reveal = g.loadedAt >= 0 && shown < REVEAL_S ? revealMarkup(sx(pouch.x), sy(pouch.y), shown, Math.max(info.hw, info.hh) * S) : null
    // The leather pouch behind the shot, the front band over it.
    const offset = from ? `${n(sx(from.x) - sx(pouch.x))} ${n(sy(from.y) - sy(pouch.y))}` : ''
    parts.push(
      reveal?.back ?? '',
      `<g${from ? ` transform="translate(${offset})"` : ''}>` +
        (from ? `<animateTransform attributeName="transform" type="translate" from="${offset}" to="0 0" dur="${dur}" fill="freeze"/>` : '') +
        `<rect x="${n(sx(pouch.x) - 6)}" y="${n(sy(pouch.y) - 7)}" width="12" height="14" rx="3" fill="url(#pd-leather)" stroke="#1c1108" stroke-width="2"/>` +
        `<path d="M${n(sx(pouch.x) - 3)} ${n(sy(pouch.y) - 4.5)}v9M${n(sx(pouch.x) + 3)} ${n(sy(pouch.y) - 4.5)}v9" stroke="#d6a873" stroke-width="0.9" stroke-dasharray="1.6 1.4" opacity="0.8"/>` +
        `<g transform="${place(pouch.x, pouch.y, 0)}"><g>${reveal?.pop ?? ''}${shotLook(spec, info, color, 1, artLeft > 0)}</g></g></g>`,
      band(TIP_R, '#e8b67a'),
      reveal?.front ?? '',
    )
  }
  // The Forge at work: its circle over the pouch, timed from when the work began.
  if (g.forge.status === 'forging' && g.forgeSince >= 0 && (g.phase === 'waiting' || g.phase === 'aiming')) {
    parts.push(forgingMarkup(sx(pouch.x), sy(pouch.y), (g.frame - g.forgeSince) * TICK_S))
  }

  for (const fx of g.effects) {
    const life = Math.min(1, fx.t / fx.life)
    if (fx.kind === 'blast' || fx.kind === 'score') parts.push(drawEffectNow(fx))
    else if (fx.kind === 'ring') {
      parts.push(
        `<circle cx="${n(sx(fx.x))}" cy="${n(sy(fx.y))}" r="${n(fx.r * S * (0.25 + 0.75 * life))}" fill="none" stroke="${hexColor(fx.color)}" stroke-width="${n(2 + 7 * (1 - life))}" opacity="${n(1 - life)}"/>`,
      )
    } else {
      const fade = 1 - life
      parts.push(`<g opacity="${n(fade)}">${vortexArms(fx, fx.t * 7)}</g>`)
      parts.push(`<circle cx="${n(sx(fx.x))}" cy="${n(sy(fx.y))}" r="${n(14 + 6 * fade)}" fill="#05060f" opacity="${n(0.75 * fade)}"/>`)
    }
  }

  const rounds = roundDefs(g.pellets.map(p => p.round))
  parts.push(rounds.defs)
  for (const p of g.pellets) parts.push(drawPellet(p, rounds.ids))

  if (detail.particles) for (const p of g.particles) parts.push(drawParticle(p))

  if (g.phase === 'won' && g.endedAt >= 0) parts.push(celebration((g.frame - g.endedAt) * TICK_S, g.banner?.text ?? null))
  parts.push(hudMarkup(g), wordsMarkup(g, true))

  return svgDoc(withPaints(parts.join('')))
}

/** A whole document; `fill`ing its box, as one drawn in a frame of its own must. */
function svgDoc(body: string, fill = false): string {
  const size = fill ? 'width="100%" height="100%"' : `width="${VIEW_W}" height="${VIEW_H}"`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" ${size} font-family="${FONT}">${body}</svg>`
}

/** Three spiral arms of a vortex, turned by `turn` radians (the dark eye drawn apart). */
function vortexArms(fx: Effect, turn: number): string {
  let out = ''
  for (let arm = 0; arm < 3; arm++) {
    let d = ''
    for (let k = 0; k <= 24; k++) {
      const t = k / 24
      const ang = arm * ((Math.PI * 2) / 3) + t * 4.2 - turn
      const r = (0.2 + t * 0.8) * fx.r * S
      d += `${k ? 'L' : 'M'}${n(sx(fx.x) + Math.cos(ang) * r)} ${n(sy(fx.y) + Math.sin(ang) * r)}`
    }
    out += `<path d="${d}" stroke="${arm % 2 ? '#b69cff' : '#e6ecff'}" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.7"/>`
  }

  return out
}

/** The banner across the sky and the status line along the ground, each shrunk to fit if it must. */
/**
 * The words over the sky and the status line along the foot. `pop`: a banner
 * just gone up springs in, as far into that as it has been up (a still
 * frame's); a flight's recording keeps each banner's markup the same from
 * tick to tick, and springs it in where it shows (`layered`).
 */
export function wordsMarkup(g: Game, pop = false): string {
  const k = view.k
  let out = ''
  if (g.banner) {
    const size = Math.min(30 * k, (VIEW_W - 40 * k) / (g.banner.text.length * 0.56))
    // Over the level, where the world's own sky put it, under the bar along the top.
    const y = Math.max(sy(9.4), 34 * k + size * 1.4)
    const text = `<text x="${n(VIEW_W / 2)}" y="${n(y)}" font-size="${n(size)}" font-weight="800" text-anchor="middle" fill="url(#pd-gold)" stroke="#0b1026" stroke-width="${n(size / 4.5)}" stroke-linejoin="round" paint-order="stroke">${esc(g.banner.text)}</text>`
    const up = (g.frame - g.banner.from) * TICK_S
    out += pop && up < BANNER_POP_S ? popIn(text, `${-Math.round(up * 1000) / 1000}s`) : text
  }
  const st = statusLine(g, false)
  if (st.text && st.text !== g.banner?.text) {
    const size = Math.min(14 * k, (VIEW_W - 28 * k) / (st.text.length * 0.56))
    const bar = Math.max(26 * k, size * 1.9)
    out +=
      `<rect x="0" y="${n(VIEW_H - bar)}" width="${VIEW_W}" height="${n(bar)}" fill="url(#pd-bar)"/><rect x="0" y="${n(VIEW_H - bar)}" width="${VIEW_W}" height="${n(1.5 * k)}" fill="#e6ecff" opacity="0.14"/>` +
      `<text x="${n(14 * k)}" y="${n(VIEW_H - bar * 0.3)}" font-size="${n(size)}" fill="${st.color}">${esc(st.text)}</text>`
  }

  return out
}

/** The scenery that never moves (sky, hills, ground, the launcher's post), drawn once under the frames. */
export function backdrop(v: View = BASE_VIEW): string {
  useView(v)

  // Only what never moves: the backdrop is drawn once, and kept however long;
  // what drifts and twinkles goes in every frame, made fresh at the clock.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}">${stillScenery()}</svg>`
}

/**
 * What moves, drawn as one transparent SVG document to lie over the backdrop,
 * and what it shows in words. `arc`: false where the game module draws the
 * aim's arc itself.
 */
export function vector(
  g: Game,
  v: View = BASE_VIEW,
  arc = true,
  from: { x: number; y: number } | null = null,
  glide = 100,
): { svg: string; alt: string } {
  useView(v)
  // Each shot's art costs its length again; past the budget, fewer carry it.
  let svg = frame(g, { art: 8, particles: true, arc, from, glide })
  if (svg.length > BUDGET) svg = frame(g, { art: 2, particles: true, arc, from, glide })
  if (svg.length > BUDGET) svg = frame(g, { art: 0, particles: false, arc, from, glide })
  const st = statusLine(g, false)

  return {
    svg,
    alt: `Prompt & Destroy, level ${g.level}: ${g.title}. ${bugsLeft(g)} bugs left, ${g.shots} shots, score ${g.score}. ${st.text}`,
  }
}

// ---------------------------------------------------------------------------
// The Forge's emblem: an anvil with a glowing ingot on it, in the same bold
// cartoon style as the shots. At rest the ingot glows and an ember rises; at
// work the hammer swings down on it and every strike throws sparks.

/** The hammer's pivot, the end of its handle, and how far up it swings, at work and at rest. */
const PIVOT = '62 18'
const RAISED = 38
const RESTING = 24

/** The emblem's box: room over the anvil for the hammer raised. */
export const EMBLEM_BOX = { x: -2, y: -16, w: 68, h: 80 }

export function forgeEmblem(busy: boolean): string {
  const ink = 'stroke="#1b1b2b" stroke-width="2.2" stroke-linejoin="round"'
  const beat = busy ? '0.8s' : '1.8s'
  const glow = busy ? '0.55;1;0.55' : '0.45;0.8;0.45'
  let hammer =
    `<rect x="40" y="15.5" width="24" height="5" rx="2" fill="url(#pe-wood)" ${ink}/>` +
    `<rect x="29" y="9" width="13" height="17" rx="2" fill="url(#pe-steel)" ${ink}/>` +
    `<rect x="31" y="11" width="3" height="13" rx="1" fill="#ffffff" opacity="0.45"/>`
  let sparks = ''
  if (busy) {
    // Down on the ingot a third of the way through each beat, then up again.
    hammer = `<g transform="rotate(${RAISED} ${PIVOT})"><animateTransform attributeName="transform" type="rotate" values="${RAISED} ${PIVOT};0 ${PIVOT};${RAISED} ${PIVOT}" keyTimes="0;0.3;1" dur="${beat}" repeatCount="indefinite"/>${hammer}</g>`
    sparks = [
      [-17, -13, '#ffd166'],
      [-9, -20, '#ffffff'],
      [3, -22, '#ffe066'],
      [14, -15, '#ff8a3d'],
      [-21, -3, '#ff8a3d'],
      [19, -5, '#ffd166'],
    ]
      .map(
        ([dx, dy, c]) =>
          `<circle cx="36" cy="26" r="1.7" fill="${c}" opacity="0">` +
          `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dx} ${dy}" keyTimes="0;0.3;1" dur="${beat}" repeatCount="indefinite"/>` +
          `<animate attributeName="opacity" values="0;1;0" keyTimes="0;0.3;1" dur="${beat}" repeatCount="indefinite"/></circle>`,
      )
      .join('')
  } else {
    hammer = `<g transform="rotate(${RESTING} ${PIVOT})">${hammer}</g>`
    sparks = [
      [31, '0s'],
      [42, '-0.9s'],
    ]
      .map(
        ([x, begin]) =>
          `<circle cx="${x}" cy="24" r="1.3" fill="#ffd166" opacity="0">` +
          `<animateTransform attributeName="transform" type="translate" values="0 0;0 -18" dur="1.8s" begin="${begin}" repeatCount="indefinite"/>` +
          `<animate attributeName="opacity" values="0.9;0" dur="1.8s" begin="${begin}" repeatCount="indefinite"/></circle>`,
      )
      .join('')
  }
  const b = EMBLEM_BOX

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="100%" height="100%">` +
    // Iron lit from above, steel from the left, a wooden handle, and the ingot white-hot at its heart.
    `<defs>${radial('pe-glow', stop(0, '#ffc25a', 0.75) + stop(0.45, '#ff8a3d', 0.28) + stop(1, '#ff8a3d', 0))}` +
    linear('pe-iron', stop(0, '#c6ccd6') + stop(0.45, '#8a929e') + stop(1, '#555c68'), DOWN) +
    linear('pe-steel', stop(0, '#f2f5fa') + stop(0.5, '#b4bccb') + stop(1, '#7c8596'), '') +
    linear('pe-wood', stop(0, '#d49058') + stop(1, '#8a532c'), DOWN) +
    `${linear('pe-ingot', stop(0, '#fff6b0') + stop(0.5, '#ffb020') + stop(1, '#ff5a1a'), DOWN)}</defs>` +
    // The ingot's heat on the dark, brightest at its middle.
    `<g opacity="0.55"><animate attributeName="opacity" values="${glow}" dur="${beat}" repeatCount="indefinite"/>` +
    `<circle cx="36.5" cy="29" r="27" fill="url(#pe-glow)"/></g>` +
    `<path d="M3 35Q12 35 17 32H59V41H49L44 47V51L52 56V61H13V56L21 51V47L18 43Q8 41 3 35Z" fill="url(#pe-iron)" ${ink}/>` +
    `<path d="M18 34H57V36.5H18Z" fill="#ffffff" opacity="0.45"/>` +
    `<path d="M44 47V51L52 56V61H40Z" fill="#000000" opacity="0.22"/>` +
    `<rect x="25" y="26" width="23" height="6" rx="2" fill="url(#pe-ingot)" ${ink}/>` +
    `<rect x="27.5" y="27.3" width="12" height="1.8" rx="0.9" fill="#fffbe0" opacity="0.9"/>` +
    sparks +
    hammer +
    `</svg>`
  )
}

// ---------------------------------------------------------------------------
// The Forge at the sling: a forge circle over the pouch while it works, and
// the thing it made popping out of it in a flash when it is done. Each frame
// on the desktop is a new picture, whose animations would start over; so
// every animation here begins as long ago as the work or the reveal did, and
// a later frame takes it up exactly where the last left off.

/** `e` seconds ago, `at` seconds later, as a SMIL begin. */
function since(e: number, at = 0): string {
  return `${Math.round((at - e) * 1000) / 1000}s`
}

/** How long the reveal of a newly made thing lasts, in seconds. */
export const REVEAL_S = 1

/**
 * The forge circle round the pouch at x, y (pixels), `e` seconds into the
 * Forge's work: a molten core and its heat, two rune rings turning against
 * each other, sparks spiralling in, embers rising, and a white strike on
 * every beat, the beat the emblem's hammer keeps.
 */
export function forgingMarkup(x: number, y: number, e: number): string {
  const loop = (attr: string, values: string, dur: number, at = 0, extra = '') =>
    `<animate attributeName="${attr}" values="${values}" dur="${dur}s" begin="${since(e, at)}" repeatCount="indefinite"${extra}/>`
  const spin = (from: number, to: number, dur: number, at = 0) =>
    `<animateTransform attributeName="transform" type="rotate" from="${from}" to="${to}" dur="${dur}s" begin="${since(e, at)}" repeatCount="indefinite"/>`
  let out = `<g transform="translate(${n(x)} ${n(y)})">`
  out += `<circle r="58" fill="url(#pg-ff8a3d)" opacity="0.8">${loop('r', '50;66;50', 1.6)}</circle>`
  out += `<circle r="34" fill="url(#pg-ffc25a)">${loop('r', '28;38;28', 0.8)}</circle>`
  out += `<g>${spin(0, 360, 4)}<circle r="34" fill="none" stroke="#ffd166" stroke-width="2.4" stroke-dasharray="11 5 2 5" opacity="0.85"/></g>`
  let runes = ''
  for (let i = 0; i < 4; i++) runes += `<path d="M0 -51l4 6l-4 6l-4 -6z" fill="#ff8a3d" transform="rotate(${i * 90 + 45})"/>`
  out += `<g>${spin(0, -360, 7)}<circle r="45" fill="none" stroke="#ff8a3d" stroke-width="1.4" stroke-dasharray="2 8" opacity="0.75"/>${runes}</g>`
  // Sparks drawn in from all round, each swinging a little as it comes.
  for (let i = 0; i < 8; i++) {
    const at = i * 0.15
    const a = i * 45
    out +=
      `<g transform="rotate(${a})">${spin(a, a + 160, 1.2, at)}` +
      `<circle r="${i % 2 ? 2 : 2.8}" fill="${i % 2 ? '#fff1a8' : '#ffd166'}" opacity="0">` +
      `<animateTransform attributeName="transform" type="translate" values="60 0;8 0" dur="1.2s" begin="${since(e, at)}" repeatCount="indefinite"/>` +
      `${loop('opacity', '0;1;1;0', 1.2, at, ' keyTimes="0;0.2;0.8;1"')}</circle></g>`
  }
  for (let i = 0; i < 4; i++) {
    const at = i * 0.4
    out +=
      `<circle cx="${(i - 1.5) * 9}" r="1.8" fill="#ffb347" opacity="0">` +
      `<animateTransform attributeName="transform" type="translate" values="0 -6;${i % 2 ? 5 : -5} -48" dur="1.6s" begin="${since(e, at)}" repeatCount="indefinite"/>` +
      `${loop('opacity', '0;0.9;0', 1.6, at)}</circle>`
  }
  out += `<circle r="10" fill="#ff6a2a">${loop('r', '9;12;9', 0.8)}</circle><circle r="6" fill="#fff1a8">${loop('r', '5;7.5;5', 0.8)}</circle>`
  out +=
    `<circle r="10" fill="none" stroke="#ffffff" stroke-width="3" opacity="0">` +
    `${loop('r', '10;10;36', 0.8, 0, ' keyTimes="0;0.3;1"')}${loop('opacity', '0;0;0.9;0', 0.8, 0, ' keyTimes="0;0.29;0.3;1"')}</circle>`

  return out + '</g>'
}

/**
 * The reveal of a newly made thing at x, y (pixels), `e` seconds in, its
 * look `R` pixels across at most: `back`, a golden halo under it; `front`, a
 * white flash, a shockwave and a ring of sparks over it; `pop`, the
 * animation that springs the thing itself out of the forge's core.
 */
export function revealMarkup(x: number, y: number, e: number, R: number): { back: string; front: string; pop: string } {
  const once = (attr: string, values: string, dur: number, extra = '') =>
    `<animate attributeName="${attr}" values="${values}" dur="${dur}s" begin="${since(e)}" fill="freeze"${extra}/>`
  const at = `transform="translate(${n(x)} ${n(y)})"`
  const back = `<g ${at}><circle r="${n(R * 1.5 + 18)}" fill="url(#pg-ffd166)" opacity="0">${once('opacity', '1;0.45;0', 0.7)}${once('r', `${n(R * 1.5 + 6)};${n(R * 1.5 + 27)}`, 0.7)}</circle></g>`
  let front = `<g ${at}>`
  front += `<circle r="16" fill="#ffffff" opacity="0">${once('opacity', '0.95;0', 0.3)}${once('r', '16;60', 0.3)}</circle>`
  front += `<circle r="12" fill="none" stroke="#ffd166" stroke-width="5" opacity="0">${once('r', '12;78', 0.55)}${once('opacity', '1;0', 0.55)}${once('stroke-width', '5;1', 0.55)}</circle>`
  for (let i = 0; i < 12; i++) {
    const d = 46 + (i % 3) * 12
    front +=
      `<g transform="rotate(${i * 30 + (i % 2) * 12})"><circle r="${i % 2 ? 2 : 2.8}" fill="${i % 3 ? '#ffd166' : '#ffffff'}" opacity="0">` +
      `<animateTransform attributeName="transform" type="translate" values="10 0;${d} 0" dur="0.6s" begin="${since(e)}" fill="freeze"/>${once('opacity', '1;0', 0.6)}</circle></g>`
  }
  front += '</g>'
  const pop = `<animateTransform attributeName="transform" type="scale" values="0.15;1.18;0.94;1" keyTimes="0;0.45;0.75;1" dur="0.5s" begin="${since(e)}" fill="freeze"/>`

  return { back, front, pop }
}

// ---------------------------------------------------------------------------
// The aim's arc in cells, for the game module to draw under the pointer: the
// desktop holds back the pane's drawing while the pointer works over it, so
// an arc in the frames would trail the aim.
// Cells are 8.8 by 20 pixels and placed whole; a braille character's 2 by 4
// dots place a point within one, about 4 pixels apart each way.

/** One cell drawn over the picture: where it sits (row and column) and what it shows. */
export type AimCell = { row: number; col: number; text: string; color: string }

/** Braille dot bits by [column][dot row]. */
const BRAILLE = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]
/** How far down its cell, in pixels, each row of a braille glyph's dots sits. */
const DOT_Y = [4, 8, 12, 16]

/** Dots plotted in pixels over the picture, gathered into braille cells, a color to each. */
function dotPainter() {
  const cells = new Map<number, { row: number; col: number; bits: number; color: string }>()
  const set = (row: number, col: number, dx: number, dy: number, color: string) => {
    if (row < 0 || col < 0) return
    const key = row * 4096 + col
    const cell = cells.get(key) ?? { row, col, bits: 0, color }
    cell.bits |= BRAILLE[dx]![dy]!
    cell.color = color
    cells.set(key, cell)
  }
  const plot = (px: number, py: number, color: string) => {
    const col = Math.floor(px / CELL_W)
    const row = Math.floor(py / CELL_H)
    const dx = px - col * CELL_W < CELL_W / 2 ? 0 : 1
    const dy = Math.max(0, Math.min(3, Math.round((py - row * CELL_H - DOT_Y[0]!) / 4)))
    set(row, col, dx, dy, color)
  }

  return {
    plot,
    cells: (): AimCell[] => [...cells.values()].map(c => ({ row: c.row, col: c.col, text: String.fromCharCode(0x2800 + c.bits), color: c.color })),
  }
}

/** The aim's arc, with a target where it first hits, in cells over the picture of a pane `cols` by `rows`. */
export function aimCells(g: Game, cols: number, rows: number): AimCell[] {
  if (g.phase !== 'aiming' || !g.loaded) return []
  const { W, H, view: v } = pictureSize(cols, rows)
  const toPx = (x: number, y: number) => ({ px: ((x - v.x0) / (v.x1 - v.x0)) * W, py: ((v.y1 - y) / (v.y1 - v.y0)) * H })
  const paint = dotPainter()

  // Each point of the arc two dots, one above the other.
  const arc = trajectory(g)
  for (const pt of arc.points) {
    const p = toPx(pt.x, pt.y)
    paint.plot(p.px, p.py - 2, '#ffffff')
    paint.plot(p.px, p.py + 2, '#ffffff')
  }
  const out = paint.cells()
  if (arc.hit) {
    const p = toPx(arc.hit.x, arc.hit.y)
    out.push({ row: Math.floor(p.py / CELL_H), col: Math.floor(p.px / CELL_W), text: '◎', color: '#ff8a3d' })
  }

  return out
}

// ---------------------------------------------------------------------------
// A shot as one animation: its whole flight, recorded tick by tick
// (replay.ts), drawn once with SMIL and played by the surface at its own
// frame rate, nothing crossing to the hooks module until it lands.

/** One body over a recording: how it looks, and where it was each tick. */
export type Track = {
  body: Body
  /** The tick it appeared, and the tick it broke or left (-1: it lasted). */
  born: number
  died: number
  /** x, y and angle per tick from `born`, in world units. */
  poses: number[]
  /** The ticks it first showed each stage of its knocks, cracks or dents (-1: never). */
  cracked: [number, number]
  /** The ticks it first showed each stage of being eaten away (-1: never). */
  eaten: [number, number]
  /** The tick its power went off, flashing round it (-1: never). */
  flash: number
  /** What was at work on it each tick from `born` (engine's `elementCode`). */
  states: string[]
}

/** A round's flight: where it was each tick from the one it was fired. */
export type PelletTrack = { src: Pellet; round: Round; color: number; born: number; died: number; heading: number; poses: number[] }

/** A particle as it was the tick it appeared; the rest of its flight follows from that. */
export type Spark = Particle & { born: number }

export type Recording = {
  /** The ticks it spans after its first. */
  ticks: number
  tracks: Track[]
  pellets: PelletTrack[]
  sparks: Spark[]
  effects: { born: number; fx: Effect }[]
  /** The flung shot's path, each dot from the tick it was laid. */
  path: { x: number; y: number; born: number }[]
  /** Pins made: on which track, where in its frame (meters, y up), from which tick. */
  joints: { born: number; track: Track; x: number; y: number }[]
  /** Per tick: the HUD, the banner and status line, and the track glowing ready to fire its ability. */
  hud: string[]
  words: string[]
  ready: (Track | null)[]
  /** Where the bugs look. */
  look: { x: number; y: number } | null
}

/**
 * How much of a flight an animation draws: every `stride`th tick looked at
 * for keys, each drawn within `tol` pixels of where it was; at most so many
 * particles, Forge drawings and rounds.
 */
type AnimDetail = { stride: number; tol: number; sparks: number; art: number; pellets: number }

/** An animation past this many characters draws with less detail (a post holds 100,000). */
const ANIM_BUDGET = 92_000

const TICK_S = TICK_MS / 1000
/** Milliseconds of its first tick an animation starts past: its clock begins that far in. */
let skip = 0
const at = (tick: number) => `${Math.round(tick * TICK_MS - skip) / 1000}s`
const show = (tick: number) => `<set attributeName="visibility" to="visible" begin="${at(tick)}" fill="freeze"/>`
const hide = (tick: number) => `<set attributeName="visibility" to="hidden" begin="${at(tick)}" fill="freeze"/>`
/**
 * Gone from `tick` on, all of it: what is shown inside by `during` sets its
 * own visibility, which a hidden parent cannot override, so a body that
 * breaks takes no display with it, and leaves no crack or glow hanging.
 */
const gone = (tick: number) => `<set attributeName="display" to="none" begin="${at(tick)}" fill="freeze"/>`

/** `inner`, shown from tick `from` until tick `until` (-1: to the end). */
function during(from: number, until: number, inner: string): string {
  if (from <= 0 && until < 0) return inner

  return `<g${from > 0 ? ' visibility="hidden"' : ''}>${from > 0 ? show(from) : ''}${until >= 0 ? hide(until) : ''}${inner}</g>`
}

/** How long a banner takes to spring in. */
const BANNER_POP_S = 0.4

/** A banner's words springing in from small, around where they stand, beginning at `begin`. */
function popIn(text: string, begin: string): string {
  const m = /^<text x="([-\d.]+)" y="([-\d.]+)"/.exec(text)
  if (!m) return text

  return (
    `<g transform="translate(${m[1]} ${m[2]})"><g transform="scale(1)">` +
    `<animateTransform attributeName="transform" type="scale" values="0.4;1.15;0.95;1" keyTimes="0;0.55;0.8;1" dur="${BANNER_POP_S}s" begin="${begin}" fill="freeze"/>` +
    `${text.replace(/^<text x="[-\d.]+" y="[-\d.]+"/, '<text x="0" y="0"')}</g></g>`
  )
}

/** Whether an element of the words is a banner, which springs in. */
function isBanner(m: string): boolean {
  return m.startsWith('<text') && m.includes('font-weight="800" text-anchor="middle"')
}

/**
 * A per-tick list of flat markup (the bar along the top, the words) drawn
 * element by element: each distinct element once, shown for the ticks it is
 * in, so a score that changes redraws its number and not the whole bar.
 */
function layered(list: string[]): string {
  const ELEMENT = /<(\w+)\b[^>]*\/>|<(\w+)\b[^>]*>[\s\S]*?<\/\2>/g
  // Markup the split would not wholly account for is drawn whole, run by run.
  if (list.some(markup => (markup.match(ELEMENT) ?? []).join('') !== markup)) {
    return runs(list)
      .filter(r => r.value)
      .map(r => during(r.from, r.until, r.value))
      .join('')
  }
  const order: string[] = []
  const on = new Map<string, boolean[]>()
  list.forEach((markup, t) => {
    for (const m of markup.match(ELEMENT) ?? []) {
      let ticks = on.get(m)
      if (!ticks) {
        ticks = []
        on.set(m, ticks)
        order.push(m)
      }
      ticks[t] = true
    }
  })
  let out = ''
  for (const m of order) {
    const ticks = on.get(m)!
    let start = -1
    for (let t = 0; t <= list.length; t++) {
      const here = t < list.length && ticks[t] === true
      if (here && start < 0) start = t
      if (!here && start >= 0) {
        out += during(start, t === list.length ? -1 : t, isBanner(m) ? popIn(m, at(start)) : m)
        start = -1
      }
    }
  }

  return out
}

/** Runs of equal values in a per-tick list: each value, its first tick and the next run's (-1: the last). */
function runs<T>(list: T[]): { value: T; from: number; until: number }[] {
  const out: { value: T; from: number; until: number }[] = []
  list.forEach((value, t) => {
    const last = out[out.length - 1]
    if (last && last.value === value) return
    if (last) last.until = t
    out.push({ value, from: t, until: -1 })
  })

  return out
}

/** A fraction of an animation's span, as a key time: exact enough for a long flight's ticks. */
function frac(v: number): string {
  return String(Math.round(v * 10000) / 10000)
}

/**
 * The keys a motion needs, out of the samples at `ticks`: the first, the
 * last, and every one a straight line between its neighbouring keys would
 * miss by more than `tol` in any of its values (Ramer, Douglas and Peucker,
 * over time). A flight's arc keeps a key every few ticks, a body at rest or
 * turning steadily between knocks only its ends.
 */
function keysFor(ticks: number[], value: (i: number) => number[], tol: number): number[] {
  const keep = ticks.map((_, k) => k === 0 || k === ticks.length - 1)
  const spans: [number, number][] = [[0, ticks.length - 1]]
  while (spans.length > 0) {
    const [a, b] = spans.pop()!
    if (b - a < 2) continue
    const va = value(ticks[a]!)
    const vb = value(ticks[b]!)
    let worst = 0
    let at = -1
    for (let k = a + 1; k < b; k++) {
      const t = (ticks[k]! - ticks[a]!) / (ticks[b]! - ticks[a]!)
      const v = value(ticks[k]!)
      for (let c = 0; c < v.length; c++) {
        const miss = Math.abs(v[c]! - (va[c]! + (vb[c]! - va[c]!) * t))
        if (miss > worst) {
          worst = miss
          at = k
        }
      }
    }
    if (worst > tol) {
      keep[at] = true
      spans.push([a, at], [at, b])
    }
  }

  return ticks.filter((_, k) => keep[k])
}

/**
 * A motion keyed at `keys` (ticks, from `from` to `from + span`): its values
 * and, unless the keys are evenly spaced, the time of each.
 */
function keyed(keys: number[], from: number, span: number, value: (i: number) => string): string {
  const step = keys.length > 1 ? keys[1]! - keys[0]! : 0
  const even = keys.every((t, k) => t === keys[0]! + k * step)

  return `values="${keys.map(value).join(';')}" ${even ? '' : `keyTimes="${keys.map(t => frac((t - from) / span)).join(';')}" `}`
}

/** At most this many stretches of each element are drawn on one body. */
const MAX_SPANS = 8

/**
 * The stretch of a track where it moves: from the pose before it first moved
 * to the one it came to rest at (null: it never moved). Most of a tower
 * stands still.
 */
function motion(tr: Track): { from: number; last: number } | null {
  const p = tr.poses
  const count = p.length / 3
  const same = (i: number, j: number) =>
    Math.abs(sx(p[3 * i]!) - sx(p[3 * j]!)) < 0.05 && Math.abs(sy(p[3 * i + 1]!) - sy(p[3 * j + 1]!)) < 0.05 && Math.abs(((p[3 * i + 2]! - p[3 * j + 2]!) * 180) / Math.PI) < 0.05
  let first = -1
  for (let i = 1; i < count; i++) {
    if (!same(i, 0)) {
      first = i
      break
    }
  }
  if (first <= 0) return null
  let last = count - 1
  while (last > first && same(last - 1, count - 1)) last--

  return { from: first - 1, last }
}

/**
 * The soft shadow on the ground under a body standing on it, at a pose
 * (meters, radians); '' when it is off the ground.
 */
function groundShadow(b: Body, x: number, y: number, a: number): string {
  let lo = y - b.r
  let left = x - b.r
  let right = x + b.r
  if (b.shape !== 'circle') {
    const c = Math.cos(a)
    const s = Math.sin(a)
    lo = Infinity
    left = Infinity
    right = -Infinity
    for (let i = 0; i < b.verts.length; i += 2) {
      const vx = x + c * b.verts[i]! - s * b.verts[i + 1]!
      const vy = y + s * b.verts[i]! + c * b.verts[i + 1]!
      lo = Math.min(lo, vy)
      left = Math.min(left, vx)
      right = Math.max(right, vx)
    }
  }
  if (lo > 0.12) return ''

  return `<ellipse cx="${n(sx((left + right) / 2))}" cy="${n(sy(0) + 1.5)}" rx="${n(((right - left) * S) / 2 + 7)}" ry="5.5" fill="url(#pd-shadow)"/>`
}

/**
 * A track's shadows on the ground: where it stood, until it moves off, and
 * where it comes to rest, from then on; each gone with the body.
 */
function trackShadow(tr: Track): string {
  const b = tr.body
  if (b.kind === 'bug') return ''
  const p = tr.poses
  const last = p.length / 3 - 1
  const end = tr.died >= 0 ? gone(tr.died) : ''
  const span = motion(tr)
  const start = groundShadow(b, p[0]!, p[1]!, p[2]!)
  // Each in a group of its own: what hides it must hide nothing else.
  if (!span) return start ? `<g${tr.born > 0 ? ' visibility="hidden"' : ''}>${tr.born > 0 ? show(tr.born) : ''}${end}${start}</g>` : ''
  let out = ''
  if (start && tr.born === 0) out += `<g>${end}<animate attributeName="opacity" values="1;0" begin="${at(tr.born + span.from)}" dur="0.12s" fill="freeze"/>${start}</g>`
  const rest = groundShadow(b, p[3 * last]!, p[3 * last + 1]!, p[3 * last + 2]!)
  if (rest) out += `<g opacity="0">${end}<animate attributeName="opacity" values="0;1" begin="${at(tr.born + span.last)}" dur="0.2s" fill="freeze"/>${rest}</g>`

  return out
}

/** A body's track: placed at its first pose, then moved and turned through the rest. */
function trackMarkup(rec: Recording, tr: Track, detail: AnimDetail, art: boolean): string {
  const p = tr.poses
  const X = (i: number) => sx(p[3 * i]!)
  const Y = (i: number) => sy(p[3 * i + 1]!)
  const D = (i: number) => (-p[3 * i + 2]! * 180) / Math.PI
  let move = ''
  let turn = ''
  const moving = motion(tr)
  if (moving) {
    const { from, last } = moving
    const ticks: number[] = []
    for (let i = from; i < last; i += detail.stride) ticks.push(i)
    ticks.push(last)
    const span = last - from
    const begin = at(tr.born + from)
    const dur = `${Math.round(span * TICK_MS) / 1000}s`
    const moves = ticks.some(i => Math.abs(X(i) - X(from)) >= 0.05 || Math.abs(Y(i) - Y(from)) >= 0.05)
    const turns = ticks.some(i => Math.abs(D(i) - D(from)) >= 0.05)
    if (moves) {
      const keys = keysFor(ticks, i => [X(i), Y(i)], detail.tol)
      move = `<animateTransform attributeName="transform" type="translate" ${keyed(keys, from, span, i => `${n(X(i))} ${n(Y(i))}`)}begin="${begin}" dur="${dur}" fill="freeze"/>`
    }
    if (turns) {
      // As far round as moves its rim the same fraction of a pixel.
      const rim = Math.max(4, tr.body.r * S)
      const keys = keysFor(ticks, i => [D(i)], Math.min(3 * detail.tol, ((detail.tol * 1.3) / rim) * (180 / Math.PI)))
      turn = `<animateTransform attributeName="transform" type="rotate" ${keyed(keys, from, span, i => n(D(i)))}begin="${begin}" dur="${dur}" fill="freeze"/>`
    }
  }

  const b = tr.body
  let look = ''
  let near = ''
  if (b.kind === 'block') {
    // Each stage of its damage from the tick it reached it: pits under cracks.
    const pits = eatenMarks(b)
    const dents = damageMarks(b)
    look = blockLook(
      b,
      tr.eaten.map((t, k) => (t < 0 ? '' : during(t, -1, pits[k]!))).join('') + tr.cracked.map((t, k) => (t < 0 ? '' : during(t, -1, dents[k]!))).join(''),
    )
  } else if (b.kind === 'bug') {
    look = bugLook({ ...b, x: p[0]!, y: p[1]!, a: p[2]! }, rec.look)
    near += BUG_SHADOW
  } else {
    look = shotLook(b.spec, b, b.color, b.scale, art && !b.shard)
    for (const j of rec.joints) {
      if (j.track !== tr) continue
      const jx = j.x * S
      const jy = -j.y * S
      look += during(
        j.born,
        -1,
        `<circle cx="${n(jx)}" cy="${n(jy)}" r="6" fill="#9be564" stroke="#4f8a2a" stroke-width="1.5"/><circle cx="${n(jx + 3)}" cy="${n(jy + 7)}" r="2.6" fill="#9be564"/>`,
      )
    }
    // Unturned with the shot: a magnet's field, and the glow while its ability is ready.
    if (b.spec?.traits.includes('magnetic') && !b.shard) {
      const r0 = (b.r + 0.6) * S
      for (const delay of ['0s', '0.25s']) {
        near += `<circle r="${n(r0)}" fill="none" stroke="#7fb2ff" stroke-width="2" stroke-dasharray="6 7" opacity="0"><animate attributeName="r" values="${n(r0)};${n(r0 + 2.4 * S)}" dur="0.5s" begin="${delay}" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0" dur="0.5s" begin="${delay}" repeatCount="indefinite"/></circle>`
      }
    }
    if (tr.flash >= 0) {
      const r0 = flashRadius(b) * S
      const dur = `${(FLASH_TICKS * TICK_MS) / 1000}s`
      near +=
        `<circle r="${n(r0)}" fill="#ffffff" opacity="0">` +
        `<animate attributeName="opacity" values="0.7;0" begin="${at(tr.flash)}" dur="${dur}" fill="freeze"/>` +
        `<animate attributeName="r" values="${n(r0)};${n(r0 + 0.5 * S)}" begin="${at(tr.flash)}" dur="${dur}" fill="freeze"/></circle>`
    }
    for (const r of runs(rec.ready)) {
      if (r.value !== tr) continue
      near += during(
        r.from,
        r.until,
        `<circle r="${n((b.r + 0.25) * S * READY)}" fill="url(#pg-ffd166)" opacity="0.6"><animate attributeName="opacity" values="0.4;0.95;0.4" dur="0.5s" repeatCount="indefinite"/></circle>`,
      )
    }
  }

  // Fire, frost, water, acid and shocks as they came and went.
  for (const ch of ELEMENTS) {
    const on = spans(tr.states, ch)
    if (on.length === 0) continue
    const l = elementLayer(b, ch)
    for (const s of on.slice(0, MAX_SPANS)) {
      const from = tr.born + s.from
      const until = s.until < 0 ? -1 : tr.born + s.until
      if (l.turned) look += during(from, until, l.turned)
      if (l.near) near += during(from, until, l.near)
    }
  }

  const born = tr.born > 0 ? ` visibility="hidden"` : ''
  const sets = (tr.born > 0 ? show(tr.born) : '') + (tr.died >= 0 ? gone(tr.died) : '')
  const deg = D(0)

  return (
    `<g transform="translate(${n(X(0))} ${n(Y(0))})"${born}>${move}${sets}${near}` +
    `<g${Math.abs(deg) >= 0.05 ? ` transform="rotate(${n(deg)})"` : ''}>${turn}${look}</g></g>`
  )
}

/**
 * A round's flight: moved through its poses, a key every `stride` ticks and
 * at its last, timed to the tick, so it reaches what it struck as it is
 * hidden. Fire and gas swell and fade over their lives; a star spins.
 */
function pelletMarkup(tr: PelletTrack, stride: number, tol: number, ids: RoundIds): string {
  const p = tr.poses
  const count = p.length / 2
  const X = (i: number) => sx(p[2 * i]!)
  const Y = (i: number) => sy(p[2 * i + 1]!)
  const r = tr.round
  let move = ''
  if (count > 1) {
    const ticks: number[] = []
    for (let i = 0; i < count - 1; i += stride) ticks.push(i)
    ticks.push(count - 1)
    const last = count - 1
    const keys = keysFor(ticks, i => [X(i), Y(i)], tol * 1.5)
    move = `<animateTransform attributeName="transform" type="translate" ${keyed(keys, 0, last, i => `${n(X(i))} ${n(Y(i))}`)}begin="${at(tr.born)}" dur="${Math.round(last * TICK_MS) / 1000}s" fill="freeze"/>`
  }
  let look = roundLook(r, tr.color, ids)
  if (r.fade) {
    const life = `${r.life}s`
    look =
      `<g><animateTransform attributeName="transform" type="scale" values="1;2.2" begin="${at(tr.born)}" dur="${life}" fill="freeze"/>` +
      `<animate attributeName="opacity" values="1;0.75;0" begin="${at(tr.born)}" dur="${life}" fill="freeze"/>${look}</g>`
  }
  if (r.turn === 'spin') look = `<g>${look}<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="0.6s" repeatCount="indefinite"/></g>`
  else if (r.turn === 'point' && Math.abs(tr.heading) >= 0.5) look = `<g transform="rotate(${n(tr.heading)})">${look}</g>`
  const trail = r.trail ? `<g transform="rotate(${n(tr.heading)})">${trailLook(r)}</g>` : ''
  const hidden = tr.born > 0 ? ' visibility="hidden"' : ''
  const sets = (tr.born > 0 ? show(tr.born) : '') + (tr.died >= 0 ? gone(tr.died) : '')

  return `<g transform="translate(${n(X(0))} ${n(Y(0))})"${hidden}>${sets}${move}${trail}${look}</g>`
}

/**
 * A particle's flight, stepped tick by tick as the engine steps it, keyed at
 * a few points along it: a spark or an ember fading, smoke swelling as it
 * fades, a chunk tumbling down to the ground.
 */
function sparkMarkup(s0: Spark): string {
  const p: Particle = { ...s0 }
  const pts: [number, number][] = [[p.x, p.y]]
  while (p.life > 0 && p.y > -1 && pts.length <= 60) {
    stepParticle(p, TICK_S)
    pts.push([p.x, p.y])
  }
  const ticks = pts.length - 1
  if (ticks === 0) return ''
  const nKeys = s0.kind === 'chunk' ? 6 : 4
  const keys = Array.from({ length: nKeys }, (_, k) => pts[Math.round((k * ticks) / (nKeys - 1))]!)
  const dur = `${Math.round(ticks * TICK_MS) / 1000}s`
  const time = `begin="${at(s0.born)}" dur="${dur}"`
  // Whole pixels: a particle is a speck, and its markup adds up.
  const move = `<animateTransform attributeName="transform" type="translate" values="${keys.map(([kx, ky]) => `${Math.round(sx(kx))} ${Math.round(sy(ky))}`).join(';')}" ${time}/>`
  const fade = (values: string) => `<animate attributeName="opacity" values="${values}" ${time}/>`
  let look: string
  if (s0.kind === 'smoke') {
    const r0 = s0.size * S * 0.5 * SOFT
    look = `<circle r="${n(r0)}" fill="${tinted('s', s0.color)}" opacity="0"><animate attributeName="r" values="${n(r0)};${n(r0 * 2.2)}" ${time}/>${fade('0.5;0.34;0')}</circle>`
  } else if (s0.kind === 'chunk') {
    const w = s0.size * S
    const h = w * 0.6
    const turn = Math.round((-s0.spin * ticks * TICK_S * 180) / Math.PI)
    look =
      `<g opacity="0">${fade('1;1;1;0')}<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" rx="1" fill="${hexColor(s0.color)}" stroke="#1b1b2b" stroke-width="0.8">` +
      `<animateTransform attributeName="transform" type="rotate" values="0;${turn}" ${time}/></rect></g>`
  } else {
    const r = Math.max(1.1, s0.size * S * 0.6) * GLOW
    look = `<circle r="${n(r)}" fill="${tinted('k', s0.color)}" opacity="0">${fade(`${n(Math.min(1, s0.life * 2.2))};0`)}</circle>`
  }

  // Unseen before it begins and once it ends: no place to start from, nothing held at the end.
  return `<g>${move}${look}</g>`
}

/** A ring or a vortex from the tick it appeared, as far through its life as it already was. */
function effectMarkup(born: number, fx: Effect): string {
  const left = fx.life - fx.t
  if (left <= 0) return ''
  const begin = at(born)
  const dur = `${Math.round(left * 1000) / 1000}s`
  const done = fx.t / fx.life
  const cx = n(sx(fx.x))
  const cy = n(sy(fx.y))
  if (fx.kind === 'blast') {
    const R = fx.r * S
    const grow = (r0: number, r1: number) => `<animate attributeName="r" values="${n(r0)};${n(r1)}" begin="${begin}" dur="${dur}" fill="freeze"/>`
    const drift = (dx: number, dy: number) =>
      `<animateTransform attributeName="transform" type="translate" values="${n(dx * R)} ${n(dy * R)};${n(dx * R * 2)} ${n(dy * R * 2)}" begin="${begin}" dur="${dur}" fill="freeze"/>`
    let lobes = ''
    for (const [dx, dy, r0, r1] of LOBES) lobes += `<circle r="${n(R * r0 * BALL)}" fill="url(#pd-fireball)" transform="translate(${n(dx * R)} ${n(dy * R)})">${grow(R * r0 * BALL, R * r1 * BALL)}${drift(dx, dy)}</circle>`
    // A big one lights up the whole picture for a moment.
    const flash = fx.r >= 2 ? `<rect x="${n(-sx(fx.x))}" y="${n(-sy(fx.y))}" width="${VIEW_W}" height="${VIEW_H}" fill="#fff3d6" opacity="0"><animate attributeName="opacity" values="0.24;0" begin="${begin}" dur="0.2s" fill="freeze"/></rect>` : ''

    return (
      `<g transform="translate(${cx} ${cy})">${flash}` +
      // Its light thrown wide round it, flaring and dying away.
      `<circle r="${n(R * LIGHT)}" fill="url(#pg-ff9a3a)" opacity="0"><animate attributeName="opacity" values="1;0.55;0" keyTimes="0;0.3;1" begin="${begin}" dur="${dur}" fill="freeze"/></circle>` +
      `<g opacity="0"><animate attributeName="opacity" values="0.9;0.7;0" keyTimes="0;0.35;1" begin="${begin}" dur="${dur}" fill="freeze"/>` +
      lobes +
      `<circle r="${n(R * 0.3 * BALL)}" fill="url(#pd-fireball)">${grow(R * 0.3 * BALL, R * 0.5 * BALL)}</circle>` +
      `<circle r="${n(R * 0.16)}" fill="#fff1a8">${grow(R * 0.16, R * 0.26)}<animate attributeName="opacity" values="1;0;0" begin="${begin}" dur="${dur}" fill="freeze"/></circle></g>` +
      `<circle r="${n(R * 0.45)}" fill="#ffffff" opacity="0"><animate attributeName="opacity" values="0.9;0" begin="${begin}" dur="0.14s" fill="freeze"/></circle>` +
      // A shock ring racing out past the fireball, thinning as it goes.
      `<circle r="${n(R * 0.4)}" fill="none" stroke="#fff1a8" stroke-width="6" opacity="0">` +
      `<animate attributeName="r" values="${n(R * 0.4)};${n(R * 1.35)}" calcMode="spline" keySplines="0.2 0.7 0.4 1" begin="${begin}" dur="0.32s" fill="freeze"/>` +
      `<animate attributeName="opacity" values="0.8;0" begin="${begin}" dur="0.32s" fill="freeze"/>` +
      `<animate attributeName="stroke-width" values="6;1" begin="${begin}" dur="0.32s" fill="freeze"/></circle></g>`
    )
  }
  if (fx.kind === 'score') {
    return (
      `<g transform="translate(${cx} ${cy})"><g opacity="0">` +
      `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.6;1" begin="${begin}" dur="${dur}" fill="freeze"/>` +
      `<animateTransform attributeName="transform" type="translate" values="0 0;0 -48" begin="${begin}" dur="${dur}" fill="freeze"/>` +
      `${scoreText(fx.text ?? '', fx.color)}</g></g>`
    )
  }
  if (fx.kind === 'ring') {
    const r0 = fx.r * S * (0.25 + 0.75 * done)
    return (
      `<circle cx="${cx}" cy="${cy}" r="${n(r0)}" fill="none" stroke="${hexColor(fx.color)}" stroke-width="9" opacity="0">` +
      `<animate attributeName="r" values="${n(r0)};${n(fx.r * S)}" begin="${begin}" dur="${dur}" fill="freeze"/>` +
      `<animate attributeName="opacity" values="${n(1 - done)};0" begin="${begin}" dur="${dur}" fill="freeze"/>` +
      `<animate attributeName="stroke-width" values="${n(2 + 7 * (1 - done))};2" begin="${begin}" dur="${dur}" fill="freeze"/></circle>`
    )
  }

  return (
    `<g opacity="0"><animate attributeName="opacity" values="1;1;0" keyTimes="0;${n(Math.max(0, Math.min(0.9, (0.6 - done) / (1 - done))))};1" begin="${begin}" dur="${dur}" fill="freeze"/>` +
    `<g>${vortexArms(fx, 0)}<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="-360 ${cx} ${cy}" begin="${begin}" dur="0.9s" repeatCount="indefinite"/></g>` +
    `<circle cx="${cx}" cy="${cy}" r="18" fill="#05060f" opacity="0.75"/></g>`
  )
}

/** The world shaken for a moment at each blast, harder the bigger it is (the bar over it stays still). */
function shakes(rec: Recording): string {
  let out = ''
  for (const e of rec.effects) {
    if (e.fx.kind !== 'blast' || e.fx.t > 0 || e.fx.r < 1) continue
    const a = Math.min(9, 2 + 2 * e.fx.r)
    out += `<animateTransform attributeName="transform" type="translate" values="0 0;${n(-a)} ${n(a * 0.5)};${n(a * 0.8)} ${n(-a * 0.6)};${n(-a * 0.5)} ${n(a * 0.3)};0 0" begin="${at(e.born)}" dur="0.3s"/>`
  }

  return out
}

/** The shot's path, its dots shown in fives from the tick each five was laid. */
function pathMarkup(rec: Recording): string {
  let out = ''
  for (let i = 2; i < rec.path.length; i += 10) {
    let dots = ''
    for (let j = i; j < Math.min(rec.path.length, i + 10); j += 2) dots += pathDot(j, rec.path[j]!.x, rec.path[j]!.y)
    out += during(rec.path[i]!.born, -1, dots)
  }

  return out
}

function animate(rec: Recording, detail: AnimDetail): string {
  const parts: string[] = [
    `<g>${shakes(rec)}`,
    drawScenery(),
    drawEmptyBand(),
    elementDefs(rec.tracks.flatMap(t => t.states)),
    bugDefs(rec.tracks.some(t => t.body.kind === 'bug')),
    rec.tracks.map(trackShadow).join(''),
    pathMarkup(rec),
  ]
  let artLeft = detail.art
  for (const tr of rec.tracks) {
    const art = tr.body.kind === 'shot' && artLeft > 0 && !!tr.body.spec?.art
    if (art) artLeft--
    parts.push(trackMarkup(rec, tr, detail, art))
  }
  // Past the budget, an even share of the rounds, and of the sparks.
  const share = rec.pellets.length > detail.pellets ? rec.pellets.length / Math.max(1, detail.pellets) : 1
  if (detail.pellets > 0) {
    const rounds = roundDefs(rec.pellets.map(t => t.round))
    parts.push(rounds.defs)
    for (let i = 0; i < rec.pellets.length; i += share) parts.push(pelletMarkup(rec.pellets[Math.floor(i)]!, detail.stride, detail.tol, rounds.ids))
  }
  for (const e of rec.effects) parts.push(effectMarkup(e.born, e.fx))
  // Past the budget, an even share of the sparks.
  const step = rec.sparks.length > detail.sparks ? rec.sparks.length / Math.max(1, detail.sparks) : 1
  if (detail.sparks > 0) for (let i = 0; i < rec.sparks.length; i += step) parts.push(sparkMarkup(rec.sparks[Math.floor(i)]!))
  parts.push('</g>')
  parts.push(layered(rec.hud), layered(rec.words))

  return svgDoc(withPaints(parts.join('')), true)
}

/**
 * A recorded flight as one SVG animation, scenery and all, within what a post
 * can carry; `from` ms into its first tick when it starts, to take over from
 * a flight on screen between two of its ticks.
 */
export function animation(rec: Recording, v: View = BASE_VIEW, from = 0): string {
  useView(v)
  skip = Math.max(0, Math.min(TICK_MS, from))
  // Each rung gives up less than the next. Particles, rounds and drawings go
  // first; then the keys are let stray a little further from the flight,
  // which keeps every one the motion needs; only then are ticks skipped.
  const details: AnimDetail[] = [
    { stride: 1, tol: 0.6, sparks: 120, art: 8, pellets: 200 },
    { stride: 1, tol: 0.6, sparks: 60, art: 6, pellets: 100 },
    { stride: 1, tol: 0.8, sparks: 30, art: 4, pellets: 50 },
    { stride: 1, tol: 1.4, sparks: 15, art: 3, pellets: 30 },
    { stride: 1, tol: 2.5, sparks: 0, art: 2, pellets: 20 },
    { stride: 2, tol: 4, sparks: 0, art: 1, pellets: 12 },
    { stride: 4, tol: 6, sparks: 0, art: 0, pellets: 8 },
  ]
  let svg = ''
  for (const d of details) {
    svg = animate(rec, d)
    if (svg.length <= ANIM_BUDGET) break
  }
  skip = 0

  return svg
}
