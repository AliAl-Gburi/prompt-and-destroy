// A shot, run ahead: the game ticked to the end of its turn at once, each
// tick recorded for the animation (vector.ts) and, while the shot's ability
// can still fire, kept whole, so a click mid-flight picks up from the moment
// the player saw.
//
// Pure, like engine.ts and vector.ts.

import { cloneGame, elementCode, tick, type Body, type Game, type Pellet } from './engine'
import { BASE_VIEW, crackLevel, heading, hudMarkup, useView, wordsMarkup, type PelletTrack, type Recording, type Track, type View } from './vector'

/** The longest a turn is recorded; the engine ends one after 14 seconds anyway. */
const MAX_TICKS = 400

export type Flight = {
  /** The game as it was at each tick of the recording, while a click can still change it. */
  snaps: Game[]
  rec: Recording
}

/** Runs `g` to the end of its turn, recording each tick; `g` is left there. */
export function fly(g: Game, v: View = BASE_VIEW): Flight {
  // Its words are drawn as they will show, in the picture the flight is for.
  useView(v)
  const tracks = new Map<Body, Track>()
  const rounds = new Map<Pellet, PelletTrack>()
  const seen = new WeakSet<object>()
  const shot = g.bodies.find(b => b.kind === 'shot' && g.active.has(b.id))
  const rec: Recording = {
    ticks: 0,
    tracks: [],
    pellets: [],
    sparks: [],
    effects: [],
    path: [],
    joints: [],
    hud: [],
    words: [],
    ready: [],
    look: shot ? { x: shot.x, y: shot.y } : null,
  }

  const capture = (t: number) => {
    const alive = new Set(g.bodies)
    for (const b of g.bodies) {
      if (b.kind === 'ground') continue
      let tr = tracks.get(b)
      if (!tr) {
        tr = { body: b, born: t, died: -1, poses: [], cracked: [-1, -1], flash: -1, states: [] }
        tracks.set(b, tr)
        rec.tracks.push(tr)
      }
      tr.poses.push(b.x, b.y, b.a)
      tr.states.push(elementCode(b))
      if (b.powerAt >= 0 && tr.flash < 0) tr.flash = t
      const level = b.kind === 'block' ? crackLevel(b) : 0
      if (level >= 1 && tr.cracked[0] < 0) tr.cracked[0] = t
      if (level >= 2 && tr.cracked[1] < 0) tr.cracked[1] = t
    }
    for (const tr of rec.tracks) if (tr.died < 0 && !alive.has(tr.body)) tr.died = t
    for (const p of g.pellets) {
      let pt = rounds.get(p)
      if (!pt) {
        pt = { src: p, round: p.round, color: p.color, born: t, died: -1, heading: heading(p.vx, p.vy), poses: [] }
        rounds.set(p, pt)
        rec.pellets.push(pt)
      }
      pt.poses.push(p.x, p.y)
    }
    const flying = new Set(g.pellets)
    for (const pt of rec.pellets) if (pt.died < 0 && !flying.has(pt.src)) pt.died = t
    for (const p of g.particles) {
      if (seen.has(p)) continue
      seen.add(p)
      rec.sparks.push({ born: t, ...p })
    }
    for (const fx of g.effects) {
      if (seen.has(fx)) continue
      seen.add(fx)
      rec.effects.push({ born: t, fx: { ...fx } })
    }
    for (const j of g.joints) {
      if (seen.has(j)) continue
      seen.add(j)
      const tr = tracks.get(j.a)
      if (tr) rec.joints.push({ born: t, track: tr, x: j.lax, y: j.lay })
    }
    for (let i = rec.path.length; i < g.path.length; i++) rec.path.push({ x: g.path[i]!.x, y: g.path[i]!.y, born: t })
    rec.hud.push(hudMarkup(g))
    rec.words.push(wordsMarkup(g))
    const ready = g.phase === 'flying' && !g.abilityUsed && g.activeAbility !== 'none'
    const glowing = ready ? g.bodies.find(b => b.kind === 'shot' && g.active.has(b.id)) : undefined
    rec.ready.push(glowing ? (tracks.get(glowing) ?? null) : null)
  }

  const snaps: Game[] = []
  capture(0)
  let t = 0
  while (g.phase === 'flying' && t < MAX_TICKS) {
    // Only a ready ability makes a later moment worth resuming from.
    if (!g.abilityUsed && g.activeAbility !== 'none') snaps.push(cloneGame(g))
    tick(g)
    t++
    capture(t)
  }
  rec.ticks = t

  return { snaps, rec }
}
