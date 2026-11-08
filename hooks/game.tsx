// The game's surface module: runs inside the pane's `Client` on the drawing
// thread. It owns the game loop (the surface's frame clock), the mouse and
// keys. On the terminal it draws each frame as rows of half-block cells.
//
// On the desktop (`vector`) it draws nothing, lying invisible over the
// pane's `Svg`, and posts SVG documents to the hooks module, which shows
// them. Every post crosses to the hooks module and back before it shows, so
// a shot in flight is not posted frame by frame: it is run ahead to the end
// of its turn at once (replay.ts) and posted as one animation the surface
// plays at its own frame rate. A click mid-flight fires the ability at the
// moment its flight will first show, from the game as it will be then, and
// posts the rest: the new flight takes over where the old one is, the power
// seen from its start. Aiming, which follows the pointer, is posted frame by
// frame.

import type { ClientKeyEvent, ClientModule, ClientPointerEvent } from 'claude-code'

import type { Forge, GameProps, GameResult } from '../types'
import {
  bugsLeft,
  hexColor,
  key,
  newGame,
  pointer,
  pouchPosition,
  render,
  setForge,
  settleNow,
  statusLine,
  tick,
  TICK_MS,
  trigger,
  type Game,
  type Run,
} from './engine'
import { fly } from './replay'
import { aimCells, animation, pictureSize, vector, type View } from './vector'

type Local = { n: number; game: Game }

/** A shot playing as an animation. */
type Playing = {
  /** The post that carries it, when it went, and when it began to show (null until it does). */
  seq: number
  postedAt: number
  shownAt: number | null
  ticks: number
  /** The game at each tick it shows, while its ability can still fire. */
  snaps: Game[]
}

/** One mounted instance: its game, and on the desktop what it owes the hooks module. */
type Instance = {
  game: Game
  vector: boolean
  forge: Forge
  /** A frame to post as soon as one may go. */
  pending: boolean
  playing: Playing | null
  /** Results sent with every frame for a while, as a later post can replace an undelivered one. */
  outbox: { result: GameResult; left: number }[]
  /**
   * The game's own time in ms, moved on by its frame clock: what the pacing
   * of posts and animations is measured on, as a driven clock (a test's)
   * fires without the wall clock moving.
   */
  clock: number
  /** The last frame posted and when, by the game's clock and the wall's; `ack` says which one the hooks module took. */
  sent: number
  sentAt: number
  sentWall: number
  acked: number
  /** How long a post takes to be taken, on average. */
  lag: number
  /**
   * How long a flight takes to be drawn, on average, from when it went or the
   * button last went up, whichever came later: the desktop draws nothing new
   * in the pane while a button is down over it. About 40 ms in the app.
   */
  applyLag: number
  /** When the button last went up over the game, and whether one is down. */
  upAt: number
  buttonDown: boolean
  /** A click mid-flight, waiting for the button to go up before its ability's flight is posted. */
  armed: { since: number } | null
  /** The wall clock at the last tick, to tell the time between ticks. */
  wall: number
  /** The props last drawn from, less `ack`: a change is something new to show. */
  seen: string
  /** Whether the last drawing showed the aim's arc. */
  arcShown: boolean
  /** Where the pouch was in the last aiming frame posted, and when that went. */
  lastPouch: { x: number; y: number } | null
  aimPostAt: number
  /** The last flight the pane drew, by the `drawn` prop. */
  drawn: number
  /** What of the world the pane's picture shows, its shape the pane's. */
  view: View
}

/** Rows the game draws above and below the playfield. */
const HUD_TOP = 1
const HUD_BOTTOM = 1
/** Above this many color runs a frame risks the drawing's size bound. */
const MAX_RUNS = 1100
/** How many frames carry a result. */
const RESEND = 30
/** Frames on their way at once: enough to hide the trip, few enough not to queue. */
const IN_FLIGHT = 3
/** How long a posted frame may go unshown before it is taken as lost. */
const ACK_WAIT = 300
/** The same while the sling is drawn back, when the arc must follow the pointer. */
const DRAG_IN_FLIGHT = 4
const DRAG_ACK_WAIT = 150
/**
 * While aiming, a frame at most this often, and each one glides the sling
 * over as long from where the last one left it. A pane is drawn ten times a
 * second at most: a little slower than that, every frame is drawn, and the
 * glides join up into one smooth pull.
 */
