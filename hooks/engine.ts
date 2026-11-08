// Prompt & Destroy: the game itself. A small rigid-body physics solver in the
// style of Box2D-lite (contact clipping, accumulated impulses, warm starting)
// for boxes, convex polygons and circles, with pin joints for sticky things;
// the levels, the rules, and a half-block pixel renderer for the terminal
// (vector.ts draws the same game as SVG for the desktop).
//
// Pure TypeScript with no imports, so the surface module (game.tsx) and the
// headless tests share it. World units are meters, y points up, the ground's
// top is y = 0 and the launcher stands at x = 6.

export type Ability = 'none' | 'explode' | 'split' | 'rocket' | 'grow' | 'dive' | 'boomerang' | 'vortex' | 'shoot'

export type Trait = 'floaty' | 'fragile' | 'sticky' | 'magnetic' | 'piercing'

export type Ammo = 'bullet' | 'laser' | 'water' | 'fire' | 'spike' | 'ball' | 'note' | 'star' | 'bubble' | 'gas' | 'zap'

export type Facing = 'right' | 'left' | 'up' | 'down' | 'around'

export type Aim = 'target' | 'ahead' | 'back' | 'up' | 'down'

/**
 * What a thing is made of and carries, as the world's chemistry reads it: the
 * shape of `Matter` in ../types. Each 0 to 1, but heat -1 (freezing) to 1
 * (burning). Blocks, bugs, shots and rounds all have these nine, and what
 * happens where two meet follows from them alone.
 */
export type Matter = {
  heat: number
  burns: number
  explodes: number
  melts: number
  wet: number
  electric: number
  conducts: number
  acid: number
  dissolves: number
}

/** Matter that does nothing: no heat, nothing to burn, melt, carry or eat. */
export const INERT: Matter = { heat: 0, burns: 0, explodes: 0, melts: 0, wet: 0, electric: 0, conducts: 0, acid: 0, dissolves: 0 }

export function matterOf(m: Partial<Matter>): Matter {
  return { ...INERT, ...m }
}

/** The shape of `Round` in ../types: what a `shoot` fires, as the Forge made it. */
export type Round = {
  art: string
  look: Ammo | ''
  width: number
  height: number
  color: string
  count: number
  every: number
  spread: number
  speed: number
  gravity: number
  punch: number
  blast: number
  pierce: 'none' | 'glass' | 'all'
  bounce: number
  /** What it is: hot, wet, live, corrosive, as a thing's own matter. */
  matter: Matter
  life: number
  fade: boolean
  turn: 'point' | 'spin' | 'upright'
  trail: string
}

/** The shape of `Power` in ../types: the power's name, and for a `shoot`, from where it fires what. */
export type Power = { name: string; from: [number, number]; facing: Facing; aim: Aim; round: Round }

/** What the Forge made of a prompt: the shape of `Item` in ../types. */
export type ShotSpec = {
  id: string
  prompt: string
  name: string
  width: number
  height: number
  density: number
  friction: number
  bounce: number
  color: string
  shape: 'box' | 'circle' | 'polygon'
  points: [number, number][]
  ability: Ability
  power: Power
  matter: Matter
  traits: Trait[]
  art: string
  quip: string
}

/** The Forge's state as the pane hands it over (`Forge` in ../types). */
export type ForgeView =
  | { status: 'idle' }
  | { status: 'forging'; id: string; prompt: string }
  | { status: 'ready'; item: ShotSpec; note: string | null }

type Kind = 'ground' | 'block' | 'bug' | 'shot'
export type Material = 'ground' | 'wood' | 'stone' | 'glass' | 'bug' | 'shot'

/** How a body collides: boxes keep Box2D-lite's own clipper, the rest share a general one. */
export type ShapeKind = 'box' | 'poly' | 'circle'

/** A body's outline and mass per unit density, built once from a spec or a size. */
export type ShapeInfo = {
  shape: ShapeKind
  /** Vertices counter-clockwise around the center of mass, flat [x0, y0, x1, y1, ...]. */
  verts: number[]
  /** The outward unit normal of each edge (vertex i to i + 1), flat as `verts`. */
  norms: number[]
  /** A circle's radius; 0 otherwise. */
  rad: number
  /** Half the bounding box the art is drawn in. */
  hw: number
  hh: number
  /** The farthest point from the center of mass, for the broad phase. */
  r: number
  area: number
  /** Moment of inertia about the center of mass at density 1. */
  I1: number
  /** Where the art's box center sits in the body frame. */
  artX: number
  artY: number
}

export type Body = ShapeInfo & {
  id: number
  kind: Kind
  mat: Material
  x: number
  y: number
  a: number
  vx: number
  vy: number
  av: number
  mass: number
  invMass: number
  invI: number
  friction: number
  bounce: number
  color: number
  strength: number
  /** The impact this step; a blow past `strength` breaks the body. */
  hit: number
  /** Damage that adds up: knocks, a vortex's grinding. Past `strength` breaks too. */
  wear: number
  dead: boolean
  drag: number
  noGravity: number
  gscale: number
  /** Seconds left of a fiery trail behind it. */
  trail: number
  /** A sticky shot that has already stuck. */
  stuck: boolean
  /** A piece of a shattered shot. */
  shard: boolean
  /** The art's scale against the spec's size (split pieces are smaller, grown ones bigger). */
  scale: number
  spec: ShotSpec | null
  /** A shooting shot: how many rounds it has left to fire, and steps until the next. */
  ammoLeft: number
  ammoWait: number
  /** The tick its power went off, for the flash drawn round it then (-1: not yet). */
  powerAt: number
  /** What it is made of and carries. */
  matter: Matter
  /** Seconds of fire left on it (0: not alight). */
  fire: number
  /** Heat taken toward catching fire, to 1. */
  kindle: number
  /** Seconds it stays soaked. */
  soak: number
  /** Cold taken toward freezing, to 1. */
  chill: number
  /** Seconds it stays frozen, brittle while it is. */
  frost: number
  /** Seconds of a shock showing on it. */
  zap: number
  /** Seconds of something corrosive left eating it. */
  corrode: number
  /** Seconds until it goes off, once lit (-1: not lit). */
  fuse: number
  /** How much of it fire, melting and corrosion have eaten, 0 to 1: gone at 1. */
  decay: number
}

type Contact = {
  x: number
  y: number
  nx: number
  ny: number
  sep: number
  fp: number
  Pn: number
  Pt: number
  mn: number
  mt: number
  bias: number
}

type Arbiter = { a: Body; b: Body; cs: Contact[]; friction: number; bounce: number }

/** A pin through two bodies at one point, as Box2D-lite's Joint. */
export type Joint = {
  a: Body
  b: Body
  /** The pin in each body's frame. */
  lax: number
  lay: number
  lbx: number
  lby: number
  r1x: number
  r1y: number
  r2x: number
  r2y: number
  m11: number
  m12: number
  m21: number
  m22: number
  biasX: number
  biasY: number
  Px: number
  Py: number
}

/**
 * What a particle is, which sets how it moves and looks: a spark flies and
 * falls; an ember drifts up; smoke rises, slows, swells and fades; a chunk of
 * something broken tumbles, falls and settles on the ground.
 */
export type ParticleKind = 'spark' | 'ember' | 'smoke' | 'chunk'

/** `life` seconds left of `max`; `size` in meters across; `spin` radians a second (a chunk's tumble). */
export type Particle = {
  kind: ParticleKind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: number
  size: number
  spin: number
}

/** How each kind moves: the share of gravity it feels (below 0 it rises) and how fast the air slows it. */
export const PARTICLE: Record<ParticleKind, { gravity: number; drag: number }> = {
  spark: { gravity: 0.6, drag: 0 },
  ember: { gravity: -0.12, drag: 1.2 },
  smoke: { gravity: -0.3, drag: 2.2 },
  chunk: { gravity: 1, drag: 0 },
}

/** `t` seconds of a particle's flight; a chunk that reaches the ground bounces a little and settles. */
export function stepParticle(p: Particle, t: number): void {
  const k = PARTICLE[p.kind]
  p.vy += GRAVITY * k.gravity * t
  const slow = 1 - Math.min(0.9, k.drag * t)
  p.vx *= slow
  p.vy *= slow
  p.x += p.vx * t
  p.y += p.vy * t
  p.life -= t
  if (p.kind === 'chunk' && p.y < p.size / 2) {
    p.y = p.size / 2
    p.vy = Math.abs(p.vy) * 0.3
    p.vx *= 0.6
    p.spin *= 0.5
  }
}

/**
 * A round a shooting shot fired: it flies, and strikes what it meets. `done`
 * once spent, where it ended, and gone at the next tick, so the tick's
 * picture shows it reach what it struck.
 */
export type Pellet = { round: Round; x: number; y: number; vx: number; vy: number; age: number; color: number; done: boolean; bounces: number }

/** Something drawn and felt for a moment: a shockwave ring or a vortex. */
/**
 * Something drawn and felt for a moment: a shockwave ring, a vortex, a blast
 * (a flash and a fireball of radius `r`), or points scored rising from where
 * they were won (`text`).
 */
export type Effect = { kind: 'ring' | 'vortex' | 'blast' | 'score'; x: number; y: number; t: number; life: number; r: number; color: number; text?: string }

export type Phase = 'settling' | 'waiting' | 'aiming' | 'flying' | 'won' | 'lost'

export type GameEvent = { type: 'result'; level: number; score: number; won: boolean }

export type View = { s: number; ox: number; PW: number; PH: number }

export type Game = {
  level: number
  title: string
  score: number
  levelStartScore: number
  best: number
  shots: number
  maxShots: number
  bodies: Body[]
  arbiters: Map<number, Arbiter>
  joints: Joint[]
  effects: Effect[]
  nextId: number
  time: number
  phase: Phase
  phaseTime: number
  calmTicks: number
  lastKill: number
  loaded: ShotSpec | null
  consumed: Set<string>
  forge: ForgeView
  abilityUsed: boolean
  activeAbility: Ability
  /** Ids of the shots of the turn in flight, whose ability a click can still fire. */
  active: Set<number>
  aim: { x: number; y: number }
  /** Where the pull started; `held` once a click has the sling held for aiming by moving. */
  drag: { sx: number; sy: number; held: boolean } | null
  /**
   * Letting go of a drag holds the sling where it was pulled, for a click to
   * fling, rather than flinging. Where a surface draws nothing new while a
   * button is held (the desktop), the pull shows only once it is let go.
   */
  holdOnRelease: boolean
  particles: Particle[]
  /**
   * The flung shot's path, a dot every few ticks from the sling to the first
   * thing it touches, left showing until the next shot (x, y and the frame).
   */
  path: { x: number; y: number; frame: number }[]
  /** The path has met something and ends there. */
  pathDone: boolean
  /** The frame the Forge began on what it is making (-1: not at work), and the frame the last thing it made reached the pouch. */
  forgeSince: number
  loadedAt: number
  /** When something was last being eaten away (burnt, melted, dissolved, jolted) fast enough to wait for. */
  eaten: number
  pellets: Pellet[]
  banner: { text: string; until: number } | null
  frame: number
  events: GameEvent[]
  view: View
}

export const WORLD_W = 26
export const WORLD_H = 13
export const GRAVITY = -10
const ITERATIONS = 16
export const DT = 1 / 75
export const SUBSTEPS = 3
/** Seconds per tick of the surface clock: SUBSTEPS * DT. */
export const TICK_MS = 40
const GRACE = 1.2
/**
 * Where the launcher stands: far enough in from the picture's left edge for
 * a full pull back, and the levels' towers start at 11.5 m or further.
 */
export const LAUNCHER_X = 6
const POUCH = { x: LAUNCHER_X, y: 2.3 }
/** Where the band ties on, left and right fork tips. */
export const TIP_L = { x: LAUNCHER_X - 0.35, y: 2.5 }
export const TIP_R = { x: LAUNCHER_X + 0.35, y: 2.5 }
const MAX_PULL = 2.4
const LAUNCH_SPEED = 16.5
/** Pixels of drag for a full pull, so aiming feels the same at any size. */
const PULL_PIXELS = 22
/** A press that moves less than this before it lets go is a click. */
const CLICK_PIXELS = 2
/** Polygons keep at most this many vertices. */
const MAX_VERTS = 8

/** What each ability is called on screen, mid-air. */
export const VERB: Record<Ability, string> = {
  none: '',
  explode: 'EXPLODE',
  split: 'SPLIT',
  rocket: 'AFTERBURNER',
  grow: 'SUPERSIZE',
  dive: 'DIVE',
  boomerang: 'BOOMERANG',
  vortex: 'VORTEX',
  shoot: 'FIRE',
}

/** What the shot's power is called: the Forge's name for it, or the ability's. */
export function powerName(spec: ShotSpec | null): string {
  if (!spec) return ''

  return spec.power?.name || VERB[spec.ability]
}

// ---------------------------------------------------------------------------
// Colors

export function parseColor(hex: string, fallback = 0xff8a3d): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())

  return m ? parseInt(m[1]!, 16) : fallback
}

export function hexColor(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0')
}

export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t))
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k
  const bl = (a & 255) + ((b & 255) - (a & 255)) * k

  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)
}

export function shade(c: number, f: number): number {
  return f < 1 ? mix(c, 0x000000, 1 - f) : mix(c, 0xffffff, f - 1)
}

/** Lifts a color too dark to see against the night sky. */
export function visible(c: number): number {
  const lum = 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)

  return lum < 70 ? mix(c, 0xffffff, (70 - lum) / 160 + 0.15) : c
}

export const MATERIALS = {
  wood: { density: 0.6, friction: 0.65, color: 0xb47c43, edge: 0x6e4a26, strength: 3.2, points: 50, matter: matterOf({ burns: 0.6, dissolves: 0.4 }) },
  stone: { density: 2.4, friction: 0.8, color: 0x9298a2, edge: 0x5a5f68, strength: 9, points: 100, matter: matterOf({ dissolves: 0.5 }) },
  glass: { density: 0.5, friction: 0.3, color: 0x9fdcf5, edge: 0x4f9cc0, strength: 1.1, points: 30, matter: INERT },
} as const

export const BUG = {
  density: 0.7,
  friction: 0.7,
  color: 0xc65bd8,
  edge: 0x7d2f8f,
  strength: 1,
  points: 500,
  matter: matterOf({ burns: 0.5, conducts: 0.5, dissolves: 1 }),
}

// ---------------------------------------------------------------------------
// Shapes

function normalsOf(verts: number[]): number[] {
  const n = verts.length / 2
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ex = verts[2 * j]! - verts[2 * i]!
    const ey = verts[2 * j + 1]! - verts[2 * i + 1]!
    const len = Math.hypot(ex, ey) || 1
    out.push(ey / len, -ex / len)
  }

  return out
}

function boxInfo(w: number, h: number): ShapeInfo {
  const hw = w / 2
  const hh = h / 2
  const verts = [-hw, -hh, hw, -hh, hw, hh, -hw, hh]

  return {
    shape: 'box',
    verts,
    norms: [0, -1, 1, 0, 0, 1, -1, 0],
    rad: 0,
    hw,
    hh,
    r: Math.hypot(hw, hh),
    area: w * h,
    I1: (w * h * (w * w + h * h)) / 12,
    artX: 0,
    artY: 0,
  }
}

/** The convex hull of points, counter-clockwise, flat. */
export function convexHull(pts: [number, number][]): number[] {
  const p = pts.filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1])).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return []
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 1e-9) lower.pop()
    lower.push(q)
  }
  const upper: [number, number][] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 1e-9) upper.pop()
    upper.push(q)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  // Too many corners: drop the one whose loss shrinks the outline least.
  while (hull.length > MAX_VERTS) {
    let worst = 0
    let least = Infinity
    for (let i = 0; i < hull.length; i++) {
      const a = hull[(i + hull.length - 1) % hull.length]!
      const b = hull[(i + 1) % hull.length]!
      const loss = Math.abs(cross(a, hull[i]!, b))
      if (loss < least) {
        least = loss
        worst = i
      }
    }
    hull.splice(worst, 1)
  }

  return hull.length >= 3 ? hull.flat() : []
}

