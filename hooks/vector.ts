// Prompt & Destroy as vectors, for the surfaces that draw `Svg` (the desktop
// app): the scenery once (backdrop); over it, while aiming, one transparent
// SVG document per frame with everything that moves (vector); and for a shot
// in flight, the whole flight recorded (replay.ts) and drawn as one SVG
// animation (animation) that the surface plays at its own frame rate.
//
// Pure, like engine.ts. Plain shapes, strokes, opacity and SMIL only (no
// gradients, filters or references), so it draws the same wherever scrubbed.

import {
  BUG,
  GRAVITY,
  LAUNCHER_X,
  MATERIALS,
  TICK_MS,
  TIP_L,
  TIP_R,
  VERB,
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
// The scenery, drawn once

let scenery = ''

function hillPath(f: (x: number) => number): string {
  let d = `M0 ${n(sy(-1))}`
  for (let x = view.x0; x <= view.x1 + 0.01; x += 0.25) d += `L${n(sx(x))} ${n(sy(f(x)))}`

  return `${d}L${VIEW_W} ${n(sy(-1))}Z`
}

function drawScenery(): string {
  if (scenery) return scenery
  const parts: string[] = []
  // Sky in bands, deep blue overhead to dusk at the horizon.
  const bands = Math.max(14, Math.round(sy(0) / 34))
  for (let i = 0; i < bands; i++) {
    const c = mix(0x0b1026, 0x2b3d6e, i / (bands - 1))
    parts.push(`<rect x="0" y="${n((i * sy(0)) / bands)}" width="${VIEW_W}" height="${n(sy(0) / bands + 1)}" fill="${hexColor(c)}"/>`)
  }
  // Stars, a few of them twinkling crosses, as many to a patch of sky however much there is.
  const stars = Math.round((70 * VIEW_W * sy(3.5)) / (WORLD_W * S * (WORLD_H - 4.5) * S))
  for (let i = 0; i < stars; i++) {
    const x = hash(i) * VIEW_W
    const y = hash(i + 101) * sy(3.5)
    const r = 0.6 + hash(i + 202) * 1.2
    const o = 0.35 + hash(i + 303) * 0.6
    if (i % 11 === 0) {
      const k = r * 3
      parts.push(
        `<path d="M${n(x - k)} ${n(y)}H${n(x + k)}M${n(x)} ${n(y - k)}V${n(y + k)}" stroke="#dfe6ff" stroke-width="1" opacity="${n(o)}"/>`,
      )
    }
    parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="#dfe6ff" opacity="${n(o)}"/>`)
  }
  // The moon with a halo and craters, high on the right, under the bar along the top.
  const mx = VIEW_W - 160
  const my = 44 + 34 * view.k
  parts.push(
    `<circle cx="${mx}" cy="${n(my)}" r="70" fill="#f4f1de" opacity="0.05"/>`,
    `<circle cx="${mx}" cy="${n(my)}" r="48" fill="#f4f1de" opacity="0.07"/>`,
    `<circle cx="${mx}" cy="${n(my)}" r="32" fill="#f4f1de"/>`,
    `<circle cx="${mx - 10}" cy="${n(my - 8)}" r="7" fill="#e3ddbf"/>`,
    `<circle cx="${mx + 11}" cy="${n(my + 10)}" r="5" fill="#e3ddbf"/>`,
    `<circle cx="${mx + 9}" cy="${n(my - 14)}" r="3.5" fill="#e3ddbf"/>`,
  )
  // Faint clouds, spread over the sky's width and, in a tall one, down it:
  // two more there, where the world's own sky has no room for them.
  const across = VIEW_W / (WORLD_W * S)
  const bar = 34 * view.k
  const deep = (sy(4) - bar) / (WORLD_H - 5) / S
  const clouds: [number, number, number][] = [
    [190, 92, 120],
    [560, 58, 90],
    [700, 140, 150],
  ]
  if (deep > 1.6) clouds.push([330, 230, 110], [860, 280, 140])
  for (const [x, y, w] of clouds) {
    const cx = n(x * across)
    const cy = n(bar + (y - 34) * Math.max(1, deep))
    parts.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${n(w / 7)}" fill="#c8d4ff" opacity="0.05"/>`,
      `<ellipse cx="${n(Number(cx) + w / 6)}" cy="${n(Number(cy) - w / 14)}" rx="${n(w / 3.5)}" ry="${n(w / 8)}" fill="#c8d4ff" opacity="0.05"/>`,
    )
  }
  // Two ranges of hills, as the terminal draws them.
  parts.push(
    `<path d="${hillPath(x => 2.2 + 0.9 * Math.sin(x * 0.23 + 1.3) + 0.5 * Math.sin(x * 0.61))}" fill="#223259"/>`,
    `<path d="${hillPath(x => 1.1 + 0.6 * Math.sin(x * 0.37 + 4) + 0.3 * Math.sin(x * 1.1 + 2))}" fill="#1a2747"/>`,
  )
  // Ground: dirt with pebbles, a grass edge with tufts.
  const top = sy(0)
  parts.push(`<rect x="0" y="${n(top)}" width="${VIEW_W}" height="${n(VIEW_H - top)}" fill="#4a3524"/>`)
  for (let i = 0; i < Math.round(40 * across); i++) {
    parts.push(
      `<ellipse cx="${n(hash(i + 404) * VIEW_W)}" cy="${n(top + 14 + hash(i + 505) * (VIEW_H - top - 18))}" rx="${n(2 + hash(i + 606) * 3)}" ry="${n(1.5 + hash(i + 707) * 1.5)}" fill="#3d2b1d"/>`,
    )
  }
  parts.push(`<rect x="0" y="${n(top)}" width="${VIEW_W}" height="9" fill="#4c8a3f"/>`)
  let tufts = ''
  for (let x = 4; x < VIEW_W; x += 9 + hash(x) * 10) {
    const h = 4 + hash(x + 1) * 6
    tufts += `M${n(x)} ${n(top + 1)}l2 ${n(-h)}l2 ${n(h)}`
  }
  parts.push(`<path d="${tufts}" fill="#5fa34f"/>`, `<rect x="0" y="${n(top + 8)}" width="${VIEW_W}" height="2" fill="#3a6b30"/>`)
  // The launcher's post and fork, outlined.
  const fork = `M${n(sx(LAUNCHER_X))} ${n(sy(0))}V${n(sy(1.4))}M${n(sx(LAUNCHER_X))} ${n(sy(1.4))}L${n(sx(TIP_L.x))} ${n(sy(TIP_L.y))}M${n(sx(LAUNCHER_X + 0.05))} ${n(sy(1.4))}L${n(sx(TIP_R.x))} ${n(sy(TIP_R.y))}`
  parts.push(
    `<path d="${fork}" stroke="#2e1d0e" stroke-width="13" stroke-linecap="round" fill="none"/>`,
    `<path d="${fork}" stroke="#7a5230" stroke-width="8" stroke-linecap="round" fill="none"/>`,
    `<path d="M${n(sx(LAUNCHER_X) - 2)} ${n(sy(0.1))}V${n(sy(1.3))}" stroke="#9a6a3f" stroke-width="2" stroke-linecap="round"/>`,
  )
  scenery = parts.join('')

  return scenery
}