const AIM_FRAME_MS = 120
/** An ability armed this long goes anyway, the button still down. */
const ARMED_MAX_MS = 1500

/**
 * The game's clock now, to the millisecond: its last tick and the wall's
 * time since, which a driven clock (a test's) leaves at nothing.
 */
function nowOf(inst: Instance): number {
  return inst.clock + Math.min(TICK_MS, Math.max(0, Date.now() - inst.wall))
}

// One game per mounted instance. The instance's `state` holds it too; the
// map is the first place looked, so a game survives however state is kept.
const instances = new WeakMap<object, Instance>()
let results = 0

function start(props: GameProps, surface: Parameters<ClientModule<GameProps, Local>>[1], game?: Game): Instance {
  const inst: Instance = {
    game: game ?? newGame(props.level, props.best),
    vector: props.vector,
    view: pictureSize(props.cols, props.rows).view,
    forge: props.forge,
    pending: true,
    playing: null,
    outbox: [],
    sent: 0,
    clock: 0,
    sentAt: 0,
    sentWall: 0,
    acked: props.ack,
    lag: 80,
    applyLag: 60,
    upAt: -1e9,
    buttonDown: false,
    armed: null,
    wall: Date.now(),
    seen: '',
    arcShown: false,
    lastPouch: null,
    aimPostAt: -1e9,
    drawn: 0,
  }
  instances.set(surface, inst)
  // The desktop draws nothing new while a button is held, so letting go of
  // a drag holds the sling where it was pulled, to show it, for a click to fling.
  inst.game.holdOnRelease = inst.vector
  let n = 0
  const redraw = () => {
    if (!inst.vector) {
      surface.setState({ n: ++n, game: inst.game })

      return
    }
    inst.pending = true
    // The aim's arc is drawn here, under the pointer: draw it again now,
    // and once more after it, to take it away.
    if (inst.game.phase === 'aiming' || inst.arcShown) surface.setState({ n: ++n, game: inst.game })
  }

  const post = (svg: string, alt: string, anim: boolean) => {
    inst.sent++
    inst.sentAt = inst.clock
    inst.sentWall = Date.now()
    surface.post({ type: 'frame', seq: inst.sent, anim, svg, alt, results: inst.outbox.map(o => o.result) })
    for (const o of inst.outbox) o.left--
    inst.outbox = inst.outbox.filter(o => o.left > 0)
  }

  const now = () => nowOf(inst)

  /**
   * Runs a shot in flight to the end of its turn and posts it as one
   * animation, `skip` ms into its first tick.
   */
  const launch = (skip = 0) => {
    const g = inst.game
    const flight = fly(g, inst.view)
    setForge(g, inst.forge)
    post(animation(flight.rec, inst.view, skip), 'The shot in flight.', true)
    inst.playing = { seq: inst.sent, postedAt: now(), shownAt: null, ticks: flight.rec.ticks, snaps: flight.snaps }
    inst.pending = false
  }

  /** Whether the flight on screen can still fire its ability. */
  const ready = (play: Playing) => {
    const g = play.snaps[0]

    return !!g && g.activeAbility !== 'none' && !g.abilityUsed
  }

  /**
   * A click or space mid-flight asks for the ability. Its flight waits for
   * `release`: the desktop draws nothing new in the pane while the button
   * is down.
   */
  const arm = (): boolean => {
    const play = inst.playing
    if (!play || inst.armed || !ready(play)) return false
    inst.armed = { since: now() }

    return true
  }

  /**
   * Once the button is up: fires the ability at the moment its flight will
   * first show, in the game as it will be then, and posts that flight. The
   * shot is where the flight on screen has it at that moment, so the new
   * one takes over without a jump, and the power is seen from its start.
   * (Fired at the click instead, its start would go by before it showed.)
   */
  const release = () => {
    const armed = inst.armed
    const play = inst.playing
    if (!armed || !play || play.shownAt === null) return
    const t = now()
    if (inst.buttonDown && t - armed.since < ARMED_MAX_MS) return
    inst.armed = null
    // How long flights have taken to show, alone: the posts' round trip
    // (`lag`) runs longer than the pane takes to draw, and a flight expected
    // that late shows ahead of the one it takes over from.
    const wait = inst.applyLag
    // The tick the flight on screen will be at, to the fraction, when the new one shows.
    const at = Math.max(0, (t + wait - play.shownAt) / TICK_MS)
    const from = Math.floor(at)
    const g = play.snaps[from]
    if (!g || g.phase !== 'flying' || g.abilityUsed || !trigger(g)) return
    inst.game = g
    inst.playing = null
    launch((at - from) * TICK_MS)
  }

  const flush = () => {
    const g = inst.game
    if (!inst.vector) {
      const ev = g.events.shift()
      if (ev) surface.post(ev)

      return
    }
    if (g.phase === 'settling') {
      settleNow(g)
      inst.pending = true
    }
    if (g.phase === 'flying' && !inst.playing) {
      launch()

      return
    }
    // Results wait for the animation that ends in them.
    if (inst.playing) return
    for (const ev of g.events.splice(0)) {
      const id = `${Date.now().toString(36)}-${(results++).toString(36)}`
      inst.outbox.push({ result: { id, level: ev.level, score: ev.score, won: ev.won }, left: RESEND })
      inst.pending = true
    }
    if (!inst.pending) return
    const now = inst.clock
    const aiming = g.phase === 'aiming' && g.loaded !== null
    if (aiming && now - inst.aimPostAt < AIM_FRAME_MS) return
    const dragging = g.drag !== null
    if (inst.sent - inst.acked >= (dragging ? DRAG_IN_FLIGHT : IN_FLIGHT)) {
      if (now - inst.sentAt < (dragging ? DRAG_ACK_WAIT : ACK_WAIT)) return
      inst.acked = inst.sent
    }
    inst.pending = false
    const { svg, alt } = vector(g, inst.view, false, aiming ? inst.lastPouch : null, AIM_FRAME_MS)
    post(svg, alt, false)
    inst.lastPouch = aiming ? pouchPosition(g) : null
    if (aiming) inst.aimPostAt = now
    // Keep posting while a result still rides along.
    if (inst.outbox.length > 0) inst.pending = true
  }

  surface.every(TICK_MS, () => {
    const w = Date.now()
    inst.clock += Math.max(w - inst.wall, TICK_MS)
    inst.wall = w
    const now = inst.clock
    release()
    const play = inst.playing
    if (play) {
      // An animation the pane never said it shows is taken as showing.
      if (play.shownAt === null && now - inst.sentAt > 1500) play.shownAt = now - inst.lag
      // The live game waits at the end of the turn until the animation reaches it.
      if (play.shownAt !== null && now - play.shownAt >= play.ticks * TICK_MS + 250) {
        inst.playing = null
        inst.armed = null
        inst.pending = true
      }
    } else if (tick(inst.game)) redraw()
    flush()
  })
  surface.onPointer((ev: ClientPointerEvent) => {
    if (ev.type === 'enter') return
    if (ev.type === 'leave' || ev.type === 'up') {
      inst.buttonDown = false
      inst.upAt = now()
    }
    if (ev.type === 'leave') return
    if (ev.type === 'down' && ev.button !== undefined && ev.button !== 'left') return
    if (ev.type === 'down') inst.buttonDown = true
    if (inst.playing) {
      if (ev.type === 'down') arm()

      return
    }
    const x = ev.fine?.x ?? ev.x + 0.5
    const y = ev.fine?.y ?? ev.y + 0.5
    if (pointer(inst.game, ev.type, x, (y - (inst.vector ? 0 : HUD_TOP)) * 2)) redraw()
    flush()
  })
  surface.onKey((ev: ClientKeyEvent) => {
    if (ev.ctrl || ev.meta) return
    if (inst.playing) {
      if (ev.key === ' ' || ev.key === 'space' || ev.key === 'return') arm()

      return
    }
    if (key(inst.game, ev.key)) redraw()
    flush()
  })
  if (!inst.vector) surface.setState({ n, game: inst.game })

  return inst
}