/** Area, centroid and inertia about the centroid of a convex polygon at density 1. */
function polyMass(v: number[]): { area: number; cx: number; cy: number; I: number } {
  const sx = v[0]!
  const sy = v[1]!
  let area = 0
  let cx = 0
  let cy = 0
  let I = 0
  for (let i = 1; i < v.length / 2 - 1; i++) {
    const e1x = v[2 * i]! - sx
    const e1y = v[2 * i + 1]! - sy
    const e2x = v[2 * i + 2]! - sx
    const e2y = v[2 * i + 3]! - sy
    const D = e1x * e2y - e1y * e2x
    const tri = 0.5 * D
    area += tri
    cx += (tri * (e1x + e2x)) / 3
    cy += (tri * (e1y + e2y)) / 3
    I += (0.25 / 3) * D * (e1x * e1x + e2x * e1x + e2x * e2x + e1y * e1y + e2y * e1y + e2y * e2y)
  }
  if (area <= 1e-9) return { area: 0, cx: sx, cy: sy, I: 0 }
  cx /= area
  cy /= area

  return { area, cx: cx + sx, cy: cy + sy, I: I - area * (cx * cx + cy * cy) }
}

/** A convex polygon from points in some frame, recentered on its centroid. */
function polyInfo(pts: [number, number][], hw: number, hh: number): ShapeInfo | null {
  const hull = convexHull(pts)
  if (hull.length < 6) return null
  const m = polyMass(hull)
  if (m.area < 0.02) return null
  const verts: number[] = []
  let r = 0
  for (let i = 0; i < hull.length; i += 2) {
    const x = hull[i]! - m.cx
    const y = hull[i + 1]! - m.cy
    verts.push(x, y)
    r = Math.max(r, Math.hypot(x, y))
  }

  return {
    shape: 'poly',
    verts,
    norms: normalsOf(verts),
    rad: 0,
    hw,
    hh,
    r,
    area: m.area,
    I1: m.I,
    artX: -m.cx,
    artY: -m.cy,
  }
}

/** The outline a spec makes at a scale: its collision shape and where its art sits. */
export function shapeOf(spec: ShotSpec, scale = 1): ShapeInfo {
  const w = spec.width * scale
  const h = spec.height * scale
  if (spec.shape === 'circle') {
    const rad = Math.min(w, h) / 2

    return {
      shape: 'circle',
      verts: [],
      norms: [],
      rad,
      hw: w / 2,
      hh: h / 2,
      r: rad,
      area: Math.PI * rad * rad,
      I1: (Math.PI * rad * rad * rad * rad) / 2,
      artX: 0,
      artY: 0,
    }
  }
  if (spec.shape === 'polygon' && spec.points.length >= 3) {
    const poly = polyInfo(
      spec.points.map(([x, y]) => [x * scale, y * scale] as [number, number]),
      w / 2,
      h / 2,
    )
    if (poly) return poly
  }

  return boxInfo(w, h)
}

function specMass(spec: ShotSpec): number {
  return Math.max(0.005, spec.density * shapeOf(spec).area)
}

function hasTrait(b: Body, t: Trait): boolean {
  return b.spec !== null && b.spec.traits.includes(t)
}

// ---------------------------------------------------------------------------
// Bodies

function addBody(
  g: Game,
  kind: Kind,
  mat: Material,
  x: number,
  y: number,
  info: ShapeInfo,
  density: number,
  friction: number,
  color: number,
): Body {
  const isStatic = !Number.isFinite(density)
  const mass = isStatic ? Infinity : Math.max(0.005, density * info.area)
  const I = isStatic ? Infinity : Math.max(1e-4, density * info.I1)
  const body: Body = {
    ...info,
    id: g.nextId++,
    kind,
    mat,
    x,
    y,
    a: 0,
    vx: 0,
    vy: 0,
    av: 0,
    mass,
    invMass: isStatic ? 0 : 1 / mass,
    invI: isStatic ? 0 : 1 / I,
    friction,
    bounce: 0.05,
    color,
    strength: Infinity,
    hit: 0,
    wear: 0,
    dead: false,
    drag: 0,
    noGravity: 0,
    gscale: 1,
    trail: 0,
    stuck: false,
    shard: false,
    scale: 1,
    spec: null,
    ammoLeft: 0,
    ammoWait: 0,
    powerAt: -1,
    matter: INERT,
    fire: 0,
    kindle: 0,
    soak: 0,
    chill: 0,
    frost: 0,
    zap: 0,
    corrode: 0,
    fuse: -1,
    decay: 0,
  }
  g.bodies.push(body)

  return body
}

function makeBody(
  g: Game,
  kind: Kind,
  mat: Material,
  x: number,
  y: number,
  w: number,
  h: number,
  density: number,
  friction: number,
  color: number,
): Body {
  return addBody(g, kind, mat, x, y, boxInfo(w, h), density, friction, color)
}

type BlockMaterial = keyof typeof MATERIALS

/** A block of a material, its bottom edge resting at `bottom`. */
function block(g: Game, mat: BlockMaterial, cx: number, bottom: number, w: number, h: number): Body {
  const m = MATERIALS[mat]
  const b = makeBody(g, 'block', mat, cx, bottom + h / 2, w, h, m.density, m.friction, m.color)
  b.strength = m.strength
  b.matter = m.matter

  return b
}

function bug(g: Game, cx: number, bottom: number): Body {
  const b = makeBody(g, 'bug', 'bug', cx, bottom + 0.4, 0.9, 0.8, BUG.density, BUG.friction, BUG.color)
  b.strength = BUG.strength
  b.bounce = 0.2
  b.matter = BUG.matter

  return b
}

/** Two posts and a slab across them; answers the slab's top. */
function room(
  g: Game,
  cx: number,
  bottom: number,
  w: number,
  h: number,
  mat: BlockMaterial,
  slab: BlockMaterial = mat,
): number {
  block(g, mat, cx - w / 2 + 0.2, bottom, 0.4, h)
  block(g, mat, cx + w / 2 - 0.2, bottom, 0.4, h)
  block(g, slab, cx, bottom + h, w, 0.3)

  return bottom + h + 0.3
}

// ---------------------------------------------------------------------------
// Levels

type Level = { title: string; shots: number; build: (g: Game) => void }

const LEVELS: Level[] = [
  {
    title: 'Squash the bugs',
    shots: 3,
    build: g => {
      bug(g, 16, 0)
      const top = room(g, 16, 0, 2.6, 1.6, 'wood')
      bug(g, 16, top)
    },
  },
  {
    title: 'Glass houses',
    shots: 3,
    build: g => {
      bug(g, 14.5, 0)
      let top = room(g, 14.5, 0, 2.4, 1.5, 'wood')
      bug(g, 14.5, top)
      top = room(g, 14.5, top, 2.4, 1.4, 'glass')
      bug(g, 20, 0)
      top = room(g, 20, 0, 2.8, 1.8, 'glass', 'wood')
      bug(g, 20, top)
    },
  },
  {
    title: 'The stone keep',
    shots: 4,
    build: g => {
      bug(g, 15, 0)
      room(g, 15, 0, 2.4, 1.4, 'stone', 'wood')
      bug(g, 19.5, 0)
      let top = room(g, 19.5, 0, 3, 1.6, 'stone')
      bug(g, 19.5, top)
      top = room(g, 19.5, top, 2.2, 1.3, 'wood')
      bug(g, 19.5, top)
      bug(g, 23.5, 0)
    },
  },
  {
    title: 'Skyscraper',
    shots: 4,
    build: g => {
      let top = 0
      const mats: BlockMaterial[] = ['stone', 'wood', 'glass', 'wood']
      for (let i = 0; i < mats.length; i++) {
        bug(g, 18, top)
        top = room(g, 18, top, 3 - i * 0.2, 1.3, mats[i]!)
      }
      bug(g, 18, top)
      block(g, 'wood', 14.5, 0, 0.5, 2.2)
      block(g, 'wood', 21.5, 0, 0.5, 2.2)
    },
  },
  {
    title: 'The pyramid',
    shots: 4,
    build: g => {
      const size = 0.9
      for (let row = 0; row < 5; row++) {
        const n = 5 - row
        for (let i = 0; i < n; i++) {
          const x = 18 - ((n - 1) * size) / 2 + i * size
          const mat: BlockMaterial = row === 0 ? 'stone' : row % 2 ? 'wood' : 'glass'
          block(g, mat, x, row * size, size, size)
        }
      }
      bug(g, 18, 5 * size)
      bug(g, 13.8, 0)
      bug(g, 22.4, 0)
      room(g, 22.4, 0, 1.8, 1.2, 'glass')
    },
  },
]

/** A level past the handmade ones: towers drawn from a seeded generator. */
function generated(level: number): Level {
  let seed = level * 2654435761
  const rnd = () => {
    seed = (seed ^ (seed << 13)) >>> 0
    seed = (seed ^ (seed >>> 17)) >>> 0
    seed = (seed ^ (seed << 5)) >>> 0

    return seed / 4294967296
  }
  const towers = 2 + Math.floor(rnd() * 2)
  const mats: BlockMaterial[] = ['wood', 'glass', 'stone', 'wood']

  return {
    title: `Bug nest #${level}`,
    shots: 3 + Math.ceil(towers / 2),
    build: g => {
      // Towers side by side from x = 12, each a little apart, never touching.
      let left = 12 + rnd() * 1.5
      for (let t = 0; t < towers; t++) {
        const base = 2.4 + rnd() * 0.8
        const cx = left + base / 2
        if (cx + base / 2 > WORLD_W - 1) break
        const floors = 1 + Math.floor(rnd() * 3)
        let top = 0
        for (let f = 0; f < floors; f++) {
          bug(g, cx, top)
          top = room(g, cx, top, base - f * 0.25, 1.2 + rnd() * 0.5, mats[Math.floor(rnd() * mats.length)]!)
        }
        if (rnd() > 0.4) bug(g, cx, top)
        left = cx + base / 2 + 1 + rnd() * 1.5
      }
    },
  }
}

function levelOf(level: number): Level {
  return LEVELS[level - 1] ?? generated(level)
}

export function newGame(level: number, best: number): Game {
  const g: Game = {
    level: 1,
    title: '',
    score: 0,
    levelStartScore: 0,
    best,
    shots: 0,
    maxShots: 0,
    bodies: [],
    arbiters: new Map(),
    joints: [],
    effects: [],
    nextId: 0,
    time: 0,
    phase: 'settling',
    phaseTime: 0,
    calmTicks: 0,
    lastKill: 0,
    loaded: null,
    consumed: new Set(),
    forge: { status: 'idle' },
    abilityUsed: false,
    activeAbility: 'none',
    active: new Set(),
    aim: { x: 0, y: 0 },
    drag: null,
    holdOnRelease: false,
    particles: [],
    path: [],
    pathDone: true,
    forgeSince: -1,
    loadedAt: -1,
    eaten: -1,
    pellets: [],
    banner: null,
    frame: 0,
    events: [],
    view: { s: 4, ox: 0, PW: 104, PH: 52 },
  }
  loadLevel(g, Math.max(1, Math.floor(level)))

  return g
}

export function loadLevel(g: Game, level: number): void {
  const spec = levelOf(level)
  g.level = level
  g.title = spec.title
  g.levelStartScore = g.score
  g.shots = spec.shots
  g.maxShots = spec.shots
  g.bodies = []
  g.arbiters = new Map()
  g.joints = []
  g.effects = []
  g.time = 0
  g.phase = 'settling'
  g.phaseTime = 0
  g.calmTicks = 0
  g.abilityUsed = false
  g.activeAbility = 'none'
  g.active = new Set()
  g.aim = { x: 0, y: 0 }
  g.drag = null
  g.particles = []
  g.path = []
  g.pellets = []
  const ground = makeBody(g, 'ground', 'ground', WORLD_W / 2, -5, 400, 10, Infinity, 0.8, 0x4a3524)
  ground.r = 400
  spec.build(g)
  setBanner(g, `Level ${level}: ${spec.title}`, 70)
}

export function bugsLeft(g: Game): number {
  let n = 0
  for (const b of g.bodies) if (b.kind === 'bug' && !b.dead) n++

  return n
}

// ---------------------------------------------------------------------------
// Collision: box against box, as Box2D-lite clips it.

type CV = { x: number; y: number; i1: number; o1: number; i2: number; o2: number }

const packFp = (v: CV) => v.i1 | (v.o1 << 4) | (v.i2 << 8) | (v.o2 << 12)

function clip(vIn: CV[], nx: number, ny: number, offset: number, edge: number): CV[] {
  const out: CV[] = []
  const v0 = vIn[0]!
  const v1 = vIn[1]!
  const d0 = nx * v0.x + ny * v0.y - offset
  const d1 = nx * v1.x + ny * v1.y - offset
  if (d0 <= 0) out.push(v0)
  if (d1 <= 0) out.push(v1)
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1)
    const p: CV = d0 > 0 ? { ...v0, i1: edge, i2: 0 } : { ...v1, o1: edge, o2: 0 }
    p.x = v0.x + t * (v1.x - v0.x)
    p.y = v0.y + t * (v1.y - v0.y)
    out.push(p)
  }

  return out
}

function incidentEdge(
  hx: number,
  hy: number,
  px: number,
  py: number,
  c: number,
  s: number,
  nx: number,
  ny: number,
): CV[] {
  // The reference normal in the incident box's frame, flipped.
  const lx = -(c * nx + s * ny)
  const ly = -(-s * nx + c * ny)
  let v: [CV, CV]
  if (Math.abs(lx) > Math.abs(ly)) {
    v =
      lx >= 0
        ? [
            { x: hx, y: -hy, i1: 0, o1: 0, i2: 3, o2: 4 },
            { x: hx, y: hy, i1: 0, o1: 0, i2: 4, o2: 1 },
          ]
        : [
            { x: -hx, y: hy, i1: 0, o1: 0, i2: 1, o2: 2 },
            { x: -hx, y: -hy, i1: 0, o1: 0, i2: 2, o2: 3 },
          ]
  } else {
    v =
      ly >= 0
        ? [
            { x: hx, y: hy, i1: 0, o1: 0, i2: 4, o2: 1 },
            { x: -hx, y: hy, i1: 0, o1: 0, i2: 1, o2: 2 },
          ]
        : [
            { x: -hx, y: -hy, i1: 0, o1: 0, i2: 2, o2: 3 },
            { x: hx, y: -hy, i1: 0, o1: 0, i2: 3, o2: 4 },
          ]
  }
  for (const p of v) {
    const x = p.x
    p.x = px + c * x - s * p.y
    p.y = py + s * x + c * p.y
  }

  return v
}

function contact(x: number, y: number, nx: number, ny: number, sep: number, fp: number): Contact {
  return { x, y, nx, ny, sep, fp, Pn: 0, Pt: 0, mn: 0, mt: 0, bias: 0 }
}