// ---------------------------------------------------------------------------
// Blocks and bugs

/** How worn a block looks: 0, 1 or 2 cracks. */
export function crackLevel(b: Body): number {
  const worn = Math.max(b.wear / b.strength, b.decay)
  if (!Number.isFinite(worn) || worn < 0.25) return 0

  return worn > 0.6 ? 2 : 1
}

/** A block's two cracks, the same for the same block every frame, in its frame. */
function crackLines(b: Body): string[] {
  const w = b.hw * 2 * S
  const h = b.hh * 2 * S
  const color = b.mat === 'wood' ? '#3a2412' : b.mat === 'stone' ? '#33373d' : '#ffffff'
  const out: string[] = []
  for (let k = 0; k < 2; k++) {
    const seed = b.id * 7 + k * 13
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
    out.push(
      `<path d="${d}" stroke="${color}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`,
    )
  }

  return out
}

function drawBlock(b: Body): string {
  return `<g transform="${place(b.x, b.y, b.a)}">${blockLook(b, crackLines(b).slice(0, crackLevel(b)).join(''))}${atWork(b)}`
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

/** A block in its own frame (pixels, y down), with `cracks` drawn over it. */
function blockLook(b: Body, cracks: string): string {
  const w = b.hw * 2 * S
  const h = b.hh * 2 * S
  const x0 = -w / 2
  const y0 = -h / 2
  const rect = (fill: string, stroke: string, extra = '') =>
    `<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(h)}" rx="2.5" fill="${fill}" stroke="${stroke}" stroke-width="2"${extra}/>`
  let body = ''
  if (b.mat === 'wood') {
    const m = MATERIALS.wood
    body += rect(hexColor(m.color), hexColor(m.edge))
    // Grain along the long side, and a knot on big pieces.
    let grain = ''
    const long = w > h
    for (const t of [-0.28, 0.06, 0.3]) {
      grain += long
        ? `M${n(x0 + 4)} ${n(h * t)}Q${n(0)} ${n(h * t + 2)} ${n(-x0 - 4)} ${n(h * t - 1)}`
        : `M${n(w * t)} ${n(y0 + 4)}Q${n(w * t + 2)} ${n(0)} ${n(w * t - 1)} ${n(-y0 - 4)}`
    }
    body += `<path d="${grain}" stroke="${hexColor(shade(m.color, 0.78))}" stroke-width="1.3" fill="none" opacity="0.8"/>`
    if (w * h > 900) body += `<ellipse cx="${n(w * 0.18)}" cy="${n(h * 0.12)}" rx="3" ry="2" fill="none" stroke="${hexColor(m.edge)}" stroke-width="1.2"/>`
    body += `<rect x="${n(x0 + 2)}" y="${n(y0 + 2)}" width="${n(w - 4)}" height="${n(Math.min(4, h * 0.2))}" rx="1.5" fill="#ffffff" opacity="0.12"/>`
  } else if (b.mat === 'stone') {
    const m = MATERIALS.stone
    body += rect(hexColor(m.color), hexColor(m.edge))
    // Mortar: courses and staggered joints.
    let mortar = ''
    const course = 18
    const rows = Math.max(1, Math.round(h / course))
    for (let r = 1; r < rows; r++) mortar += `M${n(x0 + 2)} ${n(y0 + (r * h) / rows)}H${n(-x0 - 2)}`
    for (let r = 0; r < rows; r++) {
      const ya = y0 + (r * h) / rows
      const yb = y0 + ((r + 1) * h) / rows
      for (let x = x0 + (r % 2 ? 14 : 26); x < -x0 - 6; x += 28) mortar += `M${n(x)} ${n(ya + 1)}V${n(yb - 1)}`
    }
    body += `<path d="${mortar}" stroke="#6c727b" stroke-width="1.4" fill="none"/>`
    body += `<rect x="${n(x0 + 2)}" y="${n(y0 + 2)}" width="${n(w - 4)}" height="${n(Math.min(5, h * 0.25))}" rx="1.5" fill="#ffffff" opacity="0.16"/>`
  } else {
    const m = MATERIALS.glass
    body += rect(hexColor(m.color), '#d4f4ff', ' fill-opacity="0.42"')
    // Two streaks of shine.
    const k = Math.min(w, h)
    body += `<path d="M${n(x0 + k * 0.25)} ${n(-y0 - 3)}L${n(x0 + k * 0.75)} ${n(y0 + 3)}M${n(x0 + k * 0.55)} ${n(-y0 - 3)}L${n(x0 + k * 0.85)} ${n(y0 + k * 0.5)}" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.55"/>`
  }

  return body + cracks
}

function drawBug(b: Body, look: { x: number; y: number } | null): string {
  return `<g transform="${place(b.x, b.y, b.a)}">${bugLook(b, look)}${atWork(b)}`
}

/** A round purple beetle in its own frame, its eyes on `look` (a world point). */
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
  const legs = [-11, -3, 6]
    .map(x => `M${x} 9l-3 7M${x + 6} 9l3 7`)
    .join('')
  const eye = (x: number) =>
    `<circle cx="${x}" cy="-4" r="5.4" fill="#ffffff" stroke="#4a1f55" stroke-width="1.4"/><circle cx="${n(x + ex * 2.3)}" cy="${n(-4 + ey * 2.3)}" r="2.6" fill="#1b0f22"/>`

  return (
    `<path d="${legs}" stroke="#4a1f55" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M-6 -12Q-10 -21 -15 -20M6 -12Q10 -21 15 -20" stroke="#4a1f55" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<circle cx="-15" cy="-20" r="2.2" fill="#ffd166"/><circle cx="15" cy="-20" r="2.2" fill="#ffd166"/>` +
    `<ellipse cx="0" cy="1" rx="17.5" ry="14" fill="${hexColor(BUG.color)}" stroke="${hexColor(BUG.edge)}" stroke-width="2.4"/>` +
    `<path d="M-12 7Q0 13 12 7" stroke="${hexColor(BUG.edge)}" stroke-width="1.6" fill="none"/>` +
    `<circle cx="-9" cy="6" r="2.4" fill="#9a3fb0"/><circle cx="10" cy="5" r="2" fill="#9a3fb0"/><circle cx="1" cy="9" r="1.6" fill="#9a3fb0"/>` +
    `<ellipse cx="-7" cy="-8" rx="6" ry="3" fill="#ffffff" opacity="0.25"/>` +
    eye(-6) +
    eye(6)
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
  const fill = hexColor(color)
  const edge = hexColor(shade(color, 0.55))
  let look = outline(info, fill, edge)
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
// What is at work on a body (engine's `elementCode`): fire, a lit fuse,
// water, frost, a shock, acid. A tint over the body, turned with it, and a
// look round it that stays upright (flames rise whichever way it lies), each
// look defined once per picture for every body showing it to use.

/** The letters of `elementCode`, in the order they are drawn, bottom up. */
const ELEMENTS = 'wiafzx'

const ELEMENT_DEFS: Record<string, string> = {
  f:
    `<g id="pd-fire2"><ellipse cx="0" cy="-38" rx="58" ry="56" fill="#ff8a3d" opacity="0.16"><animate attributeName="opacity" values="0.24;0.1;0.24" dur="0.43s" repeatCount="indefinite"/></ellipse>` +
    `<g><animateTransform attributeName="transform" type="scale" values="1 0.92;0.93 1.12;1.05 0.88;1 0.92" dur="0.37s" repeatCount="indefinite"/>` +
    `<path d="M-46 0Q-50 -46 -28 -58Q-28 -40 -12 -36Q-16 -64 6 -96Q14 -66 30 -60Q28 -74 42 -80Q54 -40 46 0Z" fill="#ff4d2e" opacity="0.9"/>` +
    `<path d="M-30 0Q-32 -26 -16 -40Q-14 -26 -2 -22Q-2 -50 12 -66Q18 -42 28 -38Q36 -18 30 0Z" fill="#ff9f1c"/>` +
    `<path d="M-14 0Q-16 -16 -2 -28Q4 -14 10 -32Q18 -16 14 0Z" fill="#ffe066"/></g></g>` +
    `<g id="pd-fire"><ellipse cx="0" cy="-38" rx="62" ry="60" fill="#ff8a3d" opacity="0.18"><animate attributeName="opacity" values="0.12;0.28;0.12" dur="0.5s" repeatCount="indefinite"/></ellipse>` +
    `<g><animateTransform attributeName="transform" type="scale" values="1 1;1.06 0.84;0.94 1.1;1 1" dur="0.42s" repeatCount="indefinite"/>` +
    `<path d="M-48 0Q-54 -40 -22 -62Q-26 -38 -8 -30Q-10 -70 12 -100Q16 -60 34 -52Q30 -66 40 -72Q58 -36 48 0Z" fill="#ff4d2e" opacity="0.9"/>` +
    `<path d="M-32 0Q-34 -30 -14 -46Q-14 -28 -2 -24Q0 -54 14 -72Q16 -40 30 -34Q38 -18 32 0Z" fill="#ff9f1c"/>` +
    `<path d="M-16 0Q-18 -18 -4 -30Q2 -16 8 -36Q20 -18 16 0Z" fill="#ffe066"/></g></g>`,
  x: `<g id="pd-fuse"><circle r="50" fill="#ff2a2a" opacity="0"><animate attributeName="opacity" values="0;0.5;0" dur="0.24s" repeatCount="indefinite"/></circle></g>`,
  z:
    `<g id="pd-zap"><animate attributeName="opacity" values="1;0.15;0.9;0" calcMode="discrete" dur="0.18s" repeatCount="indefinite"/>` +
    `<circle r="50" fill="#fff36b" opacity="0.18"/>` +
    `<polyline points="-50,-6 -30,12 -12,-14 6,10 24,-12 50,4" fill="none" stroke="#fff36b" stroke-width="6" stroke-linejoin="round"/>` +
    `<polyline points="-20,-48 -6,-20 -22,0 4,22 -8,48" fill="none" stroke="#9ff6ff" stroke-width="4" stroke-linejoin="round"/></g>`,
  a: `<g id="pd-bubbles">${[
    [-25, 7, 0.8, 0],
    [5, 5, 0.65, -0.3],
    [28, 6, 0.9, -0.5],
  ]
    .map(
      ([x, r, dur, begin]) =>
        `<circle cx="${x}" cy="0" r="${r}" fill="#b6ff6a" opacity="0"><animate attributeName="cy" values="0;-60" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
        `<animate attributeName="opacity" values="0.9;0" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`,
    )
    .join('')}</g>`,
  w:
    `<g id="pd-drip"><path d="M0 -6Q5 2 0 6Q-5 2 0 -6Z" fill="#7fd4ff" opacity="0">` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 26" dur="0.7s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="1;0" dur="0.7s" repeatCount="indefinite"/></path></g>`,
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
    case 'f':
      return {
        turned: overShape(b, '#1a0d05', 0.35),
        near: use(b.id % 2 ? 'pd-fire2' : 'pd-fire', `translate(0 ${n(low * 0.4 * S)}) scale(${n((reach * 0.75 * S) / 50)} ${n(((reach * 0.6 + 0.4) * 1.2 * S) / 100)})`),
      }
    case 'x':
      return { turned: '', near: use('pd-fuse', `scale(${n(((Math.min(b.r, 1.6) + 0.2) * S) / 50)})`) }
    case 'w':
      return { turned: overShape(b, '#3fa7ff', 0.3), near: use('pd-drip', `translate(0 ${n(low * S)})`) }
    case 'i':
      return {
        turned:
          overShape(b, '#e6f8ff', 0.6, '#ffffff') +
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
    const glow = 0.25 + 0.2 * Math.sin(g.frame * 0.6)
    out += `<circle cx="${n(sx(b.x))}" cy="${n(sy(b.y))}" r="${n((b.r + 0.25) * S)}" fill="#ffd166" opacity="${n(glow)}"/>`
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

/** A stock round drawn around 0,0 in picture units, pointing along +x. */
function stockLook(ammo: Ammo, c: string): string {
  switch (ammo) {
    case 'bullet':
      return `<path d="M-26 0H-4" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity="0.5"/><rect x="-7" y="-3" width="15" height="6" rx="3" fill="${c}" stroke="#2b1d08" stroke-width="1.2"/>`
    case 'laser':
      return `<path d="M-30 0H6" stroke="${c}" stroke-width="7" stroke-linecap="round" opacity="0.45"/><path d="M-28 0H4" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>`
    case 'water':
      return `<circle r="5.5" fill="${c}"/><circle cx="-1.8" cy="-1.8" r="1.7" fill="#ffffff" opacity="0.7"/>`
    case 'fire':
      return `<circle r="11" fill="${c}" opacity="0.8"/><circle cx="1.5" cy="1" r="6" fill="#ffe066" opacity="0.9"/>`
    case 'spike':
      return `<path d="M13 0L-13 -3L-10 0L-13 3Z" fill="${c}" stroke="#1b1b2b" stroke-width="1.2" stroke-linejoin="round"/>`
    case 'ball':
      return `<circle r="8" fill="${c}" stroke="#1b1b2b" stroke-width="1.8"/><circle cx="-2.6" cy="-2.6" r="2.6" fill="#ffffff" opacity="0.45"/>`
    case 'note':
      return `<ellipse cx="-3" cy="5" rx="5" ry="3.6" transform="rotate(-20 -3 5)" fill="${c}" stroke="#1b1b2b" stroke-width="1"/><path d="M1.6 4V-11L9 -7" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    case 'star':
      return `<polygon points="${STAR}" fill="${c}" stroke="#ffffff" stroke-width="1" stroke-linejoin="round"/>`
    case 'bubble':
      return `<circle r="9" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="1.8"/><path d="M-5 -3A6 6 0 0 1 -1 -6.4" stroke="#ffffff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
    case 'gas':
      return `<circle r="14" fill="${c}" opacity="0.3"/><circle cx="9" cy="-6" r="10" fill="${c}" opacity="0.28"/><circle cx="-9" cy="5" r="11" fill="${c}" opacity="0.28"/>`
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
  if (r.look) return stockLook(r.look, c)
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

/** A particle around 0,0 as it looks `k` of the way through its life, `spun` degrees round. */
function particleLook(p: Particle, k: number, spun: number): string {
  const c = hexColor(p.color)
  if (p.kind === 'smoke') return `<circle r="${n(p.size * S * 0.5 * (1 + 1.2 * k))}" fill="${c}" opacity="${n(0.38 * (1 - k))}"/>`
  if (p.kind === 'chunk') {
    const w = p.size * S
    const h = w * 0.6

    return `<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" rx="1" fill="${c}" stroke="#1b1b2b" stroke-width="0.8" transform="rotate(${n(spun)})" opacity="${n(Math.min(1, (1 - k) * 4))}"/>`
  }
  const r = Math.max(1.1, p.size * S * 0.6 * (1 - 0.4 * k))

  return `<circle r="${n(r)}" fill="${c}" opacity="${n(Math.min(1, (1 - k) * 2.2))}"/>`
}

function drawParticle(p: Particle): string {
  const age = p.max - p.life

  return `<g transform="translate(${n(sx(p.x))} ${n(sy(p.y))})">${particleLook(p, aged(p), (-p.spin * age * 180) / Math.PI)}</g>`
}

/** Points won, its text drawn over a dark offset copy of itself so it reads on anything. */
function scoreText(text: string, color: number): string {
  const t = esc(text)

  return (
    `<text x="1.5" y="1.5" text-anchor="middle" font-size="19" font-weight="800" fill="#1b1b2b">${t}</text>` +
    `<text text-anchor="middle" font-size="19" font-weight="800" fill="${hexColor(color)}">${t}</text>`
  )
}

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
    let out = `<g transform="translate(${cx} ${cy})" opacity="${n(hold)}">`
    for (const [dx, dy, r0, r1] of LOBES) out += `<circle cx="${n(dx * R * (1 + k))}" cy="${n(dy * R * (1 + k))}" r="${n(R * (r0 + (r1 - r0) * k))}" fill="#ff6a2a"/>`
    out += `<circle r="${n(R * (0.3 + 0.2 * k))}" fill="#ffb347"/><circle r="${n(R * (0.16 + 0.1 * k))}" fill="#fff1a8" opacity="${n(Math.max(0, 1 - k * 1.8))}"/></g>`
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
  emptyBand ||= `<path d="M${n(sx(TIP_L.x))} ${n(sy(TIP_L.y))}Q${n(sx(LAUNCHER_X))} ${n(sy(TIP_L.y - 0.25))} ${n(sx(TIP_R.x))} ${n(sy(TIP_R.y))}" stroke="#e8b67a" stroke-width="4" fill="none" stroke-linecap="round"/>`

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
  let out = `<rect x="0" y="0" width="${VIEW_W}" height="${n(34 * k)}" fill="#070b1a" opacity="0.55"/>`
  if (brand) {
    out += `<text x="${n(x)}" y="${y}" font-size="${n(16 * k)}" font-weight="800" fill="#ff8a3d" letter-spacing="1">PROMPT &amp; DESTROY</text>`
    x += brandW
  }
  out += `<text x="${n(x)}" y="${y}" font-size="${n(15 * k)}" fill="#e6ecff">${esc(level)}</text>`
  x += textWidth(level, 15 * k) + gap
  out += `<text x="${n(x)}" y="${y}" font-size="${n(13 * k)}" fill="#9aa5c4">Shots</text>`
  for (let i = 0; i < g.maxShots; i++) {
    const cx = n(x + (50 + i * 15) * k)
    out +=
      i < g.shots
        ? `<circle cx="${cx}" cy="${n(17 * k)}" r="${n(5.5 * k)}" fill="#ffd166"/>`
        : `<circle cx="${cx}" cy="${n(17 * k)}" r="${n(5 * k)}" fill="none" stroke="#ffd166" stroke-width="${n(1.5 * k)}" opacity="0.6"/>`
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
  const parts: string[] = []
  const pouch = pouchPosition(g)

  // The sling: drawn where the pouch is, gliding there from where it was.
  const from = detail.from && Math.hypot(detail.from.x - pouch.x, detail.from.y - pouch.y) > 0.01 ? detail.from : null
  const dur = `${detail.glide / 1000}s`
  const band = (tip: { x: number; y: number }, color: string) => {
    const to = `M${n(sx(tip.x))} ${n(sy(tip.y))}L${n(sx(pouch.x))} ${n(sy(pouch.y))}`
    const glide = from ? `<animate attributeName="d" from="M${n(sx(tip.x))} ${n(sy(tip.y))}L${n(sx(from.x))} ${n(sy(from.y))}" to="${to}" dur="${dur}" fill="freeze"/>` : ''

    return `<path d="${to}" stroke="${color}" stroke-width="5" stroke-linecap="round">${glide}</path>`
  }
  if (!g.loaded) parts.push(drawEmptyBand())
  else parts.push(band(TIP_L, '#b98448'))

  // What the bugs watch: the shot in flight, else the pouch.
  const flying = g.bodies.find(b => b.kind === 'shot' && !b.shard)
  const look = flying ? { x: flying.x, y: flying.y } : g.loaded ? pouch : null
  let artLeft = detail.art
  const ready = g.phase === 'flying' && !g.abilityUsed && g.activeAbility !== 'none'
  parts.push(elementDefs(g.bodies.map(elementCode)))
  parts.push(drawPath(g))
  for (const b of g.bodies) {
    if (b.kind === 'ground') continue
    if (b.kind === 'block') parts.push(drawBlock(b))
    else if (b.kind === 'bug') parts.push(drawBug(b, look))
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
        `<rect x="${n(sx(pouch.x) - 6)}" y="${n(sy(pouch.y) - 7)}" width="12" height="14" rx="3" fill="#5a3a1f" opacity="0.9"/>` +
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

  parts.push(hudMarkup(g), wordsMarkup(g))

  return svgDoc(parts.join(''))
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
export function wordsMarkup(g: Game): string {
  const k = view.k
  let out = ''
  if (g.banner) {
    const size = Math.min(30 * k, (VIEW_W - 40 * k) / (g.banner.text.length * 0.56))
    // Over the level, where the world's own sky put it, under the bar along the top.
    const y = Math.max(sy(9.4), 34 * k + size * 1.4)
    out += `<text x="${n(VIEW_W / 2)}" y="${n(y)}" font-size="${n(size)}" font-weight="800" text-anchor="middle" fill="#ffd166" stroke="#0b1026" stroke-width="${n(size / 5)}" stroke-linejoin="round" paint-order="stroke">${esc(g.banner.text)}</text>`
  }
  const st = statusLine(g, false)
  if (st.text && st.text !== g.banner?.text) {
    const size = Math.min(14 * k, (VIEW_W - 28 * k) / (st.text.length * 0.56))
    const bar = Math.max(26 * k, size * 1.9)
    out +=
      `<rect x="0" y="${n(VIEW_H - bar)}" width="${VIEW_W}" height="${n(bar)}" fill="#070b1a" opacity="0.5"/>` +
      `<text x="${n(14 * k)}" y="${n(VIEW_H - bar * 0.3)}" font-size="${n(size)}" fill="${st.color}">${esc(st.text)}</text>`
  }

  return out
}

/** The scenery that never moves (sky, hills, ground, the launcher's post), drawn once under the frames. */
export function backdrop(v: View = BASE_VIEW): string {
  useView(v)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${VIEW_W}" height="${VIEW_H}">${drawScenery()}</svg>`
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
    `<rect x="40" y="15.5" width="24" height="5" rx="2" fill="#b07444" ${ink}/>` +
    `<rect x="29" y="9" width="13" height="17" rx="2" fill="#c3cad6" ${ink}/>` +
    `<rect x="31" y="11" width="3" height="13" rx="1" fill="#ffffff" opacity="0.35"/>`
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
    // The ingot's heat on the dark: rings of light, brightest at its middle.
    `<g opacity="0.55"><animate attributeName="opacity" values="${glow}" dur="${beat}" repeatCount="indefinite"/>` +
    `<circle cx="36.5" cy="29" r="22" fill="#ff8a3d" opacity="0.1"/><circle cx="36.5" cy="29" r="15" fill="#ff8a3d" opacity="0.14"/><circle cx="36.5" cy="29" r="9" fill="#ffd166" opacity="0.2"/></g>` +
    `<path d="M3 35Q12 35 17 32H59V41H49L44 47V51L52 56V61H13V56L21 51V47L18 43Q8 41 3 35Z" fill="#8a929e" ${ink}/>` +
    `<path d="M18 34H57V36.5H18Z" fill="#ffffff" opacity="0.4"/>` +
    `<path d="M44 47V51L52 56V61H40Z" fill="#000000" opacity="0.2"/>` +
    `<rect x="25" y="26" width="23" height="6" rx="2" fill="#ff8a3d" ${ink}/>` +
    `<rect x="27.5" y="27.3" width="12" height="1.8" rx="0.9" fill="#ffe066"/>` +
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
  out += `<circle r="44" fill="#ff8a3d" opacity="0.12">${loop('r', '38;50;38', 1.6)}</circle>`
  out += `<circle r="26" fill="#ffb347" opacity="0.2">${loop('r', '22;30;22', 0.8)}</circle>`
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
  const back = `<g ${at}><circle r="${n(R + 12)}" fill="#ffd166" opacity="0">${once('opacity', '0.45;0.18;0', 0.7)}${once('r', `${n(R + 4)};${n(R + 18)}`, 0.7)}</circle></g>`
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
  /** The ticks it first showed one crack and two (-1: never). */
  cracked: [number, number]
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

type AnimDetail = { stride: number; sparks: number; art: number; pellets: number }

/** An animation past this many characters draws with less detail (a post holds 100,000). */
const ANIM_BUDGET = 92_000

const TICK_S = TICK_MS / 1000
/** Milliseconds of its first tick an animation starts past: its clock begins that far in. */
let skip = 0
const at = (tick: number) => `${Math.round(tick * TICK_MS - skip) / 1000}s`
const show = (tick: number) => `<set attributeName="visibility" to="visible" begin="${at(tick)}" fill="freeze"/>`
const hide = (tick: number) => `<set attributeName="visibility" to="hidden" begin="${at(tick)}" fill="freeze"/>`

/** `inner`, shown from tick `from` until tick `until` (-1: to the end). */
function during(from: number, until: number, inner: string): string {
  if (from <= 0 && until < 0) return inner

  return `<g${from > 0 ? ' visibility="hidden"' : ''}>${from > 0 ? show(from) : ''}${until >= 0 ? hide(until) : ''}${inner}</g>`
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

/** At most this many stretches of each element are drawn on one body. */
const MAX_SPANS = 8

/** A body's track: placed at its first pose, then moved and turned through the rest. */
function trackMarkup(rec: Recording, tr: Track, detail: AnimDetail, art: boolean): string {
  const p = tr.poses
  const count = p.length / 3
  const X = (i: number) => sx(p[3 * i]!)
  const Y = (i: number) => sy(p[3 * i + 1]!)
  const D = (i: number) => (-p[3 * i + 2]! * 180) / Math.PI
  const same = (i: number, j: number) => Math.abs(X(i) - X(j)) < 0.05 && Math.abs(Y(i) - Y(j)) < 0.05 && Math.abs(D(i) - D(j)) < 0.05
  // Only the stretch where it moves is keyed: most of a tower stands still.
  let first = -1
  for (let i = 1; i < count; i++) {
    if (!same(i, 0)) {
      first = i
      break
    }
  }
  let move = ''
  let turn = ''
  if (first > 0) {
    let last = count - 1
    while (last > first && same(last - 1, count - 1)) last--
    const from = first - 1
    const keys: number[] = []
    for (let i = from; ; i += detail.stride) {
      keys.push(Math.min(i, count - 1))
      if (i >= last) break
    }
    const begin = at(tr.born + from)
    const dur = `${Math.round((keys.length - 1) * detail.stride * TICK_MS) / 1000}s`
    const moves = keys.some(i => Math.abs(X(i) - X(from)) >= 0.05 || Math.abs(Y(i) - Y(from)) >= 0.05)
    const turns = keys.some(i => Math.abs(D(i) - D(from)) >= 0.05)
    if (moves) {
      move = `<animateTransform attributeName="transform" type="translate" values="${keys.map(i => `${n(X(i))} ${n(Y(i))}`).join(';')}" begin="${begin}" dur="${dur}" fill="freeze"/>`
    }
    if (turns) {
      turn = `<animateTransform attributeName="transform" type="rotate" values="${keys.map(i => n(D(i))).join(';')}" begin="${begin}" dur="${dur}" fill="freeze"/>`
    }
  }

  const b = tr.body
  let look = ''
  let near = ''
  if (b.kind === 'block') {
    const lines = crackLines(b)
    look = blockLook(b, tr.cracked.map((t, k) => (t < 0 ? '' : during(t, -1, lines[k]!))).join(''))
  } else if (b.kind === 'bug') {
    look = bugLook({ ...b, x: p[0]!, y: p[1]!, a: p[2]! }, rec.look)
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
        `<circle r="${n((b.r + 0.25) * S)}" fill="#ffd166" opacity="0.3"><animate attributeName="opacity" values="0.2;0.45;0.2" dur="0.5s" repeatCount="indefinite"/></circle>`,
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
  const sets = (tr.born > 0 ? show(tr.born) : '') + (tr.died >= 0 ? hide(tr.died) : '')
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
function pelletMarkup(tr: PelletTrack, stride: number, ids: RoundIds): string {
  const p = tr.poses
  const count = p.length / 2
  const X = (i: number) => sx(p[2 * i]!)
  const Y = (i: number) => sy(p[2 * i + 1]!)
  const r = tr.round
  let move = ''
  if (count > 1) {
    const keys: number[] = []
    for (let i = 0; i < count - 1; i += stride) keys.push(i)
    keys.push(count - 1)
    const last = count - 1
    move =
      `<animateTransform attributeName="transform" type="translate" values="${keys.map(i => `${n(X(i))} ${n(Y(i))}`).join(';')}" ` +
      `keyTimes="${keys.map(i => n(i / last)).join(';')}" begin="${at(tr.born)}" dur="${Math.round(last * TICK_MS) / 1000}s" fill="freeze"/>`
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
  const sets = (tr.born > 0 ? show(tr.born) : '') + (tr.died >= 0 ? hide(tr.died) : '')

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
  const begin = at(s0.born)
  const c = hexColor(s0.color)
  const move = `<animateTransform attributeName="transform" type="translate" values="${keys.map(([kx, ky]) => `${n(sx(kx))} ${n(sy(ky))}`).join(';')}" begin="${begin}" dur="${dur}" fill="freeze"/>`
  const fade = (from: number, values = `${n(from)};0`) => `<animate attributeName="opacity" values="${values}" begin="${begin}" dur="${dur}" fill="freeze"/>`
  let look: string
  if (s0.kind === 'smoke') {
    const r0 = s0.size * S * 0.5
    look = `<circle r="${n(r0)}" fill="${c}" opacity="0"><animate attributeName="r" values="${n(r0)};${n(r0 * 2.2)}" begin="${begin}" dur="${dur}" fill="freeze"/>${fade(0.38, '0.38;0.26;0')}</circle>`
  } else if (s0.kind === 'chunk') {
    const w = s0.size * S
    const h = w * 0.6
    const turn = n((-s0.spin * ticks * TICK_S * 180) / Math.PI)
    look =
      `<g opacity="0">${fade(1, '1;1;1;0')}<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" rx="1" fill="${c}" stroke="#1b1b2b" stroke-width="0.8">` +
      `<animateTransform attributeName="transform" type="rotate" values="0;${turn}" begin="${begin}" dur="${dur}" fill="freeze"/></rect></g>`
  } else {
    const r = Math.max(1.1, s0.size * S * 0.6)
    look = `<circle r="${n(r)}" fill="${c}" opacity="0">${fade(1)}</circle>`
  }

  return `<g transform="translate(${n(sx(s0.x))} ${n(sy(s0.y))})">${move}${look}</g>`
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
    for (const [dx, dy, r0, r1] of LOBES) lobes += `<circle r="${n(R * r0)}" fill="#ff6a2a" transform="translate(${n(dx * R)} ${n(dy * R)})">${grow(R * r0, R * r1)}${drift(dx, dy)}</circle>`

    return (
      `<g transform="translate(${cx} ${cy})"><g opacity="0"><animate attributeName="opacity" values="0.9;0.7;0" keyTimes="0;0.35;1" begin="${begin}" dur="${dur}" fill="freeze"/>` +
      lobes +
      `<circle r="${n(R * 0.3)}" fill="#ffb347">${grow(R * 0.3, R * 0.5)}</circle>` +
      `<circle r="${n(R * 0.16)}" fill="#fff1a8">${grow(R * 0.16, R * 0.26)}<animate attributeName="opacity" values="1;0;0" begin="${begin}" dur="${dur}" fill="freeze"/></circle></g>` +
      `<circle r="${n(R * 0.45)}" fill="#ffffff" opacity="0"><animate attributeName="opacity" values="0.9;0" begin="${begin}" dur="0.14s" fill="freeze"/></circle></g>`
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
  const parts: string[] = [`<g>${shakes(rec)}`, drawScenery(), drawEmptyBand(), elementDefs(rec.tracks.flatMap(t => t.states)), pathMarkup(rec)]
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
    for (let i = 0; i < rec.pellets.length; i += share) parts.push(pelletMarkup(rec.pellets[Math.floor(i)]!, detail.stride * 2, rounds.ids))
  }
  for (const e of rec.effects) parts.push(effectMarkup(e.born, e.fx))
  // Past the budget, an even share of the sparks.
  const step = rec.sparks.length > detail.sparks ? rec.sparks.length / Math.max(1, detail.sparks) : 1
  if (detail.sparks > 0) for (let i = 0; i < rec.sparks.length; i += step) parts.push(sparkMarkup(rec.sparks[Math.floor(i)]!))
  parts.push('</g>')
  for (const r of runs(rec.hud)) parts.push(during(r.from, r.until, r.value))
  for (const r of runs(rec.words)) if (r.value) parts.push(during(r.from, r.until, r.value))

  return svgDoc(parts.join(''), true)
}

/**
 * A recorded flight as one SVG animation, scenery and all, within what a post
 * can carry; `from` ms into its first tick when it starts, to take over from
 * a flight on screen between two of its ticks.
 */
export function animation(rec: Recording, v: View = BASE_VIEW, from = 0): string {
  useView(v)
  skip = Math.max(0, Math.min(TICK_MS, from))
  const details: AnimDetail[] = [
    { stride: 1, sparks: 120, art: 8, pellets: 200 },
    { stride: 2, sparks: 60, art: 4, pellets: 120 },
    { stride: 3, sparks: 30, art: 2, pellets: 60 },
    { stride: 4, sparks: 0, art: 1, pellets: 30 },
    { stride: 6, sparks: 0, art: 0, pellets: 12 },
  ]
  let svg = ''
  for (const d of details) {
    svg = animate(rec, d)
    if (svg.length <= ANIM_BUDGET) break
  }
  skip = 0

  return svg
}