const PromptAndDestroy: ClientModule<GameProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const inst = instances.get(surface) ?? start(props, surface, surface.state?.game)
  const g = inst.game
  inst.forge = props.forge
  g.best = Math.max(g.best, props.best)
  setForge(g, props.forge)

  const cols = surface.columns
  const rows = surface.rows
  if (inst.vector) {
    // The pane's shape picks what of the world its picture shows: the same
    // pick as the hooks module's, made from the same rows and columns.
    inst.view = pictureSize(props.cols, props.rows).view
    // A flight's clock starts when the pane has drawn it, not when it was taken.
    if ((props.drawn ?? 0) > inst.drawn) {
      inst.drawn = props.drawn ?? 0
      const play = inst.playing
      if (play && play.shownAt === null && inst.drawn >= play.seq) {
        const t = nowOf(inst)
        play.shownAt = t
        const waited = t - Math.max(play.postedAt, inst.upAt)
        inst.applyLag = Math.min(600, inst.applyLag * 0.5 + waited * 0.5)
      }
    }
    if (props.ack > inst.acked) {
      if (props.ack === inst.sent && inst.sent > 0) inst.lag = inst.lag * 0.8 + (Date.now() - inst.sentWall) * 0.2
      inst.acked = props.ack
    }
    // Something new to show (not just a frame shown): post a fresh one.
    const f = props.forge
    const seen = `${f.status}:${f.status === 'ready' ? f.item.id : f.status === 'forging' ? f.id : ''}:${props.level}:${props.best}:${props.rows}:${props.epoch}:${cols}x${rows}`
    if (seen !== inst.seen) {
      inst.seen = seen
      inst.pending = true
    }

    // The desktop makes the region as tall as what is drawn in it, so blank
    // rows hold it open over the picture: an empty box of its own measured
    // height would start at nothing and stay one row tall. Over them, the
    // aim's arc: drawn here it follows the pointer at once, where the pane's
    // own drawing waits while a button is held or the pointer streams.
    const arc = aimCells(g, props.cols, props.rows)
    inst.arcShown = arc.length > 0

    return (
      <Box flexDirection="column" position="relative" width={cols || undefined} height={props.rows}>
        {Array.from({ length: props.rows }, () => (
          <Text> </Text>
        ))}
        {arc.map(c => (
          <Box position="absolute" top={c.row} left={c.col}>
            <Text color={c.color} bold>
              {c.text}
            </Text>
          </Box>
        ))}
      </Box>
    )
  }
  if (cols === 0 || rows === 0) return <Text dimColor>Loading Prompt & Destroy...</Text>
  if (cols < 40 || rows < 10) {
    return (
      <Text color="#ffd166" wrap="wrap">
        Prompt & Destroy needs at least 40×10 cells (it has {cols}×{rows}). Widen the pane, or run Claude Code in fullscreen.
      </Text>
    )
  }

  let lines = render(g, cols, rows - HUD_TOP - HUD_BOTTOM)
  if (lines.reduce((n, r) => n + r.length, 0) > MAX_RUNS) lines = coarse(lines)

  const bugs = bugsLeft(g)
  const used = Math.max(0, g.maxShots - g.shots)
  const st = statusLine(g, true)

  return (
    <Box flexDirection="column" width={cols}>
      <Text wrap="truncate-end">
        <Text bold color="#ff8a3d">
          {' PROMPT & DESTROY '}
        </Text>
        <Text dimColor>│ </Text>
        <Text>
          Level {g.level}: {g.title}{' '}
        </Text>
        <Text dimColor>│ </Text>
        <Text>Shots </Text>
        <Text color="#ffd166">{'●'.repeat(Math.max(0, g.shots)) + '○'.repeat(used)} </Text>
        <Text dimColor>│ </Text>
        <Text>Bugs </Text>
        <Text color="#d68ae6">{bugs} </Text>
        <Text dimColor>│ </Text>
        <Text>Score {g.score} </Text>
        <Text dimColor>│ Best {Math.max(g.best, g.score)}</Text>
      </Text>
      {lines.map(runs => (
        <Text wrap="truncate-end">
          {runs.map(r => (
            <Text color={hexColor(r.fg)} backgroundColor={hexColor(r.bg)}>
              {'▀'.repeat(r.n)}
            </Text>
          ))}
        </Text>
      ))}
      <Text wrap="truncate-end" color={st.color}>
        {' ' + st.text}
      </Text>
    </Box>
  )
}

/** Fewer, longer runs: colors snapped to a coarser grid, then merged again. */
function coarse(lines: Run[][]): Run[][] {
  const snap = (c: number) => c & 0xe0e0e0

  return lines.map(runs => {
    const out: Run[] = []
    for (const r of runs) {
      const fg = snap(r.fg)
      const bg = snap(r.bg)
      const last = out[out.length - 1]
      if (last && last.fg === fg && last.bg === bg) last.n += r.n
      else out.push({ fg, bg, n: r.n })
    }

    return out
  })
}

export default PromptAndDestroy