function collideBoxes(A: Body, B: Body): Contact[] {
  const hAx = A.hw
  const hAy = A.hh
  const hBx = B.hw
  const hBy = B.hh
  const cA = Math.cos(A.a)
  const sA = Math.sin(A.a)
  const cB = Math.cos(B.a)
  const sB = Math.sin(B.a)
  const dpx = B.x - A.x
  const dpy = B.y - A.y
  const dAx = cA * dpx + sA * dpy
  const dAy = -sA * dpx + cA * dpy
  const dBx = cB * dpx + sB * dpy
  const dBy = -sB * dpx + cB * dpy
  // C = RotA^T * RotB, as absolute values.
  const a11 = Math.abs(cA * cB + sA * sB)
  const a21 = Math.abs(-sA * cB + cA * sB)
  const a12 = Math.abs(-cA * sB + sA * cB)
  const a22 = Math.abs(sA * sB + cA * cB)

  const faceAx = Math.abs(dAx) - hAx - (a11 * hBx + a12 * hBy)
  const faceAy = Math.abs(dAy) - hAy - (a21 * hBx + a22 * hBy)
  if (faceAx > 0 || faceAy > 0) return []
  const faceBx = Math.abs(dBx) - (a11 * hAx + a21 * hAy) - hBx
  const faceBy = Math.abs(dBy) - (a12 * hAx + a22 * hAy) - hBy
  if (faceBx > 0 || faceBy > 0) return []

  let axis = 0
  let sep = faceAx
  let nx = dAx > 0 ? cA : -cA
  let ny = dAx > 0 ? sA : -sA
  const relTol = 0.95
  const absTol = 0.01
  if (faceAy > relTol * sep + absTol * hAy) {
    axis = 1
    sep = faceAy
    nx = dAy > 0 ? -sA : sA
    ny = dAy > 0 ? cA : -cA
  }
  if (faceBx > relTol * sep + absTol * hBx) {
    axis = 2
    sep = faceBx
    nx = dBx > 0 ? cB : -cB
    ny = dBx > 0 ? sB : -sB
  }
  if (faceBy > relTol * sep + absTol * hBy) {
    axis = 3
    sep = faceBy
    nx = dBy > 0 ? -sB : sB
    ny = dBy > 0 ? cB : -cB
  }

  let fnx: number
  let fny: number
  let front: number
  let snx: number
  let sny: number
  let negSide: number
  let posSide: number
  let negEdge: number
  let posEdge: number
  let inc: CV[]
  if (axis === 0 || axis === 1) {
    fnx = nx
    fny = ny
    if (axis === 0) {
      front = A.x * fnx + A.y * fny + hAx
      snx = -sA
      sny = cA
      const side = A.x * snx + A.y * sny
      negSide = -side + hAy
      posSide = side + hAy
      negEdge = 3
      posEdge = 1
    } else {
      front = A.x * fnx + A.y * fny + hAy
      snx = cA
      sny = sA
      const side = A.x * snx + A.y * sny
      negSide = -side + hAx
      posSide = side + hAx
      negEdge = 2
      posEdge = 4
    }
    inc = incidentEdge(hBx, hBy, B.x, B.y, cB, sB, fnx, fny)
  } else {
    fnx = -nx
    fny = -ny
    if (axis === 2) {
      front = B.x * fnx + B.y * fny + hBx
      snx = -sB
      sny = cB
      const side = B.x * snx + B.y * sny
      negSide = -side + hBy
      posSide = side + hBy
      negEdge = 3
      posEdge = 1
    } else {
      front = B.x * fnx + B.y * fny + hBy
      snx = cB
      sny = sB
      const side = B.x * snx + B.y * sny
      negSide = -side + hBx
      posSide = side + hBx
      negEdge = 2
      posEdge = 4
    }
    inc = incidentEdge(hAx, hAy, A.x, A.y, cA, sA, fnx, fny)
  }

  const cp1 = clip(inc, -snx, -sny, negSide, negEdge)
  if (cp1.length < 2) return []
  const cp2 = clip(cp1, snx, sny, posSide, posEdge)
  if (cp2.length < 2) return []

  const out: Contact[] = []
  for (const v of cp2) {
    const s = fnx * v.x + fny * v.y - front
    if (s <= 0) {
      const fv = axis >= 2 ? { ...v, i1: v.i2, i2: v.i1, o1: v.o2, o2: v.o1 } : v
      out.push(contact(v.x - s * fnx, v.y - s * fny, nx, ny, s, packFp(fv)))
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Collision: any convex polygon (a box among them) and circles, as Box2D's
// b2CollidePolygons and b2CollidePolygonAndCircle. Normals point from A to B.

/** A body's vertex i in world space. */
function worldVert(b: Body, i: number, c: number, s: number): { x: number; y: number } {
  const vx = b.verts[2 * i]!
  const vy = b.verts[2 * i + 1]!

  return { x: b.x + c * vx - s * vy, y: b.y + s * vx + c * vy }
}

/** The edge of A that B lies farthest outside of, and how far. */
function maxSeparation(A: Body, B: Body): { sep: number; edge: number } {
  const cA = Math.cos(A.a)
  const sA = Math.sin(A.a)
  const cB = Math.cos(B.a)
  const sB = Math.sin(B.a)
  const nB = B.verts.length / 2
  const bx: number[] = []
  const by: number[] = []
  for (let j = 0; j < nB; j++) {
    const w = worldVert(B, j, cB, sB)
    const dx = w.x - A.x
    const dy = w.y - A.y
    bx.push(cA * dx + sA * dy)
    by.push(-sA * dx + cA * dy)
  }
  let best = -Infinity
  let edge = 0
  for (let i = 0; i < A.verts.length / 2; i++) {
    const nx = A.norms[2 * i]!
    const ny = A.norms[2 * i + 1]!
    const vx = A.verts[2 * i]!
    const vy = A.verts[2 * i + 1]!
    let si = Infinity
    for (let j = 0; j < nB; j++) si = Math.min(si, nx * (bx[j]! - vx) + ny * (by[j]! - vy))
    if (si > best) {
      best = si
      edge = i
    }
  }

  return { sep: best, edge }
}

type CP = { x: number; y: number; id: number }

function clipSegment(vIn: CP[], nx: number, ny: number, offset: number, id: number): CP[] {
  const out: CP[] = []
  const v0 = vIn[0]!
  const v1 = vIn[1]!
  const d0 = nx * v0.x + ny * v0.y - offset
  const d1 = nx * v1.x + ny * v1.y - offset
  if (d0 <= 0) out.push(v0)
  if (d1 <= 0) out.push(v1)
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1)
    out.push({ x: v0.x + t * (v1.x - v0.x), y: v0.y + t * (v1.y - v0.y), id })
  }

  return out
}

function collidePolys(A: Body, B: Body): Contact[] {
  const sa = maxSeparation(A, B)
  if (sa.sep > 0) return []
  const sb = maxSeparation(B, A)
  if (sb.sep > 0) return []
  const flip = sb.sep > 0.98 * sa.sep + 0.001
  const ref = flip ? B : A
  const inc = flip ? A : B
  const edge = flip ? sb.edge : sa.edge
  const cR = Math.cos(ref.a)
  const sR = Math.sin(ref.a)
  const cI = Math.cos(inc.a)
  const sI = Math.sin(inc.a)
  const nRef = ref.verts.length / 2
  const nInc = inc.verts.length / 2

  // The incident edge: the one facing the reference edge most squarely.
  const rnx = ref.norms[2 * edge]!
  const rny = ref.norms[2 * edge + 1]!
  const wnx = cR * rnx - sR * rny
  const wny = sR * rnx + cR * rny
  let ie = 0
  let least = Infinity
  for (let k = 0; k < nInc; k++) {
    const nx = inc.norms[2 * k]!
    const ny = inc.norms[2 * k + 1]!
    const d = wnx * (cI * nx - sI * ny) + wny * (sI * nx + cI * ny)
    if (d < least) {
      least = d
      ie = k
    }
  }
  const ie2 = (ie + 1) % nInc
  const i1 = worldVert(inc, ie, cI, sI)
  const i2 = worldVert(inc, ie2, cI, sI)
  const r1 = worldVert(ref, edge, cR, sR)
  const r2 = worldVert(ref, (edge + 1) % nRef, cR, sR)
  const len = Math.hypot(r2.x - r1.x, r2.y - r1.y) || 1
  const tx = (r2.x - r1.x) / len
  const ty = (r2.y - r1.y) / len
  const nx = ty
  const ny = -tx
  const front = nx * r1.x + ny * r1.y

  const cp1 = clipSegment([{ ...i1, id: ie }, { ...i2, id: ie2 }], -tx, -ty, -(tx * r1.x + ty * r1.y), 16)
  if (cp1.length < 2) return []
  const cp2 = clipSegment(cp1, tx, ty, tx * r2.x + ty * r2.y, 17)
  if (cp2.length < 2) return []

  const out: Contact[] = []
  for (const p of cp2) {
    const s = nx * p.x + ny * p.y - front
    if (s > 0) continue
    const fp = (flip ? 1 : 0) | (edge << 1) | (ie << 5) | (p.id << 9)
    out.push(contact(p.x - s * nx, p.y - s * ny, flip ? -nx : nx, flip ? -ny : ny, s, fp))
  }

  return out
}

function collidePolyCircle(P: Body, C: Body): Contact[] {
  const c = Math.cos(P.a)
  const s = Math.sin(P.a)
  const dx = C.x - P.x
  const dy = C.y - P.y
  const lx = c * dx + s * dy
  const ly = -s * dx + c * dy
  const n = P.verts.length / 2
  let most = -Infinity
  let e = 0
  for (let i = 0; i < n; i++) {
    const d = P.norms[2 * i]! * (lx - P.verts[2 * i]!) + P.norms[2 * i + 1]! * (ly - P.verts[2 * i + 1]!)
    if (d > C.rad) return []
    if (d > most) {
      most = d
      e = i
    }
  }
  const v1x = P.verts[2 * e]!
  const v1y = P.verts[2 * e + 1]!
  const e2 = (e + 1) % n
  const v2x = P.verts[2 * e2]!
  const v2y = P.verts[2 * e2 + 1]!
  let nlx = P.norms[2 * e]!
  let nly = P.norms[2 * e + 1]!
  let px = lx - nlx * most
  let py = ly - nly * most
  let sep = most - C.rad
  let feature = e * 4
  if (most > 1e-6) {
    const u1 = (lx - v1x) * (v2x - v1x) + (ly - v1y) * (v2y - v1y)
    const u2 = (lx - v2x) * (v1x - v2x) + (ly - v2y) * (v1y - v2y)
    const corner = u1 <= 0 ? [v1x, v1y] : u2 <= 0 ? [v2x, v2y] : null
    if (corner) {
      const qx = lx - corner[0]!
      const qy = ly - corner[1]!
      const dist = Math.hypot(qx, qy)
      if (dist > C.rad) return []
      nlx = dist > 1e-9 ? qx / dist : nlx
      nly = dist > 1e-9 ? qy / dist : nly
      px = corner[0]!
      py = corner[1]!
      sep = dist - C.rad
      feature += u1 <= 0 ? 1 : 2
    }
  }
  const wx = P.x + c * px - s * py
  const wy = P.y + s * px + c * py

  return [contact(wx, wy, c * nlx - s * nly, s * nlx + c * nly, sep, feature)]
}

function collideCircles(A: Body, B: Body): Contact[] {
  const dx = B.x - A.x
  const dy = B.y - A.y
  const d = Math.hypot(dx, dy)
  if (d > A.rad + B.rad) return []
  const nx = d > 1e-9 ? dx / d : 0
  const ny = d > 1e-9 ? dy / d : 1
  const sep = d - A.rad - B.rad

  return [contact(A.x + nx * (A.rad + sep / 2), A.y + ny * (A.rad + sep / 2), nx, ny, sep, 0)]
}

function collide(A: Body, B: Body): Contact[] {
  if (A.shape === 'box' && B.shape === 'box') return collideBoxes(A, B)
  if (A.shape === 'circle' && B.shape === 'circle') return collideCircles(A, B)
  if (B.shape === 'circle') return collidePolyCircle(A, B)
  if (A.shape === 'circle') {
    // Found from B's side, so the normal turns round to point from A to B.
    return collidePolyCircle(B, A).map(c => ({ ...c, nx: -c.nx, ny: -c.ny }))
  }

  return collidePolys(A, B)
}

// ---------------------------------------------------------------------------
// Solver

/**
 * Readies the contacts for this step and answers the impact they carry: for
 * each contact closing faster than a resting one, the impulse it takes to
 * stop it (closing speed times effective mass). Resting weight counts nothing,
 * so a tower holds itself up and only a blow breaks it.
 *
 * Every arbiter is readied before any is warm started (warmStart), so the
 * closing speeds read here are the bodies' own, not a neighbour's last push.
 */
function preStep(arb: Arbiter, invDt: number): number {
  const a = arb.a
  const b = arb.b
  let impact = 0
  for (const c of arb.cs) {
    const r1x = c.x - a.x
    const r1y = c.y - a.y
    const r2x = c.x - b.x
    const r2y = c.y - b.y
    const rn1 = r1x * c.nx + r1y * c.ny
    const rn2 = r2x * c.nx + r2y * c.ny
    const kN =
      a.invMass +
      b.invMass +
      a.invI * (r1x * r1x + r1y * r1y - rn1 * rn1) +
      b.invI * (r2x * r2x + r2y * r2y - rn2 * rn2)
    c.mn = 1 / kN
    const tx = c.ny
    const ty = -c.nx
    const rt1 = r1x * tx + r1y * ty
    const rt2 = r2x * tx + r2y * ty
    const kT =
      a.invMass +
      b.invMass +
      a.invI * (r1x * r1x + r1y * r1y - rt1 * rt1) +
      b.invI * (r2x * r2x + r2y * r2y - rt2 * rt2)
    c.mt = 1 / kT
    c.bias = -0.2 * invDt * Math.min(0, c.sep + 0.01)

    // Restitution: a closing speed worth bouncing becomes a target speed.
    const dvx = b.vx - b.av * r2y - a.vx + a.av * r1y
    const dvy = b.vy + b.av * r2x - a.vy - a.av * r1x
    const vn = dvx * c.nx + dvy * c.ny
    if (vn < -1.5) c.bias = Math.max(c.bias, -arb.bounce * vn)
    if (vn < -0.8) impact += -vn * c.mn
  }

  return impact
}

/** Applies last step's impulses again, so stacks start the step near rest. */
function warmStart(arb: Arbiter): void {
  const a = arb.a
  const b = arb.b
  for (const c of arb.cs) {
    const r1x = c.x - a.x
    const r1y = c.y - a.y
    const r2x = c.x - b.x
    const r2y = c.y - b.y
    const tx = c.ny
    const ty = -c.nx
    const Px = c.Pn * c.nx + c.Pt * tx
    const Py = c.Pn * c.ny + c.Pt * ty
    a.vx -= a.invMass * Px
    a.vy -= a.invMass * Py
    a.av -= a.invI * (r1x * Py - r1y * Px)
    b.vx += b.invMass * Px
    b.vy += b.invMass * Py
    b.av += b.invI * (r2x * Py - r2y * Px)
  }
}

function applyImpulse(arb: Arbiter): void {
  const a = arb.a
  const b = arb.b
  for (const c of arb.cs) {
    const r1x = c.x - a.x
    const r1y = c.y - a.y
    const r2x = c.x - b.x
    const r2y = c.y - b.y

    let dvx = b.vx - b.av * r2y - a.vx + a.av * r1y
    let dvy = b.vy + b.av * r2x - a.vy - a.av * r1x
    const vn = dvx * c.nx + dvy * c.ny
    let dPn = c.mn * (-vn + c.bias)
    const Pn0 = c.Pn
    c.Pn = Math.max(Pn0 + dPn, 0)
    dPn = c.Pn - Pn0
    let Px = dPn * c.nx
    let Py = dPn * c.ny
    a.vx -= a.invMass * Px
    a.vy -= a.invMass * Py
    a.av -= a.invI * (r1x * Py - r1y * Px)
    b.vx += b.invMass * Px
    b.vy += b.invMass * Py
    b.av += b.invI * (r2x * Py - r2y * Px)

    dvx = b.vx - b.av * r2y - a.vx + a.av * r1y
    dvy = b.vy + b.av * r2x - a.vy - a.av * r1x
    const tx = c.ny
    const ty = -c.nx
    const vt = dvx * tx + dvy * ty
    let dPt = c.mt * -vt
    const maxPt = arb.friction * c.Pn
    const Pt0 = c.Pt
    c.Pt = Math.max(-maxPt, Math.min(maxPt, Pt0 + dPt))
    dPt = c.Pt - Pt0
    Px = dPt * tx
    Py = dPt * ty
    a.vx -= a.invMass * Px
    a.vy -= a.invMass * Py
    a.av -= a.invI * (r1x * Py - r1y * Px)
    b.vx += b.invMass * Px
    b.vy += b.invMass * Py
    b.av += b.invI * (r2x * Py - r2y * Px)
  }
}

function makeJoint(a: Body, b: Body, x: number, y: number): Joint {
  const local = (body: Body) => {
    const c = Math.cos(body.a)
    const s = Math.sin(body.a)
    const dx = x - body.x
    const dy = y - body.y

    return { x: c * dx + s * dy, y: -s * dx + c * dy }
  }
  const la = local(a)
  const lb = local(b)

  return {
    a,
    b,
    lax: la.x,
    lay: la.y,
    lbx: lb.x,
    lby: lb.y,
    r1x: 0,
    r1y: 0,
    r2x: 0,
    r2y: 0,
    m11: 0,
    m12: 0,
    m21: 0,
    m22: 0,
    biasX: 0,
    biasY: 0,
    Px: 0,
    Py: 0,
  }
}

/** Where a joint's pin is now, as each body carries it. */
export function jointAnchor(j: Joint): { x: number; y: number } {
  const c = Math.cos(j.a.a)
  const s = Math.sin(j.a.a)

  return { x: j.a.x + c * j.lax - s * j.lay, y: j.a.y + s * j.lax + c * j.lay }
}

function jointPreStep(j: Joint, invDt: number): void {
  const a = j.a
  const b = j.b
  const c1 = Math.cos(a.a)
  const s1 = Math.sin(a.a)
  const c2 = Math.cos(b.a)
  const s2 = Math.sin(b.a)
  j.r1x = c1 * j.lax - s1 * j.lay
  j.r1y = s1 * j.lax + c1 * j.lay
  j.r2x = c2 * j.lbx - s2 * j.lby
  j.r2y = s2 * j.lbx + c2 * j.lby
  const k11 = a.invMass + b.invMass + a.invI * j.r1y * j.r1y + b.invI * j.r2y * j.r2y
  const k12 = -a.invI * j.r1x * j.r1y - b.invI * j.r2x * j.r2y
  const k22 = a.invMass + b.invMass + a.invI * j.r1x * j.r1x + b.invI * j.r2x * j.r2x
  const det = k11 * k22 - k12 * k12
  const inv = Math.abs(det) > 1e-12 ? 1 / det : 0
  j.m11 = inv * k22
  j.m12 = -inv * k12
  j.m21 = -inv * k12
  j.m22 = inv * k11
  const dx = b.x + j.r2x - a.x - j.r1x
  const dy = b.y + j.r2y - a.y - j.r1y
  j.biasX = -0.2 * invDt * dx
  j.biasY = -0.2 * invDt * dy
  a.vx -= a.invMass * j.Px
  a.vy -= a.invMass * j.Py
  a.av -= a.invI * (j.r1x * j.Py - j.r1y * j.Px)
  b.vx += b.invMass * j.Px
  b.vy += b.invMass * j.Py
  b.av += b.invI * (j.r2x * j.Py - j.r2y * j.Px)
}

function jointImpulse(j: Joint): void {
  const a = j.a
  const b = j.b
  const dvx = b.vx - b.av * j.r2y - a.vx + a.av * j.r1y
  const dvy = b.vy + b.av * j.r2x - a.vy - a.av * j.r1x
  const ix = j.m11 * (j.biasX - dvx) + j.m12 * (j.biasY - dvy)
  const iy = j.m21 * (j.biasX - dvx) + j.m22 * (j.biasY - dvy)
  a.vx -= a.invMass * ix
  a.vy -= a.invMass * iy
  a.av -= a.invI * (j.r1x * iy - j.r1y * ix)
  b.vx += b.invMass * ix
  b.vy += b.invMass * iy
  b.av += b.invI * (j.r2x * iy - j.r2y * ix)
  j.Px += ix
  j.Py += iy
}

/** A piercing shot moving fast enough, and the wood, glass or bug it would run through. */
function pierced(A: Body, B: Body): { shot: Body; victim: Body } | null {
  const pair = A.kind === 'shot' ? { shot: A, victim: B } : B.kind === 'shot' ? { shot: B, victim: A } : null
  if (!pair || !hasTrait(pair.shot, 'piercing')) return null
  const v = pair.victim
  if (v.kind !== 'bug' && !(v.kind === 'block' && (v.mat === 'wood' || v.mat === 'glass'))) return null

  return Math.hypot(pair.shot.vx, pair.shot.vy) > 4 ? pair : null
}

/** A sticky shot that has not stuck yet, and what it touched. */
function stickyPair(A: Body, B: Body): { shot: Body; other: Body } | null {
  const pair = A.kind === 'shot' ? { shot: A, other: B } : B.kind === 'shot' ? { shot: B, other: A } : null
  if (!pair || pair.other.kind === 'shot' || pair.shot.stuck || !hasTrait(pair.shot, 'sticky')) return null

  return pair
}

/** Magnets tug on blocks and bugs while their turn runs. */
function magnetism(g: Game): void {
  if (g.phase !== 'flying') return
  for (const m of g.bodies) {
    if (m.kind !== 'shot' || m.dead || !hasTrait(m, 'magnetic')) continue
    for (const b of g.bodies) {
      if (b === m || b.invMass === 0 || b.dead || b.kind === 'shot') continue
      const dx = m.x - b.x
      const dy = m.y - b.y
      const d = Math.hypot(dx, dy)
      if (d > 6 || d < 1e-3) continue
      // Falling off with distance, not its square: strong enough at a few
      // meters to beat the friction holding a stone post down.
      const pull = b.mat === 'stone' ? 1 : b.mat === 'wood' ? 0.4 : b.mat === 'bug' ? 0.35 : 0.25
      const f = (50 * pull) / Math.max(0.7, d)
      const dvb = Math.min(0.6, f * DT * b.invMass)
      b.vx += (dx / d) * dvb
      b.vy += (dy / d) * dvb
      const dvm = Math.min(0.3, f * DT * m.invMass)
      m.vx -= (dx / d) * dvm
      m.vy -= (dy / d) * dvm
    }
  }
}

/** Vortices drag everything near into a spin and grind what reaches the eye. */
function stepEffects(g: Game): void {
  for (const fx of g.effects) {
    fx.t += DT
    if (fx.kind !== 'vortex') continue
    const fade = Math.max(0, 1 - fx.t / fx.life)
    for (const b of g.bodies) {
      if (b.invMass === 0 || b.dead) continue
      const dx = fx.x - b.x
      const dy = fx.y - b.y
      const d = Math.hypot(dx, dy)
      if (d > fx.r || d < 1e-3) continue
      const f = (1 - d / fx.r) * fade
      const ux = dx / d
      const uy = dy / d
      b.vx += (ux * 28 - uy * 14) * f * DT
      b.vy += (uy * 28 + ux * 14) * f * DT - GRAVITY * 0.7 * f * DT
      b.av += 6 * f * DT
      if (d < 1.4 && b.kind !== 'shot') b.wear += 0.06 * fade
    }
  }
  if (g.effects.some(fx => fx.t >= fx.life)) g.effects = g.effects.filter(fx => fx.t < fx.life)
}

function physicsStep(g: Game): void {
  const bodies = g.bodies
  const invDt = 1 / DT

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i]!
      const B = bodies[j]!
      if (A.invMass === 0 && B.invMass === 0) continue
      if (A.dead || B.dead) continue
      const [b1, b2] = A.id < B.id ? [A, B] : [B, A]
      const key = b1.id * 1_000_000 + b2.id
      const dx = A.x - B.x
      const dy = A.y - B.y
      const reach = A.r + B.r
      const cs = dx * dx + dy * dy > reach * reach && A.kind !== 'ground' && B.kind !== 'ground' ? [] : collide(b1, b2)
      if (cs.length === 0) {
        g.arbiters.delete(key)
        continue
      }
      const through = g.time > GRACE ? pierced(b1, b2) : null
      if (through) {
        destroy(g, through.victim)
        const k = through.victim.mat === 'glass' ? 0.93 : through.victim.mat === 'wood' ? 0.82 : 0.9
        through.shot.vx *= k
        through.shot.vy *= k
        g.arbiters.delete(key)
        continue
      }
      const old = g.arbiters.get(key)
      if (old) {
        for (const c of cs) {
          const prev = old.cs.find(o => o.fp === c.fp)
          if (prev) {
            c.Pn = prev.Pn
            c.Pt = prev.Pt
          }
        }
        old.cs = cs
      } else {
        g.arbiters.set(key, {
          a: b1,
          b: b2,
          cs,
          friction: Math.sqrt(b1.friction * b2.friction),
          bounce: Math.max(b1.bounce, b2.bounce),
        })
        const glue = g.time > GRACE ? stickyPair(b1, b2) : null
        if (glue) {
          const at = cs[0]!
          g.joints.push(makeJoint(glue.shot, glue.other, at.x, at.y))
          glue.shot.stuck = true
          burst(g, at.x, at.y, 10, [0x9be564, 0xd4ff8a, 0xffffff], 2.5)
        }
      }
    }
  }

  for (const b of bodies) {
    if (b.invMass === 0) continue
    if (b.noGravity > 0) b.noGravity -= DT
    else b.vy += GRAVITY * b.gscale * DT
    if (b.drag > 0) {
      const sp = Math.hypot(b.vx, b.vy)
      const k = 1 - Math.min(0.5, b.drag * sp * DT)
      b.vx *= k
      b.vy *= k
    }
  }
  magnetism(g)
  stepEffects(g)

  const isLive = g.time > GRACE
  for (const arb of g.arbiters.values()) {
    const impact = preStep(arb, invDt)
    if (isLive && impact > 0) {
      arb.a.hit += impact
      arb.b.hit += impact
      // A hard landing kicks up dust where it lands.
      if (impact > 2.5 && (arb.a.kind === 'ground' || arb.b.kind === 'ground')) {
        const c = arb.cs[0]!
        puff(g, c.x, Math.max(0.1, c.y), Math.min(4, 1 + Math.round(impact / 4)), 0x8a7a66, 0.8, 0.4, 1.4)
      }
    }
  }
  for (const arb of g.arbiters.values()) warmStart(arb)
  for (const j of g.joints) jointPreStep(j, invDt)
  for (let it = 0; it < ITERATIONS; it++) {
    for (const arb of g.arbiters.values()) applyImpulse(arb)
    for (const j of g.joints) jointImpulse(j)
  }

  for (const b of bodies) {
    if (b.invMass === 0) continue
    b.x += DT * b.vx
    b.y += DT * b.vy
    b.a += DT * b.av
  }
}

// ---------------------------------------------------------------------------
// Rules

function setBanner(g: Game, text: string, ticks: number): void {
  g.banner = { text, until: g.frame + ticks }
}

/** The power going off, by the Forge's name for it, or `fallback`. */
function shout(g: Game, src: Body, fallback: string, ticks = 25): void {
  const name = src.spec?.power?.name
  setBanner(g, name ? `${name}!` : fallback, ticks)
}

/** At most this many particles at once; the oldest go first. */
const MAX_PARTICLES = 240

function particle(g: Game, kind: ParticleKind, x: number, y: number, vx: number, vy: number, life: number, color: number, size: number, spin = 0): void {
  g.particles.push({ kind, x, y, vx, vy, life, max: life, color, size, spin })
  if (g.particles.length > MAX_PARTICLES) g.particles.splice(0, g.particles.length - MAX_PARTICLES)
}

/** Sparks flying every way from a point, a little upward. */
function burst(g: Game, x: number, y: number, n: number, colors: number[], speed: number): void {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2
    const sp = speed * (0.3 + Math.random() * 0.7)
    particle(g, 'spark', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp + speed * 0.3, 0.35 + Math.random() * 0.5, colors[i % colors.length]!, 0.06 + Math.random() * 0.06)
  }
}

/** Puffs of smoke, dust or steam over a patch `spread` meters wide, each about `size` across. */
function puff(g: Game, x: number, y: number, n: number, color: number, spread: number, size: number, speed = 1): void {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2
    const r = Math.random() * spread * 0.5
    particle(
      g,
      'smoke',
      x + Math.cos(ang) * r,
      y + Math.sin(ang) * r * 0.6,
      Math.cos(ang) * speed * (0.5 + Math.random()),
      Math.sin(ang) * speed * 0.5 + 0.4,
      0.7 + Math.random() * 0.6,
      color,
      size * (0.7 + Math.random() * 0.6),
    )
  }
}

/** Pieces of a broken body flying out of where it was, tumbling. */
function debris(g: Game, b: Body, n: number, colors: number[]): void {
  const c = Math.cos(b.a)
  const s = Math.sin(b.a)
  for (let i = 0; i < n; i++) {
    const lx = (Math.random() * 2 - 1) * b.hw * 0.8
    const ly = (Math.random() * 2 - 1) * b.hh * 0.8
    const x = b.x + c * lx - s * ly
    const y = b.y + s * lx + c * ly
    const out = Math.hypot(x - b.x, y - b.y) || 1
    const sp = 1.5 + Math.random() * 3
    particle(
      g,
      'chunk',
      x,
      y,
      b.vx * 0.4 + ((x - b.x) / out) * sp,
      b.vy * 0.4 + ((y - b.y) / out) * sp + 2 + Math.random() * 2,
      0.9 + Math.random() * 0.6,
      colors[i % colors.length]!,
      Math.min(0.32, 0.1 + Math.random() * 0.12 + Math.min(b.hw, b.hh) * 0.15),
      (Math.random() - 0.5) * 18,
    )
  }
}

/** Points won, rising from where they were won. */
function popup(g: Game, x: number, y: number, text: string, color: number): void {
  g.effects.push({ kind: 'score', x, y, t: 0, life: 1.1, r: 0, color, text })
}

/** An explosion's look: a flash, a fireball of radius `R`, a shockwave, smoke left hanging and sparks. */
function fireball(g: Game, x: number, y: number, R: number): void {
  g.effects.push({ kind: 'blast', x, y, t: 0, life: 0.5, r: R, color: 0xff9f1c })
  ring(g, x, y, R, 0xffd8a8, 0.35)
  for (const tone of [0x3a3a46, 0x5a5a66]) puff(g, x, y, Math.min(5, Math.round(1 + R)), tone, R * 1.2, 0.3 + R * 0.1, 1.8)
  burst(g, x, y, Math.min(22, Math.round(6 + 4 * R)), [0xffe066, 0xff9f1c, 0xffffff], 4 + 2.5 * R)
}

function ring(g: Game, x: number, y: number, r: number, color: number, life = 0.45): void {
  g.effects.push({ kind: 'ring', x, y, t: 0, life, r, color })
}

function destroy(g: Game, b: Body): void {
  if (b.dead) return
  b.dead = true
  spill(g, b)
  if (b.kind === 'bug') {
    g.score += BUG.points
    g.lastKill = g.phaseTime
    burst(g, b.x, b.y, 8, [BUG.color, 0xffffff], 4)
    puff(g, b.x, b.y, 3, 0xd9a7e6, 0.6, 0.45, 1.2)
    popup(g, b.x, b.y + 0.5, `+${BUG.points}`, 0xffd166)
    const left = bugsLeft(g)
    setBanner(g, left > 0 ? `Bug squashed! +${BUG.points}  (${left} left)` : 'Last bug squashed!', 40)
  } else if (b.kind === 'block' && b.mat in MATERIALS) {
    const m = MATERIALS[b.mat as BlockMaterial]
    g.score += m.points
    const n = Math.min(12, 3 + Math.round(b.hw * b.hh * 12))
    debris(g, b, n, b.fire > 0 ? [0x3a2a20, 0x5c5c66] : b.mat === 'glass' ? [m.color, 0xe4f7ff] : [m.color, m.edge, shade(m.color, 1.15)])
    puff(g, b.x, b.y, b.mat === 'glass' ? 1 : 2, b.fire > 0 ? 0x4a4a52 : b.mat === 'stone' ? 0x9a9aa4 : 0x8a7a66, Math.max(b.hw, b.hh), 0.35)
  } else if (b.kind === 'shot' && !b.shard && (hasTrait(b, 'fragile') || b.frost > 0)) {
    shatter(g, b)
  } else if (b.kind === 'shot' && b.decay >= 1) {
    // Burnt, melted or eaten away.
    puff(g, b.x, b.y, 4, b.fire > 0 ? 0x4a4a52 : 0xb8c0cc, b.r, 0.4)
    debris(g, b, 5, b.fire > 0 ? ASH : [b.color, shade(b.color, 0.7)])
  }
}

/** A fragile shot in pieces: one shard per slice of its outline, flying on. */
function shatter(g: Game, src: Body): void {
  g.active.delete(src.id)
  const c = Math.cos(src.a)
  const s = Math.sin(src.a)
  let outline = src.verts
  if (src.shape === 'circle') {
    outline = []
    for (let i = 0; i < 6; i++) outline.push(Math.cos((i * Math.PI) / 3) * src.rad, Math.sin((i * Math.PI) / 3) * src.rad)
  }
  const n = outline.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const tri: [number, number][] = [
      [0, 0],
      [outline[2 * i]!, outline[2 * i + 1]!],
      [outline[2 * j]!, outline[2 * j + 1]!],
    ]
    const info = polyInfo(tri, src.hw / 2, src.hh / 2)
    if (!info) continue
    // polyInfo recentered the slice; put its centroid back where it was.
    const wx = c * -info.artX - s * -info.artY
    const wy = s * -info.artX + c * -info.artY
    const shard = addBody(g, 'shot', 'shot', src.x + wx, src.y + wy, info, src.spec?.density ?? 1, 0.5, src.color)
    shard.a = src.a
    shard.shard = true
    shard.bounce = 0.15
    inherit(src, shard)
    const out = Math.hypot(wx, wy) || 1
    shard.vx = src.vx - src.av * wy + (wx / out) * 2.5
    shard.vy = src.vy + src.av * wx + (wy / out) * 2.5
    shard.av = src.av + (Math.random() - 0.5) * 8
  }
  burst(g, src.x, src.y, 16, [src.color, 0xffffff, shade(src.color, 1.3)], 4)
  ring(g, src.x, src.y, 1.2, 0xffffff, 0.3)
  setBanner(g, 'Smash!', 25)
}

function cull(g: Game): void {
  let removed = false
  for (const b of g.bodies) {
    if (b.invMass > 0 && !b.dead) {
      // Frozen, it breaks at a fraction of the blow.
      const strength = b.frost > 0 ? brittle(b) : b.strength
      // A knock that does not break a block still weakens it.
      if (b.hit > strength * 0.25 && b.kind !== 'shot') b.wear += b.hit * 0.3
      if (b.hit > strength || b.wear > b.strength || b.decay >= 1) destroy(g, b)
      else if (b.x < -10 || b.x > WORLD_W + 10 || b.y < -6) {
        if (b.kind === 'bug') destroy(g, b)
        else b.dead = true
      }
    }
    b.hit = 0
    if (b.dead) removed = true
  }
  if (!removed) return
  g.bodies = g.bodies.filter(b => !b.dead)
  for (const [key, arb] of g.arbiters) if (arb.a.dead || arb.b.dead) g.arbiters.delete(key)
  g.joints = g.joints.filter(j => {
    if (!j.a.dead && !j.b.dead) return true
    // What it stuck to broke: a sticky shot can stick again.
    for (const b of [j.a, j.b]) if (!b.dead && b.kind === 'shot') b.stuck = false

    return false
  })
}

/** The shots of the turn in flight, whose ability a click can still fire. */
function shotBodies(g: Game): Body[] {
  return g.bodies.filter(b => b.kind === 'shot' && !b.dead && g.active.has(b.id))
}

function launchSpeedFactor(mass: number): number {
  return Math.max(0.8, Math.min(1.15, Math.pow(mass, -0.1)))
}

function shotDrag(w: number, h: number, mass: number): number {
  return 0.004 * Math.min(40, (w + h) / 2 / mass)
}

function isFloaty(spec: ShotSpec): boolean {
  return spec.traits.includes('floaty')
}

/** Where the pouch sits now: pulled back against the aim. */
export function pouchPosition(g: Game): { x: number; y: number } {
  return { x: POUCH.x - g.aim.x, y: POUCH.y - g.aim.y }
}

function launchVelocity(g: Game, spec: ShotSpec): { vx: number; vy: number } {
  const k = (LAUNCH_SPEED * launchSpeedFactor(specMass(spec))) / MAX_PULL

  return { vx: g.aim.x * k, vy: g.aim.y * k }
}

/** Whether a world point lies within `pad` of a body's outline (corners squared off). */
function touches(b: Body, x: number, y: number, pad: number): boolean {
  const dx = x - b.x
  const dy = y - b.y
  const reach = b.r + pad
  if (dx * dx + dy * dy > reach * reach) return false
  if (b.shape === 'circle') return true
  const c = Math.cos(b.a)
  const s = Math.sin(b.a)
  const lx = c * dx + s * dy
  const ly = -s * dx + c * dy
  for (let i = 0; i < b.verts.length; i += 2) {
    if (b.norms[i]! * (lx - b.verts[i]!) + b.norms[i + 1]! * (ly - b.verts[i + 1]!) > pad) return false
  }

  return true
}

/**
 * The whole arc the loaded shot would fly now, a point every three steps, to
 * the first thing it would hit (`hit`, null if it lands nowhere in view).
 */
export function trajectory(g: Game): { points: { x: number; y: number }[]; hit: { x: number; y: number } | null } {
  const spec = g.loaded
  if (!spec || Math.hypot(g.aim.x, g.aim.y) < 0.3) return { points: [], hit: null }
  const v = launchVelocity(g, spec)
  const p = pouchPosition(g)
  let x = p.x
  let y = p.y
  let vx = v.vx
  let vy = v.vy
  const gscale = isFloaty(spec) ? 0.3 : 1
  const drag = shotDrag(spec.width, spec.height, specMass(spec)) * (isFloaty(spec) ? 2.5 : 1)
  // Its center meets a block about this far before its middle would.
  const pad = Math.min(spec.width, spec.height) * 0.4
  const targets = g.bodies.filter(b => b.kind === 'block' || b.kind === 'bug')
  const points: { x: number; y: number }[] = []
  for (let i = 1; i <= 300; i++) {
    const sp = Math.hypot(vx, vy)
    const k = 1 - Math.min(0.5, drag * sp * DT)
    vy += GRAVITY * gscale * DT
    vx *= k
    vy *= k
    x += vx * DT
    y += vy * DT
    if (y < pad * 0.5 || targets.some(b => touches(b, x, y, pad))) return { points, hit: { x, y: Math.max(0, y) } }
    // A tall pane shows the sky well over the world's own.
    if (x > WORLD_W + 1 || x < -1 || y > WORLD_H * 4) break
    if (i % 3 === 0) points.push({ x, y })
  }

  return { points, hit: null }
}

function spawnShot(g: Game, spec: ShotSpec, x: number, y: number, scale: number): Body {
  const color = visible(parseColor(spec.color))
  const info = shapeOf(spec, scale)
  const b = addBody(g, 'shot', 'shot', x, y, info, spec.density, spec.friction, color)
  b.bounce = spec.bounce
  b.spec = spec
  b.matter = spec.matter ?? INERT
  b.scale = scale
  b.gscale = isFloaty(spec) ? 0.3 : 1
  b.drag = shotDrag(info.hw * 2, info.hh * 2, b.mass) * (isFloaty(spec) ? 2.5 : 1)
  if (spec.traits.includes('fragile')) b.strength = Math.max(0.4, 3.5 * b.mass)
  g.active.add(b.id)

  return b
}

export function fire(g: Game): boolean {
  const spec = g.loaded
  if (g.phase !== 'aiming' || !spec) return false
  if (Math.hypot(g.aim.x, g.aim.y) < 0.3) return false
  const p = pouchPosition(g)
  const y = Math.max(p.y, spec.height / 2 + 0.05)
  const b = spawnShot(g, spec, p.x, y, 1)
  const v = launchVelocity(g, spec)
  b.vx = v.vx
  b.vy = v.vy
  g.consumed.add(spec.id)
  g.loaded = null
  g.path = [{ x: b.x, y: b.y, frame: g.frame }]
  g.pathDone = false
  g.shots -= 1
  g.aim = { x: 0, y: 0 }
  g.drag = null
  g.banner = null
  g.phase = 'flying'
  g.phaseTime = 0
  g.calmTicks = 0
  g.abilityUsed = spec.ability === 'none'
  g.activeAbility = spec.ability
  g.time = Math.max(g.time, GRACE + 0.01)

  return true
}

function explode(g: Game, src: Body): void {
  const R = 2.6 + Math.max(src.hw, src.hh)
  src.dead = true
  g.active.delete(src.id)
  // Burst open: what it held flies as far as half the blast.
  spill(g, src, R * 0.5)
  for (const b of g.bodies) {
    if (b === src || b.invMass === 0 || b.dead) continue
    const dx = b.x - src.x
    const dy = b.y - src.y
    const d = Math.hypot(dx, dy)
    if (d > R) continue
    const f = 1 - d / R
    const ux = d > 1e-3 ? dx / d : 0
    const uy = d > 1e-3 ? dy / d : 1
    const dv = Math.min(22, 10 * f * b.invMass)
    b.vx += ux * dv
    b.vy += uy * dv + 2 * f
    b.av += (Math.random() - 0.5) * 6 * f
    b.hit += 5 * f
    scorch(g, b, f)
  }
  fireball(g, src.x, src.y, R * 0.75)
  shout(g, src, 'KABOOM!', 30)
}

function split(g: Game, src: Body): void {
  const spec = src.spec
  if (!spec) return
  src.dead = true
  g.active.delete(src.id)
  const scale = Math.max(src.scale * 0.62, 0.25 / Math.min(spec.width, spec.height))
  const sp = Math.hypot(src.vx, src.vy)
  const base = Math.atan2(src.vy, src.vx)
  for (const turn of [-0.22, 0, 0.22]) {
    const ang = base + turn
    const off = turn * 4
    const b = spawnShot(g, spec, src.x - Math.sin(ang) * off, src.y + Math.cos(ang) * off, scale)
    b.vx = Math.cos(ang) * sp
    b.vy = Math.sin(ang) * sp
    b.a = src.a
    inherit(src, b)
  }
  burst(g, src.x, src.y, 12, [parseColor(spec.color), 0xffffff], 4)
  ring(g, src.x, src.y, 1.4, 0xffffff, 0.3)
  shout(g, src, 'Split!')
}

function rocket(g: Game, src: Body): void {
  const sp = Math.hypot(src.vx, src.vy)
  const ux = sp > 1e-3 ? src.vx / sp : 1
  const uy = sp > 1e-3 ? src.vy / sp : 0
  src.vx = ux * (sp + 12)
  src.vy = uy * (sp + 12)
  src.noGravity = 0.7
  src.trail = 0.7
  src.drag = 0
  shout(g, src, 'Afterburner!')
}

/** Swells to nearly twice the size, and four times the weight, in mid-air. */
function grow(g: Game, src: Body): void {
  const spec = src.spec
  if (!spec) return
  const k = Math.min(1.9, 3.6 / (Math.max(spec.width, spec.height) * src.scale))
  if (k <= 1.05) {
    setBanner(g, 'Already huge!', 25)

    return
  }
  src.dead = true
  g.active.delete(src.id)
  const b = spawnShot(g, spec, src.x, src.y + (src.hh * (k - 1)) / 2, src.scale * k)
  b.vx = src.vx
  b.vy = src.vy
  b.a = src.a
  b.av = src.av
  inherit(src, b)
  burst(g, src.x, src.y, 14, [parseColor(spec.color), 0xffffff], 3)
  ring(g, src.x, src.y, Math.max(b.hw, b.hh) + 0.8, 0xffffff, 0.35)
  shout(g, src, 'Supersize!')
}

/** Stops dead in the air and slams straight down. */
function dive(g: Game, src: Body): void {
  const sp = Math.hypot(src.vx, src.vy)
  src.vx *= 0.12
  src.vy = -Math.max(20, sp)
  src.av *= 0.2
  src.gscale = Math.max(1, src.gscale)
  src.drag = 0
  src.trail = 0.6
  shout(g, src, 'Dive!')
}

/** Turns round and flies back the way it came, spinning. */
function boomerang(g: Game, src: Body): void {
  const dir = src.vx >= 0 ? -1 : 1
  src.vx = dir * Math.max(8, Math.abs(src.vx) * 1.1)
  src.vy = Math.max(src.vy, 0) + 4
  src.av = -dir * 18
  ring(g, src.x, src.y, 1, 0xffffff, 0.25)
  shout(g, src, 'Boomerang!')
}

/** Becomes a whirlpool that drags everything near into its eye. */
function vortex(g: Game, src: Body): void {
  src.dead = true
  g.active.delete(src.id)
  g.effects.push({ kind: 'vortex', x: src.x, y: Math.max(1, src.y), t: 0, life: 1.8, r: 4.5, color: src.color })
  shout(g, src, 'Vortex!', 30)
}

// ---------------------------------------------------------------------------
// Matter: the world's chemistry. Every body and every round has the same nine
// numbers (`Matter`), and the same few laws work between any two that touch,
// whatever they are: heat sets alight what burns, thaws what is frozen and
// melts what melts; cold puts fire out and freezes, wet things fastest; water
// puts fire out and soaks in; electricity runs through what conducts, wet
// things too, jolting what it runs through; acid eats what it dissolves. What
// is alight is as hot as fire, what is lit and explodes goes off, and what
// breaks open spills what it held on what is near. Nothing here asks what a
// thing is called.

const FIRE = [0xffe066, 0xff9f1c, 0xff4d2e]
const ASH = [0x5c5c66, 0x8a8a94, 0xff9f1c]
/** Seconds of exposure a round's hit counts as. */
const HIT_DOSE = 0.3
/** How fast heat builds toward catching fire, per second at full heat and full fuel. */
const KINDLING = 4
/** What carries electricity at least this well passes a shock on. */
const CARRIES = 0.25

/** What a thing gives off to what it touches. */
type Exposure = { heat: number; wet: number; acid: number }

/** Living things suffer every element worse. */
function frailty(b: Body): number {
  return b.kind === 'bug' ? 2.5 : 1
}

/** How hot it is now: alight, as hot as fire; frozen, as cold as ice. */
function heatOf(b: Body): number {
  if (b.fire > 0) return 1
  if (b.frost > 0) return Math.min(b.matter.heat, -0.5)

  return b.matter.heat
}

function isWet(b: Body): boolean {
  return b.soak > 0 || b.matter.wet >= 0.3
}

/** How well electricity runs through it now: anything wet carries it too. */
function conductance(b: Body): number {
  return Math.max(b.matter.conducts, isWet(b) ? 0.7 : 0)
}

/** The blow that breaks it while it is frozen. */
function brittle(b: Body): number {
  return Number.isFinite(b.strength) ? b.strength * 0.35 : Math.max(0.4, 3.5 * b.mass)
}

/** A piece of `from` (split off, grown, a shard) made of the same and in the same state. */
function inherit(from: Body, to: Body): void {
  to.matter = from.matter
  to.fire = from.fire
  to.soak = from.soak
  to.frost = from.frost
  to.corrode = from.corrode
  to.fuse = from.fuse
  to.decay = from.decay
}

function givesOff(b: Body): Exposure | null {
  const e = { heat: heatOf(b), wet: b.matter.wet, acid: b.matter.acid }

  return Math.abs(e.heat) > 0.2 || e.wet > 0.2 || e.acid > 0.05 ? e : null
}

/** `b` exposed to heat or cold, water and acid for `dose` seconds. */
function expose(g: Game, b: Body, e: Exposure, dose: number): void {
  if (b.dead || b.kind === 'ground') return
  const m = b.matter
  const frail = frailty(b)
  if (e.wet > 0.2) {
    if (b.fire > 0) {
      b.fire = Math.max(0, b.fire - e.wet * dose * 25)
      if (b.fire === 0) puff(g, b.x, b.y + b.hh, 4, 0xe8edf5, b.hw * 2, 0.4)
    }
    b.kindle = 0
    // What is hot itself turns it to steam.
    if (m.heat < 0.5) b.soak = Math.max(b.soak, 2 + 4 * e.wet)
  }
  if (e.heat > 0.2) {
    const h = e.heat
    b.chill = 0
    if (b.frost > 0) b.frost = Math.max(0, b.frost - h * dose * 4)
    if (m.melts > 0) b.decay += 0.5 * h * m.melts * dose
    if (b.soak > 0) b.soak = Math.max(0, b.soak - h * dose * 3)
    else if (!isWet(b) && b.frost <= 0 && b.fire <= 0 && m.burns >= 0.05) {
      b.kindle += KINDLING * h * m.burns * dose
      if (b.kindle >= 1) ignite(g, b)
    }
    // Scalded.
    if (b.kind === 'bug') b.decay += 0.25 * h * frail * dose
  } else if (e.heat < -0.2) {
    const c = -e.heat
    b.kindle = 0
    if (b.fire > 0) b.fire = Math.max(0, b.fire - c * dose * 6)
    if (m.heat < 0.3 && b.frost <= 0) {
      b.chill += c * c * dose * (isWet(b) ? 6 : 1.5)
      if (b.chill >= 1) freeze(b, c)
    }
  }
  if (e.acid > 0.05) b.decay += 0.35 * e.acid * m.dissolves * frail * dose
}

/** Catches fire: it burns as long as it has fuel, and what explodes is lit. */
function ignite(g: Game, b: Body): void {
  b.kindle = 0
  if (b.fire > 0 || b.dead) return
  b.fire = 1.5 + 5 * b.matter.burns
  if (b.matter.explodes >= 0.05 && b.fuse < 0) b.fuse = 0.15 + (1 - b.matter.explodes) * 1.1
  burst(g, b.x, b.y, 6, FIRE, 2.5)
  if (b.kind === 'shot' && b.spec && !b.shard) setBanner(g, `${b.spec.name} caught fire!`, 30)
}

function freeze(b: Body, cold: number): void {
  b.chill = 0
  b.kindle = 0
  b.fire = 0
  b.frost = 3 + 4 * cold
}

/** An explosion's heat on what it reaches, `f` from 1 at its heart to 0 at its edge. */
function scorch(g: Game, b: Body, f: number): void {
  if (f > 0.2) expose(g, b, { heat: Math.min(1, 1.6 * f), wet: 0, acid: 0 }, 2 * HIT_DOSE)
}

/** Broken open: what it held, hot, cold, wet, live or corrosive, splashes what is within `reach` of it. */
function spill(g: Game, b: Body, reach = 0.6): void {
  const e = givesOff(b)
  const live = b.matter.electric
  if (!e && live < 0.1) return
  const links = live >= 0.1 ? linksOf(g) : null
  for (const o of g.bodies) {
    if (o === b || o.dead || o.kind === 'ground') continue
    if (Math.hypot(o.x - b.x, o.y - b.y) > b.r + o.r + reach) continue
    if (e) {
      expose(g, o, e, 0.4)
      if (e.acid >= 0.1) o.corrode = Math.max(o.corrode, 1 + 2 * e.acid)
    }
    if (links) shockFrom(g, o, live, 0.3, false, links)
  }
}

/** A round's matter on what it struck, or passes through, for `dose` seconds. */
function wash(g: Game, m: Matter | undefined, b: Body, dose: number): void {
  // A round forged before there was matter is made of nothing.
  if (!m || b.dead) return
  if (Math.abs(m.heat) > 0.2 || m.wet > 0.2 || m.acid > 0.05) expose(g, b, m, dose)
  // Acid clings, and goes on eating.
  if (m.acid >= 0.1) b.corrode = Math.max(b.corrode, (1 + 2 * m.acid) * Math.min(1, dose / HIT_DOSE))
  if (m.electric >= 0.1) shockFrom(g, b, m.electric, dose, false, linksOf(g))
}

/** What touches what now. */
function linksOf(g: Game): Map<Body, Body[]> {
  const links = new Map<Body, Body[]>()
  const add = (a: Body, b: Body) => {
    const list = links.get(a)
    if (list) list.push(b)
    else links.set(a, [b])
  }
  for (const arb of g.arbiters.values()) {
    if (arb.a.dead || arb.b.dead || arb.a.kind === 'ground' || arb.b.kind === 'ground') continue
    add(arb.a, arb.b)
    add(arb.b, arb.a)
  }

  return links
}

/**
 * Electricity into `b`, at `power`, for `dose` seconds, and on through all
 * that carries it and touches. A `source` passes it on whatever it is made
 * of, and takes none itself; what is struck takes it, and passes it on only
 * if it carries it.
 */
function shockFrom(g: Game, b: Body, power: number, dose: number, source: boolean, links: Map<Body, Body[]>): void {
  const reached = [b]
  const seen = new Set([b])
  for (let i = 0; i < reached.length; i++) {
    const x = reached[i]!
    if (!(i === 0 && source) && conductance(x) < CARRIES) continue
    for (const y of links.get(x) ?? []) {
      if (seen.has(y) || y.dead || conductance(y) < CARRIES) continue
      seen.add(y)
      reached.push(y)
    }
  }
  if (source && reached.length > 1) b.zap = Math.max(b.zap, 0.2)
  for (let i = source ? 1 : 0; i < reached.length; i++) jolt(g, reached[i]!, power, dose)
}

/** A shock through `b`: it kills what lives, sparks set alight what burns, and lights what explodes. */
function jolt(g: Game, b: Body, power: number, dose: number): void {
  b.zap = Math.max(b.zap, 0.2)
  if (b.kind === 'bug') b.decay += 1.2 * power * frailty(b) * dose
  if (b.matter.explodes >= 0.05 && !isWet(b)) b.fuse = b.fuse < 0 ? 0.05 : Math.min(b.fuse, 0.05)
  else if (!isWet(b) && b.fire <= 0 && b.matter.burns >= 0.05) {
    b.kindle += KINDLING * power * b.matter.burns * dose
    if (b.kindle >= 1) ignite(g, b)
  }
}

/** A lit thing that explodes going off: the harder it explodes, and the bigger it is, the wider. */
function detonate(g: Game, b: Body): void {
  const R = 0.8 + 2.6 * b.matter.explodes + 0.3 * Math.min(b.r, 2)
  b.fuse = -1
  g.active.delete(b.id)
  destroy(g, b)
  blastAt(g, b.x, b.y, R)
  if (b.kind === 'shot' && b.spec) setBanner(g, `${b.spec.name} went off!`, 35)
}

/** A step of the chemistry: what touches trades heat, water and acid; shocks run; fire, fuses, frost and acid go on. */
function stepMatter(g: Game): void {
  let before = 0
  for (const b of g.bodies) before += b.decay
  for (const arb of g.arbiters.values()) {
    const { a, b } = arb
    if (a.dead || b.dead || a.kind === 'ground' || b.kind === 'ground') continue
    const fromA = givesOff(a)
    const fromB = givesOff(b)
    if (fromB) expose(g, a, fromB, DT)
    if (fromA) expose(g, b, fromA, DT)
  }
  let links: Map<Body, Body[]> | null = null
  for (const b of g.bodies) {
    if (b.dead || b.matter.electric < 0.1) continue
    links ??= linksOf(g)
    shockFrom(g, b, b.matter.electric, DT, true, links)
  }
  for (const b of g.bodies) {
    if (b.dead || b.kind === 'ground') continue
    const m = b.matter
    if (b.fire > 0) {
      b.fire = Math.max(0, b.fire - DT)
      b.decay += 0.42 * Math.max(0.1, m.burns) * frailty(b) * DT
      const top = b.y + Math.min(b.hh, b.r) * 0.6
      if (Math.random() < 0.18) {
        particle(g, 'ember', b.x + (Math.random() - 0.5) * b.hw * 1.6, top, (Math.random() - 0.5) * 1.2, 1.5 + Math.random() * 1.5, 0.5 + Math.random() * 0.5, FIRE[Math.floor(Math.random() * 3)]!, 0.06)
      }
      if (Math.random() < 0.05) puff(g, b.x, top + 0.3, 1, 0x2e2e38, b.hw, 0.45 + Math.min(b.r, 1) * 0.3, 0.6)
    }
    if (b.fuse >= 0) {
      b.fuse -= DT
      if (b.fuse < 0) {
        detonate(g, b)
        continue
      }
    }
    if (b.corrode > 0) {
      b.corrode = Math.max(0, b.corrode - DT)
      b.decay += 0.3 * m.dissolves * frailty(b) * DT
    }
    if (b.soak > 0) b.soak = Math.max(0, b.soak - DT)
    if (b.frost > 0) b.frost = Math.max(0, b.frost - DT)
    if (b.zap > 0) b.zap = Math.max(0, b.zap - DT)
    b.kindle = Math.max(0, b.kindle - 0.5 * DT)
    b.chill = Math.max(0, b.chill - 0.5 * DT)
  }
  let after = 0
  for (const b of g.bodies) after += b.decay
  if (after - before > 0.05 * DT) g.eaten = g.time
}

/**
 * What is at work on a body, a letter each, for drawing: alight (f), lit to
 * go off (x), soaked (w), frozen (i), shocked (z), being eaten (a).
 */
export function elementCode(b: Body): string {
  let s = ''
  if (b.fire > 0) s += 'f'
  if (b.fuse >= 0) s += 'x'
  if (b.soak > 0) s += 'w'
  if (b.frost > 0) s += 'i'
  if (b.zap > 0) s += 'z'
  if (b.corrode > 0) s += 'a'

  return s
}

// ---------------------------------------------------------------------------
// Shooting: a power that fires the rounds the Forge made for the object, the
// shot turned to aim. How a round flies and what it does where it hits are
// the Forge's numbers, read here as they are: nothing is decided by name.

/** Which way each facing points in the drawing, y up. */
const FACE: Record<Facing, number> = { right: 0, up: Math.PI / 2, left: Math.PI, down: -Math.PI / 2, around: 0 }

/** Steps the shot takes to turn and aim before its first round: a sixth of a second, seen. */
const WIND_UP = 12
/** How much of the turn left it makes each step. */
const TURN = 0.25
/** Rounds in one ring, fired all around at once. */
const RING = 16
/** Times a round bounces before it is spent. */
const MAX_BOUNCES = 4

/** An angle brought within ±π. */
function wrap(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
}

/** The low arc that sends a round at `speed` across dx, dy under its gravity; 45° when it cannot reach. */
function lob(dx: number, dy: number, speed: number, grav: number): number {
  const pull = -GRAVITY * grav
  if (pull < 2 || Math.abs(dx) < 1e-3) return Math.atan2(dy, dx)
  const v2 = speed * speed
  const disc = v2 * v2 - pull * (pull * dx * dx + 2 * dy * v2)
  if (disc < 0) return Math.atan2(1, Math.sign(dx))

  return Math.atan2(v2 - Math.sqrt(disc), pull * dx)
}

function nearestBug(g: Game, x: number, y: number): Body | null {
  let best: Body | null = null
  let near = Infinity
  for (const b of g.bodies) {
    if (b.kind !== 'bug' || b.dead) continue
    const d = Math.hypot(b.x - x, b.y - y)
    if (d < near) {
      near = d
      best = b
    }
  }

  return best
}

/**
 * The way a round at `speed` must leave a shot moving at vx, vy for it to
 * fly along `d`: turned into the shot's drift across that line. Its speed
 * along it comes back too.
 */
function lead(d: number, speed: number, vx: number, vy: number): { ang: number; speed: number } {
  const dx = Math.cos(d)
  const dy = Math.sin(d)
  const along = vx * dx + vy * dy
  const px = vx - along * dx
  const py = vy - along * dy
  const across = Math.hypot(px, py)
  if (across >= speed * 0.95) return { ang: d, speed }
  const k = Math.sqrt(speed * speed - across * across)

  return { ang: Math.atan2(k * dy - py, k * dx - px), speed: along + k }
}

/**
 * Which way the power fires from the shot, as an angle. Rounds leave with
 * the shot's own speed added, so a whale's spout rises over it as it flies;
 * at a target, the aim allows for that, and for the drop of the arc.
 */
function aimAngle(g: Game, b: Body, r: Round, aim: Aim): number {
  const ahead = Math.hypot(b.vx, b.vy) > 1 ? Math.atan2(b.vy, b.vx) : 0
  if (aim === 'up') return Math.PI / 2
  if (aim === 'down') return -Math.PI / 2
  if (aim === 'back') return ahead + Math.PI
  if (aim === 'target') {
    const bug = nearestBug(g, b.x, b.y)
    if (bug) {
      const dx = bug.x - b.x
      const dy = bug.y - b.y
      // Twice: the arc for the speed it leaves at, then for the speed it truly flies at.
      const first = lead(lob(dx, dy, r.speed, r.gravity), r.speed, b.vx, b.vy)

      return lead(lob(dx, dy, Math.max(1, first.speed), r.gravity), r.speed, b.vx, b.vy).ang
    }
  }

  return ahead
}

/** Where the rounds come out: the point the Forge marked on the drawing, as the shot is turned now. */
export function muzzle(b: Body): { x: number; y: number } {
  const from = b.spec?.power?.from ?? [0, 0]
  const lx = b.artX + from[0] * b.scale
  const ly = b.artY + from[1] * b.scale
  const c = Math.cos(b.a)
  const s = Math.sin(b.a)

  return { x: b.x + c * lx - s * ly, y: b.y + s * lx + c * ly }
}

/** How far a round reaches: half its longest side, a puff's more as it swells. */
export function roundRadius(r: Round, age: number): number {
  const base = Math.min(0.8, Math.max(0.04, Math.max(r.width, r.height) / 2))

  return r.fade ? base * (1 + 1.2 * Math.min(1, age / r.life)) : base
}

/**
 * What a round's punch does to what it strikes: the blow (past a body's
 * strength it breaks), the damage that stays, and the shove. Punch 1 knocks
 * out a bug or cracks glass, 2 splits a wooden plank in two, 3 smashes one.
 */
function blowOf(r: Round): { hit: number; wear: number; push: number } {
  return { hit: 1.1 * r.punch, wear: 0.5 * r.punch, push: 0.35 * Math.pow(r.punch, 1.3) }
}

/** Starts the shot firing: it turns to aim, then lets its rounds go, or rings of them all around. */
function shoot(g: Game, src: Body): void {
  const p = src.spec?.power
  if (!p?.round) return
  const around = p.facing === 'around'
  src.ammoLeft = around ? Math.ceil(p.round.count / RING) : p.round.count
  src.ammoWait = around ? 1 : WIND_UP
  shout(g, src, 'Fire!', 30)
}

/** A step of a shot that is firing: turned further toward its aim, and rounds out when they are due. */
function emit(g: Game, b: Body): void {
  const p = b.spec?.power
  const r = p?.round
  if (!p || !r) {
    b.ammoLeft = 0

    return
  }
  const around = p.facing === 'around'
  if (!around) {
    b.a += wrap(aimAngle(g, b, r, p.aim) - FACE[p.facing] - b.a) * TURN
    b.av = 0
  }
  if (--b.ammoWait > 0) return
  const color = visible(parseColor(r.color, b.color))
  const gap = Math.max(1, Math.round(r.every / DT))
  if (around) {
    const rings = Math.ceil(r.count / RING)
    const n = Math.ceil(r.count / rings)
    b.ammoLeft--
    b.ammoWait = Math.max(4, gap)
    const turn = Math.random() * Math.PI * 2
    for (let i = 0; i < n; i++) {
      const ang = turn + (i * Math.PI * 2) / n
      const out = b.r * 0.8
      addPellet(g, b, r, b.x + Math.cos(ang) * out, b.y + Math.sin(ang) * out, ang, color)
    }

    return
  }
  // The kick back: a few meters a second at most, over all it fires.
  const kick = Math.min((blowOf(r).push * 0.8) / b.mass, 6 / r.count)
  // Fired together, all of them go now.
  const now = r.every <= 0 ? b.ammoLeft : 1
  for (let i = 0; i < now; i++) {
    b.ammoLeft--
    const m = muzzle(b)
    const ang = b.a + FACE[p.facing] + (Math.random() * 2 - 1) * ((r.spread * Math.PI) / 180)
    addPellet(g, b, r, m.x, m.y, ang, color)
    b.vx -= Math.cos(ang) * kick
    b.vy -= Math.sin(ang) * kick
  }
  b.ammoWait = gap
}

/** A round out of `from` along `ang`, carried on at the shot's own speed. */
function addPellet(g: Game, from: Body, round: Round, x: number, y: number, ang: number, color: number): void {
  const sp = round.speed * (0.92 + Math.random() * 0.16)
  g.pellets.push({ round, x, y, vx: from.vx + Math.cos(ang) * sp, vy: from.vy + Math.sin(ang) * sp, age: 0, color, done: false, bounces: 0 })
}

/** A puff of bits where a round ended; none for a puff of its own. */
function splash(g: Game, p: Pellet): void {
  if (p.round.fade) return
  burst(g, p.x, p.y, Math.min(4, 2 + Math.round(p.round.punch)), [p.color, 0xffffff], 2.5)
}

/** An explosion of radius R: everything near shoved out and hurt, the nearer the more. */
function blastAt(g: Game, x: number, y: number, R: number): void {
  for (const b of g.bodies) {
    if (b.invMass === 0 || b.dead) continue
    const dx = b.x - x
    const dy = b.y - y
    const d = Math.hypot(dx, dy)
    const reach = R + Math.min(b.r, 1) * 0.5
    if (d > reach) continue
    const f = 1 - d / reach
    const ux = d > 1e-3 ? dx / d : 0
    const uy = d > 1e-3 ? dy / d : 1
    const dv = Math.min(18, (2 + 2.5 * R) * f * b.invMass)
    b.vx += ux * dv
    b.vy += uy * dv + 1.5 * f
    b.av += (Math.random() - 0.5) * 5 * f
    if (b.kind !== 'shot') b.hit += (1 + 1.4 * R) * f
    scorch(g, b, f)
  }
  fireball(g, x, y, R)
}

/** A round at its end: it goes off if it explodes, else leaves a puff. */
function spend(g: Game, p: Pellet): void {
  if (p.round.blast > 0) blastAt(g, p.x, p.y, p.round.blast)
  else splash(g, p)
  p.done = true
}

/** The outward normal of the face of `b` nearest a point. */
function faceNormal(b: Body, x: number, y: number): { nx: number; ny: number } {
  const dx = x - b.x
  const dy = y - b.y
  if (b.shape === 'circle') {
    const l = Math.hypot(dx, dy) || 1

    return { nx: dx / l, ny: dy / l }
  }
  const c = Math.cos(b.a)
  const s = Math.sin(b.a)
  const lx = c * dx + s * dy
  const ly = -s * dx + c * dy
  let best = -Infinity
  let at = 0
  for (let i = 0; i < b.verts.length; i += 2) {
    const d = b.norms[i]! * (lx - b.verts[i]!) + b.norms[i + 1]! * (ly - b.verts[i + 1]!)
    if (d > best) {
      best = d
      at = i
    }
  }
  const nx = b.norms[at]!
  const ny = b.norms[at + 1]!

  return { nx: c * nx - s * ny, ny: s * nx + c * ny }
}

/** A round meets a body: it shoves and hurts it, then goes off, bounces away, or is spent. */
function strike(g: Game, p: Pellet, b: Body): void {
  const r = p.round
  const sp = Math.hypot(p.vx, p.vy) || 1
  const blow = blowOf(r)
  const jx = (p.vx / sp) * blow.push
  const jy = (p.vy / sp) * blow.push
  b.vx += jx * b.invMass
  b.vy += jy * b.invMass
  b.av += b.invI * ((p.x - b.x) * jy - (p.y - b.y) * jx)
  b.hit += blow.hit
  b.wear += blow.wear
  wash(g, r.matter, b, HIT_DOSE)
  if (r.blast <= 0 && r.bounce > 0 && p.bounces < MAX_BOUNCES && sp * r.bounce > 2) {
    const { nx, ny } = faceNormal(b, p.x, p.y)
    const vn = p.vx * nx + p.vy * ny
    if (vn < 0) {
      p.vx -= (1 + r.bounce) * vn * nx
      p.vy -= (1 + r.bounce) * vn * ny
    }
    p.bounces++
    const rad = roundRadius(r, p.age)
    for (let i = 0; i < 8 && touches(b, p.x, p.y, rad); i++) {
      p.x += nx * rad * 0.5
      p.y += ny * rad * 0.5
    }

    return
  }
  spend(g, p)
}

/**
 * One step of every round in the air. A round that passes through everything
 * harms what it covers as it goes, a living thing most.
 */
function stepPellets(g: Game): void {
  if (g.pellets.length === 0) return
  // What is standing in the level: blocks, bugs, and shots of turns gone by (this turn's own fly clear).
  const targets = g.bodies.filter(b => b.kind !== 'ground' && !b.dead && !(b.kind === 'shot' && g.active.has(b.id)))
  for (const p of g.pellets) {
    if (p.done) continue
    const r = p.round
    p.age += DT
    p.vy += GRAVITY * r.gravity * DT
    if (r.fade) {
      p.vx *= 0.975
      p.vy *= 0.975
    }
    const rad = roundRadius(r, p.age)
    if (r.pierce === 'all') {
      p.x += p.vx * DT
      p.y += p.vy * DT
      const rate = 0.02 * (0.5 + r.punch)
      for (const b of targets) {
        if (b.dead || !touches(b, p.x, p.y, rad)) continue
        b.wear += rate * (b.kind === 'bug' ? 1 : 0.15)
        wash(g, r.matter, b, DT * 2)
      }
    } else {
      // In short hops, so a fast round cannot skip over a thin plank.
      const hops = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy) * DT) / 0.15))
      for (let h = 0; h < hops && !p.done; h++) {
        p.x += (p.vx * DT) / hops
        p.y += (p.vy * DT) / hops
        for (const b of targets) {
          if (b.dead || !touches(b, p.x, p.y, rad)) continue
          if (r.pierce === 'glass' && b.mat === 'glass') {
            destroy(g, b)
            p.vx *= 0.9
            p.vy *= 0.9
            continue
          }
          strike(g, p, b)
          break
        }
      }
      if (!p.done && p.y < rad * 0.5) {
        if (r.blast <= 0 && r.bounce > 0 && p.bounces < MAX_BOUNCES && -p.vy * r.bounce > 1.5) {
          p.y = rad * 0.5
          p.vy = -p.vy * r.bounce
          p.vx *= 0.8
          p.bounces++
        } else spend(g, p)
      }
    }
    // Its life run out: one that explodes goes off then.
    if (!p.done && p.age >= r.life) spend(g, p)
    if (!p.done && (p.x < -2 || p.x > WORLD_W + 2 || p.y > WORLD_H * 4)) p.done = true
  }
}

/** The shot's ability, at the player's click or space. */
export function trigger(g: Game): boolean {
  if (g.phase !== 'flying' || g.abilityUsed) return false
  const shots = shotBodies(g)
  const src = shots[0]
  if (!src) return false
  g.abilityUsed = true
  if (g.activeAbility === 'explode') explode(g, src)
  else if (g.activeAbility === 'split') split(g, src)
  else if (g.activeAbility === 'rocket') rocket(g, src)
  else if (g.activeAbility === 'grow') grow(g, src)
  else if (g.activeAbility === 'dive') dive(g, src)
  else if (g.activeAbility === 'boomerang') boomerang(g, src)
  else if (g.activeAbility === 'vortex') vortex(g, src)
  else if (g.activeAbility === 'shoot') shoot(g, src)
  // A flash round what the power left flying, where the flight on screen hands over.
  for (const b of shotBodies(g)) b.powerAt = g.frame
  cull(g)

  return true
}

function isCalm(g: Game): boolean {
  if (g.effects.some(fx => fx.kind === 'vortex')) return false
  if (g.pellets.length > 0 || g.bodies.some(b => b.ammoLeft > 0)) return false
  // Fire burns itself out, a lit fuse goes off, and acid finishes eating.
  if (g.bodies.some(b => !b.dead && (b.fire > 0 || b.fuse >= 0 || b.corrode > 0))) return false
  // Nor while something touching it is eating it away.
  if (g.time - g.eaten < 0.1) return false
  for (const b of g.bodies) {
    if (b.invMass === 0) continue
    if (Math.hypot(b.vx, b.vy) > 0.25 || Math.abs(b.av) > 0.4) return false
  }

  return true
}

function endTurn(g: Game): void {
  g.active.clear()
  if (bugsLeft(g) === 0) {
    const bonus = g.shots * 1000
    g.score += bonus
    g.best = Math.max(g.best, g.score)
    g.phase = 'won'
    setBanner(g, bonus > 0 ? `Level clear! +${bonus} for ${g.shots} unused shot${g.shots === 1 ? '' : 's'}` : 'Level clear!', 90)
    g.events.push({ type: 'result', level: g.level, score: g.score, won: true })
  } else if (g.shots <= 0) {
    g.best = Math.max(g.best, g.score)
    g.phase = 'lost'
    setBanner(g, 'Out of shots. The bugs survive... for now.', 90)
    g.events.push({ type: 'result', level: g.level, score: g.score, won: false })
  } else {
    g.phase = 'waiting'
  }
}

/** On to the next level after a win, or the same one again after a loss. */
export function proceed(g: Game): void {
  if (g.phase === 'won') loadLevel(g, g.level + 1)
  else if (g.phase === 'lost') {
    g.score = g.levelStartScore
    loadLevel(g, g.level)
  }
}

export function restart(g: Game): void {
  g.score = g.levelStartScore
  loadLevel(g, g.level)
}

/** Hands the game the Forge's latest state; a fresh item goes in the pouch. */
export function setForge(g: Game, forge: ForgeView): boolean {
  // Its own clock for the Forge's work, from the moment a new making begins.
  if (forge.status !== 'forging') g.forgeSince = -1
  else if (g.forge.status !== 'forging' || g.forge.id !== forge.id || g.forgeSince < 0) g.forgeSince = g.frame
  g.forge = forge
  if (forge.status !== 'ready') return false
  const item = forge.item
  if (g.consumed.has(item.id) || g.loaded?.id === item.id) return false
  if (g.phase !== 'waiting' && g.phase !== 'aiming') return false
  g.loaded = item
  g.loadedAt = g.frame
  g.phase = 'aiming'
  setBanner(g, `${item.name} loaded${item.quip ? `: "${item.quip}"` : ''}`, 80)

  return true
}

/** The longest path kept, in dots. */
const MAX_PATH = 150

/** A dot of the flung shot's path this tick, until it first touches anything. */
function tracePath(g: Game): void {
  if (g.pathDone) return
  const s = g.bodies.find(b => b.kind === 'shot' && !b.dead && !b.shard && g.active.has(b.id))
  const touched = s && [...g.arbiters.values()].some(a => a.a === s || a.b === s)
  if (!s || touched || g.path.length >= MAX_PATH) {
    g.pathDone = true

    return
  }
  g.path.push({ x: s.x, y: s.y, frame: g.frame })
}

/** One tick of the surface clock; answers whether anything on screen changed. */
export function tick(g: Game): boolean {
  g.frame++
  let dirty = false
  if (g.pellets.some(p => p.done)) g.pellets = g.pellets.filter(p => !p.done)
  if (g.phase === 'settling' || g.phase === 'flying') {
    for (let i = 0; i < SUBSTEPS; i++) {
      physicsStep(g)
      stepMatter(g)
      stepPellets(g)
      g.time += DT
      g.phaseTime += DT

      if (g.phase === 'flying') {
        for (const b of g.bodies) {
          if (b.kind !== 'shot' || b.dead || b.trail <= 0) continue
          b.trail -= DT
          particle(g, 'spark', b.x - b.vx * 0.03, b.y - b.vy * 0.03, -b.vx * 0.2 + (Math.random() - 0.5) * 2, -b.vy * 0.2 + (Math.random() - 0.5) * 2, 0.3, Math.random() > 0.5 ? 0xffb347 : 0xff5e3a, 0.09)
          if (Math.random() < 0.25) particle(g, 'smoke', b.x - b.vx * 0.05, b.y - b.vy * 0.05, -b.vx * 0.1, -b.vy * 0.1, 0.6, 0x9a9aa4, 0.3)
        }
        for (const b of g.bodies) if (b.ammoLeft > 0 && !b.dead) emit(g, b)
        for (const b of shotBodies(g)) {
          if (g.activeAbility === 'explode' && !g.abilityUsed && b.hit > 0.25) {
            g.abilityUsed = true
            explode(g, b)
          }
        }
      }
      cull(g)
    }
    if (g.phase === 'flying') tracePath(g)
    dirty = true

    if (g.phase === 'settling') {
      g.calmTicks = isCalm(g) ? g.calmTicks + 1 : 0
      if (g.phaseTime > 1.4 && (g.calmTicks > 5 || g.phaseTime > 4)) {
        g.phase = 'waiting'
        g.time = Math.max(g.time, GRACE + 0.01)
        if (g.forge.status === 'ready') setForge(g, g.forge)
      }
    } else {
      g.calmTicks = isCalm(g) ? g.calmTicks + 1 : 0
      const bugs = bugsLeft(g)
      if (bugs === 0 && g.phaseTime - g.lastKill > 1.5) endTurn(g)
      else if ((g.phaseTime > 1 && g.calmTicks >= 20) || g.phaseTime > 14) endTurn(g)
      // endTurn may have moved the phase on.
      if ((g.phase as Phase) === 'waiting' && g.forge.status === 'ready') setForge(g, g.forge)
    }
  } else if (g.effects.length > 0 || g.pellets.length > 0) {
    g.effects = []
    g.pellets = []
    dirty = true
  }

  if (g.particles.length > 0) {
    const t = DT * SUBSTEPS
    for (const p of g.particles) stepParticle(p, t)
    g.particles = g.particles.filter(p => p.life > 0 && p.y > -1)
    dirty = true
  }
  if (g.banner && g.frame >= g.banner.until) {
    g.banner = null
    dirty = true
  }

  return dirty
}

/**
 * A copy of the game that shares nothing it could change: bodies, contacts,
 * joints, effects and particles are new objects, wired to each other as the
 * originals were. Outlines and specs never change after a body is made, so
 * they are shared. What a shot's flight is replayed from when a click comes.
 */
export function cloneGame(g: Game): Game {
  const twin = new Map<Body, Body>()
  const bodies = g.bodies.map(b => {
    const c = { ...b }
    twin.set(b, c)

    return c
  })
  const of = (b: Body) => twin.get(b) ?? { ...b }
  const arbiters = new Map<number, Arbiter>()
  for (const [key, arb] of g.arbiters) arbiters.set(key, { ...arb, a: of(arb.a), b: of(arb.b), cs: arb.cs.map(c => ({ ...c })) })

  return {
    ...g,
    bodies,
    arbiters,
    joints: g.joints.map(j => ({ ...j, a: of(j.a), b: of(j.b) })),
    effects: g.effects.map(fx => ({ ...fx })),
    particles: g.particles.map(p => ({ ...p })),
    pellets: g.pellets.map(p => ({ ...p })),
    path: [...g.path],
    consumed: new Set(g.consumed),
    active: new Set(g.active),
    aim: { ...g.aim },
    drag: g.drag && { ...g.drag },
    banner: g.banner && { ...g.banner },
    events: [...g.events],
    view: { ...g.view },
  }
}

/** Runs a level's settling at once, so it opens standing still, its title showing. */
export function settleNow(g: Game): void {
  if (g.phase !== 'settling') return
  for (let i = 0; i < 150 && g.phase === 'settling'; i++) tick(g)
  setBanner(g, `Level ${g.level}: ${g.title}`, 70)
}

// ---------------------------------------------------------------------------
// Input

/** Pixel position in the game area (x across, y down) to world meters. */
export function toWorld(g: Game, px: number, py: number): { x: number; y: number } {
  const v = g.view

  return { x: (px - v.ox) / v.s, y: (v.PH - py) / v.s - 1 }
}

/**
 * Aiming two ways. Drag and let go: the pull is the drag, released it flies.
 * Or click (a press that barely moves): the sling stays held, the pointer
 * aims as it moves with no button down, and the next click flings. Where a
 * surface holds back its drawing during a drag (the desktop does), only the
 * second way shows the arc follow the pointer.
 */
export function pointer(g: Game, type: 'down' | 'move' | 'up', px: number, py: number): boolean {
  if (type === 'down') {
    if (g.phase === 'aiming') {
      if (g.drag?.held) {
        g.drag = null
        if (!fire(g)) g.aim = { x: 0, y: 0 }

        return true
      }
      g.drag = { sx: px, sy: py, held: false }
      g.aim = { x: 0, y: 0 }
      g.banner = null

      return true
    }
    if (g.phase === 'flying') return trigger(g)
    if (g.phase === 'won' || g.phase === 'lost') {
      proceed(g)

      return true
    }
    // Nothing to fling yet: say so, so a click is never met with silence.
    if (g.phase === 'waiting') {
      const f = g.forge
      setBanner(
        g,
        f.status === 'forging'
          ? `The Forge is still making "${f.prompt}"...`
          : 'Nothing in the slingshot yet: type an object in the Forge field.',
        60,
      )

      return true
    }

    return false
  }
  if (!g.drag) return false
  const k = MAX_PULL / PULL_PIXELS
  let ax = (g.drag.sx - px) * k
  let ay = (py - g.drag.sy) * k
  const len = Math.hypot(ax, ay)
  if (len > MAX_PULL) {
    ax = (ax / len) * MAX_PULL
    ay = (ay / len) * MAX_PULL
  }
  g.aim = { x: ax, y: ay }
  if (type === 'up' && !g.drag.held) {
    if (Math.hypot(px - g.drag.sx, py - g.drag.sy) < CLICK_PIXELS) {
      // A click: hold the sling and aim by moving.
      g.drag.held = true
      g.aim = { x: 0, y: 0 }

      return true
    }
    if (g.holdOnRelease) {
      // Let go: held where it was pulled, still aimed by moving.
      g.drag.held = true

      return true
    }
    g.drag = null
    if (!fire(g)) g.aim = { x: 0, y: 0 }
  }

  return true
}

export function key(g: Game, k: string): boolean {
  if (k === 'r') {
    restart(g)

    return true
  }
  if (k === ' ' || k === 'space' || k === 'return' || k === 'enter') {
    if (g.phase === 'aiming') {
      if (Math.hypot(g.aim.x, g.aim.y) < 0.3) setAim(g, 0.7, 0.75)

      return fire(g)
    }
    if (g.phase === 'flying') return trigger(g)
    if (g.phase === 'won' || g.phase === 'lost') {
      proceed(g)

      return true
    }

    return false
  }
  if (g.phase !== 'aiming') return false
  let len = Math.hypot(g.aim.x, g.aim.y)
  let ang = Math.atan2(g.aim.y, g.aim.x)
  if (len < 0.3) {
    len = 0.75 * MAX_PULL
    ang = 0.7
  }
  if (k === 'up') ang += 0.05
  else if (k === 'down') ang -= 0.05
  else if (k === 'right') len += 0.05 * MAX_PULL
  else if (k === 'left') len -= 0.05 * MAX_PULL
  else return false
  setAim(g, ang, len / MAX_PULL)

  return true
}

function setAim(g: Game, angle: number, power: number): void {
  const a = Math.max(-1.2, Math.min(1.5, angle))
  const p = Math.max(0.15, Math.min(1, power)) * MAX_PULL
  g.aim = { x: Math.cos(a) * p, y: Math.sin(a) * p }
}

/** Angle in degrees and power in percent of the current aim. */
export function aimReadout(g: Game): { degrees: number; power: number } {
  return {
    degrees: Math.round((Math.atan2(g.aim.y, g.aim.x) * 180) / Math.PI),
    power: Math.round((Math.hypot(g.aim.x, g.aim.y) / MAX_PULL) * 100),
  }
}

/** The line under the playfield: what to do now, or what just happened. */
export function statusLine(g: Game, keysHint: boolean): { text: string; color: string } {
  if (g.phase === 'aiming' && g.loaded && (g.drag || aimReadout(g).power >= 12)) {
    const aim = aimReadout(g)
    const how = g.drag?.held
      ? aim.power < 12
        ? 'move away from where you clicked to pull, click to fling'
        : 'click (or space) to fling'
      : g.holdOnRelease
        ? 'let go to hold it there, then click to fling'
        : 'release (or space) to fling'

    return { text: `${g.loaded.name}  ·  angle ${aim.degrees}°  ·  power ${aim.power}%  ·  ${how}`, color: '#e6ecff' }
  }
  if (g.banner) return { text: g.banner.text, color: '#ffd166' }
  const f = g.forge
  const forging = f.status === 'forging' ? `The Forge is making "${f.prompt}"...` : ''
  switch (g.phase) {
    case 'settling':
      return { text: 'Bugs are moving in...', color: '#9aa5c4' }
    case 'waiting':
      return forging
        ? { text: forging, color: '#ff8a3d' }
        : { text: 'Name anything in the Forge field and press Enter: the Forge turns it into your next shot.', color: '#9aa5c4' }
    case 'aiming': {
      const s = g.loaded
      if (!s) return { text: '', color: '#9aa5c4' }
      const extra = s.ability !== 'none' ? `  ·  click mid-air: ${powerName(s)}` : ''
      const traits = s.traits.length > 0 ? `  ·  ${s.traits.join(', ')}` : ''
      const keys = keysHint ? '  ·  keys: click here, ↑↓ angle, ←→ power, space' : ''

      return {
        text: `${s.name} (${s.width.toFixed(1)}×${s.height.toFixed(1)} m)${traits}${extra}  ·  ${
          g.holdOnRelease ? 'drag back (or click and move) to aim, then click to fling' : 'drag back and let go to fling, or click and move to aim'
        }${keys}`,
        color: '#e6ecff',
      }
    }
    case 'flying':
      return !g.abilityUsed && g.activeAbility !== 'none'
        ? { text: `Click or press space: ${(powerName(shotBodies(g)[0]?.spec ?? null) || VERB[g.activeAbility]).toUpperCase()}!`, color: '#ff8a3d' }
        : { text: forging || 'Wheee...', color: '#9aa5c4' }
    case 'won':
      return { text: `Level clear! Click or press space for level ${g.level + 1}.`, color: '#7ee787' }
    case 'lost':
      return { text: 'Out of shots. Click or press space to try again.', color: '#ff7b72' }
  }
}

// ---------------------------------------------------------------------------
// Rendering: a pixel buffer two pixels per terminal cell (upper and lower
// half), collapsed into runs of equal color pairs, one list per row.

export type Run = { fg: number; bg: number; n: number }

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)

  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const SKY_TOP = 0x0b1026
const SKY_LOW = 0x2b3d6e
const HILL = 0x1a2747
const HILL_FAR = 0x223259
const GRASS = 0x4c8a3f
const DIRT = 0x4a3524
const DIRT_DARK = 0x3d2b1d

function background(wx: number, wy: number, px: number, pr: number): number {
  if (wy < 0) {
    if (wy > -0.22) return GRASS
    return hash(px, pr) > 0.85 ? DIRT_DARK : DIRT
  }
  const far = 2.2 + 0.9 * Math.sin(wx * 0.23 + 1.3) + 0.5 * Math.sin(wx * 0.61)
  const near = 1.1 + 0.6 * Math.sin(wx * 0.37 + 4) + 0.3 * Math.sin(wx * 1.1 + 2)
  if (wy < near) return HILL
  if (wy < far) return HILL_FAR
  const sky = mix(SKY_LOW, SKY_TOP, wy / WORLD_H)
  if (wy > 4 && hash(px, pr) > 0.985) return mix(sky, 0xc8d4ff, 0.35 + hash(pr, px) * 0.5)

  return sky
}

export function render(g: Game, cols: number, rows: number): Run[][] {
  const PW = Math.max(1, Math.floor(cols))
  const PH = Math.max(2, Math.floor(rows) * 2)
  const s = Math.max(0.5, Math.min(PW / WORLD_W, PH / WORLD_H))
  const ox = (PW - WORLD_W * s) / 2
  g.view = { s, ox, PW, PH }
  const buf = new Uint32Array(PW * PH)

  for (let pr = 0; pr < PH; pr++) {
    const wy = (PH - (pr + 0.5)) / s - 1
    for (let px = 0; px < PW; px++) {
      buf[pr * PW + px] = background((px + 0.5 - ox) / s, wy, px, pr)
    }
  }

  const set = (px: number, pr: number, c: number) => {
    if (px >= 0 && px < PW && pr >= 0 && pr < PH) buf[pr * PW + px] = c
  }
  const toPx = (x: number, y: number) => ({ px: Math.floor(ox + x * s), pr: Math.floor(PH - (y + 1) * s) })
  const line = (x0: number, y0: number, x1: number, y1: number, c: number, thick = 0) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * s * 2) + 1
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const p = toPx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
      set(p.px, p.pr, c)
      if (thick > 0) set(p.px + 1, p.pr, c)
    }
  }

  // The launcher: a forked post with a band.
  const wood = 0x6b4628
  line(LAUNCHER_X, 0, LAUNCHER_X, 1.4, wood, 1)
  line(LAUNCHER_X, 1.4, TIP_L.x, TIP_L.y, wood, 1)
  line(LAUNCHER_X + 0.1, 1.4, TIP_R.x, TIP_R.y, wood, 1)
  const pouch = pouchPosition(g)
  const band = 0xe8b67a
  if (g.loaded) line(TIP_L.x, TIP_L.y, pouch.x, pouch.y, band)

  for (const b of g.bodies) if (b.kind !== 'ground') paintBody(buf, g.view, b)
  for (const j of g.joints) {
    const p = toPx(jointAnchor(j).x, jointAnchor(j).y)
    set(p.px, p.pr, 0x9be564)
  }

  if (g.loaded) {
    const spec = g.loaded
    paintShape(buf, g.view, pouch.x, pouch.y, 0, shapeOf(spec), visible(parseColor(spec.color)), 'shot')
    line(TIP_R.x, TIP_R.y, pouch.x, pouch.y, band)
    const arc = trajectory(g)
    for (let i = 1; i < arc.points.length; i += 2) {
      const p = toPx(arc.points[i]!.x, arc.points[i]!.y)
      set(p.px, p.pr, 0xe6ecff)
    }
    if (arc.hit) {
      const p = toPx(arc.hit.x, arc.hit.y)
      for (const [dx, dy] of [[0, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]] as const) set(p.px + dx, p.pr + dy, 0xff8a3d)
    }
  } else {
    line(TIP_L.x, TIP_L.y, TIP_R.x, TIP_R.y, band)
  }

  for (const fx of g.effects) {
    if (fx.kind !== 'vortex') continue
    for (let i = 0; i < 24; i++) {
      const ang = i * 0.7 + fx.t * 9
      const rr = (i / 24) * fx.r * 0.8
      const p = toPx(fx.x + Math.cos(ang) * rr, fx.y + Math.sin(ang) * rr)
      set(p.px, p.pr, i % 2 ? 0xb69cff : 0xe6ecff)
    }
  }

  for (const p of g.particles) {
    const q = toPx(p.x, p.y)
    set(q.px, q.pr, p.color)
  }
  for (const p of g.pellets) {
    const q = toPx(p.x, p.y)
    set(q.px, q.pr, p.color)
    if (roundRadius(p.round, p.age) >= 0.2) set(q.px + 1, q.pr, p.color)
  }

  const out: Run[][] = []
  for (let row = 0; row < PH / 2; row++) {
    const runs: Run[] = []
    let last: Run | undefined
    for (let px = 0; px < PW; px++) {
      const fg = buf[row * 2 * PW + px]!
      const bg = buf[(row * 2 + 1) * PW + px]!
      if (last && last.fg === fg && last.bg === bg) last.n++
      else {
        last = { fg, bg, n: 1 }
        runs.push(last)
      }
    }
    out.push(runs)
  }

  return out
}

function paintBody(buf: Uint32Array, v: View, b: Body): void {
  if (b.kind === 'bug') {
    paintBox(buf, v, b.x, b.y, b.a, b.hw, b.hh, tint(b, BUG.color), 'bug')

    return
  }
  paintShape(buf, v, b.x, b.y, b.a, b, tint(b, b.color), b.mat)
}

/** A body's color with what is at work on it: fire, frost, wet, acid, a shock. */
function tint(b: Body, c: number): number {
  if (b.zap > 0) return mix(c, 0xfff36b, 0.6)
  if (b.fire > 0) return mix(c, 0xff6a2a, 0.55)
  if (b.frost > 0) return mix(c, 0xdff6ff, 0.6)
  if (b.corrode > 0) return mix(c, 0x8cff3a, 0.4)
  if (b.soak > 0) return mix(c, 0x3fa7ff, 0.3)

  return c
}

/** Any outline: boxes by paintBox, polygons and circles pixel by pixel against their edges. */
function paintShape(
  buf: Uint32Array,
  v: View,
  x: number,
  y: number,
  a: number,
  info: ShapeInfo,
  color: number,
  mat: Material,
): void {
  if (info.shape === 'box') {
    paintBox(buf, v, x, y, a, info.hw, info.hh, color, mat)

    return
  }
  const { s, ox, PW, PH } = v
  const c = Math.cos(a)
  const sn = Math.sin(a)
  const reach = Math.max(info.r, 0.55 / s)
  const px0 = Math.max(0, Math.floor(ox + (x - reach) * s))
  const px1 = Math.min(PW - 1, Math.ceil(ox + (x + reach) * s))
  const pr0 = Math.max(0, Math.floor(PH - (y + reach + 1) * s))
  const pr1 = Math.min(PH - 1, Math.ceil(PH - (y - reach + 1) * s))
  const edgeW = 0.9 / s
  const bordered = info.r * s >= 2
  const edge = shade(color, 0.6)
  const n = info.verts.length / 2

  for (let pr = pr0; pr <= pr1; pr++) {
    const wy = (PH - (pr + 0.5)) / s - 1
    for (let px = px0; px <= px1; px++) {
      const wx = (px + 0.5 - ox) / s
      const dx = wx - x
      const dy = wy - y
      const lx = c * dx + sn * dy
      const ly = -sn * dx + c * dy
      // How far inside the outline the pixel is; negative is outside.
      let inside: number
      if (info.shape === 'circle') inside = Math.max(info.rad, 0.55 / s) - Math.hypot(lx, ly)
      else {
        inside = Infinity
        for (let i = 0; i < n; i++) {
          const d = -(info.norms[2 * i]! * (lx - info.verts[2 * i]!) + info.norms[2 * i + 1]! * (ly - info.verts[2 * i + 1]!))
          if (d < inside) inside = d
        }
      }
      if (inside < 0) continue
      let col = color
      if (bordered && inside < edgeW) col = edge
      // A stripe across a circle shows it rolling.
      else if (info.shape === 'circle' && Math.abs(ly) < edgeW * 0.7) col = shade(color, 0.82)
      else if (ly > info.hh * 0.35) col = shade(color, 1.15)
      buf[pr * PW + px] = col
    }
  }
}

function paintBox(
  buf: Uint32Array,
  v: View,
  x: number,
  y: number,
  a: number,
  hw0: number,
  hh0: number,
  color: number,
  mat: Material,
): void {
  const { s, ox, PW, PH } = v
  // Never thinner than a pixel, so a thin post still shows.
  const hw = Math.max(hw0, 0.55 / s)
  const hh = Math.max(hh0, 0.55 / s)
  const c = Math.cos(a)
  const sn = Math.sin(a)
  const ex = Math.abs(c) * hw + Math.abs(sn) * hh
  const ey = Math.abs(sn) * hw + Math.abs(c) * hh
  const px0 = Math.max(0, Math.floor(ox + (x - ex) * s))
  const px1 = Math.min(PW - 1, Math.ceil(ox + (x + ex) * s))
  const pr0 = Math.max(0, Math.floor(PH - (y + ey + 1) * s))
  const pr1 = Math.min(PH - 1, Math.ceil(PH - (y - ey + 1) * s))
  const edgeW = 0.9 / s
  const bordered = hw * s >= 1.5 && hh * s >= 1.5
  const edge =
    mat === 'wood'
      ? MATERIALS.wood.edge
      : mat === 'stone'
        ? MATERIALS.stone.edge
        : mat === 'glass'
          ? MATERIALS.glass.edge
          : mat === 'bug'
            ? BUG.edge
            : shade(color, 0.6)

  for (let pr = pr0; pr <= pr1; pr++) {
    const wy = (PH - (pr + 0.5)) / s - 1
    for (let px = px0; px <= px1; px++) {
      const wx = (px + 0.5 - ox) / s
      const dx = wx - x
      const dy = wy - y
      const lx = c * dx + sn * dy
      const ly = -sn * dx + c * dy
      if (Math.abs(lx) > hw || Math.abs(ly) > hh) continue
      let col = color
      if (bordered && (hw - Math.abs(lx) < edgeW || hh - Math.abs(ly) < edgeW)) col = edge
      else if (mat === 'glass' && Math.abs(lx - ly * 0.6) < edgeW * 0.6) col = 0xe4f7ff
      else if (mat === 'wood' && hash(Math.round(lx * 3), 7) > 0.8) col = shade(color, 0.88)
      else if (mat === 'shot' && ly > hh * 0.35) col = shade(color, 1.15)
      buf[pr * PW + px] = col
    }
  }

  if (mat === 'bug') {
    // Two eyes and two antennae, a pixel each, wherever the bug has rolled.
    const dot = (lx: number, ly: number, col: number) => {
      const wx = x + c * lx - sn * ly
      const wy = y + sn * lx + c * ly
      const px = Math.floor(ox + wx * s)
      const pr = Math.floor(PH - (wy + 1) * s)
      if (px >= 0 && px < PW && pr >= 0 && pr < PH) buf[pr * PW + px] = col
    }
    const eye = Math.max(hw * 0.45, 0.6 / s)
    dot(-eye, hh * 0.3, 0xffffff)
    dot(eye, hh * 0.3, 0xffffff)
    dot(-hw * 0.6, hh + 0.6 / s, BUG.edge)
    dot(hw * 0.6, hh + 0.6 / s, BUG.edge)
  }
}
