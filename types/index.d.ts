/** What a click mid-air does: one per object, and the Forge gives every object one. */
export type Ability = 'none' | 'explode' | 'split' | 'rocket' | 'grow' | 'dive' | 'boomerang' | 'vortex' | 'shoot'

/** A stock look for a round the Forge drew nothing for. */
export type Ammo = 'bullet' | 'laser' | 'water' | 'fire' | 'spike' | 'ball' | 'note' | 'star' | 'bubble' | 'gas' | 'zap'

/** Which way a `shoot` power comes out of the drawing; `around` is every way at once. */
export type Facing = 'right' | 'left' | 'up' | 'down' | 'around'

/** Where a `shoot` power fires: the object turns so its facing points there. */
export type Aim = 'target' | 'ahead' | 'back' | 'up' | 'down'

/**
 * What a thing is made of and carries, as the world's chemistry reads it.
 * Each 0 to 1, but heat -1 to 1; the Forge rates every object and every round
 * on all nine, and the game's laws work between any two that touch.
 */
export type Matter = {
  /** -1 freezing, 0 room temperature, 1 burning. */
  heat: number
  /** How readily it catches fire, and how long it burns. */
  burns: number
  /** How violently it goes off once lit or shocked. */
  explodes: number
  /** How readily heat melts it. */
  melts: number
  /** How much water it is or holds. */
  wet: number
  /** The live electricity it carries. */
  electric: number
  /** How well electricity runs through it. */
  conducts: number
  /** How strongly it eats away what it touches. */
  acid: number
  /** How readily acid eats it. */
  dissolves: number
}

/**
 * What a `shoot` power fires, as the Forge made it for the object: how it
 * flies, what it does to what it hits, and how it looks. Every number clamped.
 */
export type Round = {
  /** Its drawing pointing right, in centimeters of its box as `Item.art` is; '' for none. */
  art: string
  /** A stock look for when it has no drawing; '' for a plain shape in its color. */
  look: Ammo | ''
  /** Meters, 0.02 to 1.5. */
  width: number
  height: number
  color: string
  /** How many it fires, 1 to 30, and seconds between them (0: all at once). */
  count: number
  every: number
  /** Degrees each strays from the aim either way, 0 to 45. */
  spread: number
  /** Meters a second as it leaves, 2 to 60. */
  speed: number
  /** How hard gravity pulls it: 1 like a stone, 0 not at all, below 0 it rises. */
  gravity: number
  /** How hard it hits, 0 to 3. */
  punch: number
  /** Meters: the explosion where it hits or runs out, 0 for none, up to 4. */
  blast: number
  /** What it flies on through: nothing, glass (breaking it), or everything (harming what lives as it passes). */
  pierce: 'none' | 'glass' | 'all'
  /** How much it bounces off what it hits, 0 to 0.9. */
  bounce: number
  /** What it is: hot, cold, wet, live or corrosive, as an object's matter. */
  matter: Matter
  /** Seconds before it is gone, 0.2 to 4. */
  life: number
  /** A puff: it swells, slows and fades as it goes. */
  fade: boolean
  /** Points along its flight, tumbles, or stays as drawn. */
  turn: 'point' | 'spin' | 'upright'
  /** The color of the streak it leaves behind; '' for none. */
  trail: string
}

/** The object's power: its name, and for `shoot`, where its rounds come out, where they go, and what they are. */
export type Power = {
  /** What the power is called on screen, such as "Blowhole Spout". */
  name: string
  /** Where the rounds come out: meters from the bounding box's center, y up. */
  from: [number, number]
  facing: Facing
  aim: Aim
  round: Round
}

/** What an object always does, up to two per object. */
export type Trait = 'floaty' | 'fragile' | 'sticky' | 'magnetic' | 'piercing'

/** The object's collision outline. */
export type Shape = 'box' | 'circle' | 'polygon'

/** A projectile the Forge made of the player's prompt. */
export type Item = {
  id: string
  prompt: string
  name: string
  /** Meters, 0.3 to 3: the object's bounding box. */
  width: number
  height: number
  /** Relative to water, 0.05 to 15. */
  density: number
  friction: number
  bounce: number
  color: string
  shape: Shape
  /**
   * For a `polygon`: its convex outline, 3 to 8 points, counter-clockwise, in
   * meters from the bounding box's center with y up. Empty for the others.
   */
  points: [number, number][]
  ability: Ability
  power: Power
  /** What it is made of and carries. */
  matter: Matter
  traits: Trait[]
  /**
   * The object drawn as SVG elements (no `<svg>` around them) in centimeters:
   * a box from 0,0 to width*100,height*100 with y down. Sanitized; '' for none.
   */
  art: string
  quip: string
}

export type Forge =
  | { status: 'idle' }
  | { status: 'forging'; id: string; prompt: string }
  | { status: 'ready'; item: Item; note: string | null }

/** The level to start at and the best score, kept across sessions. */
export type Progress = { level: number; best: number }

/**
 * What the pane hands the game's Client. `vector`: draw nothing, post SVG
 * frames. `cols` and `rows`: the region's size in cells, which on the
 * desktop the module has to draw itself (the region is as tall as what it
 * draws), and which sizes the picture the module's aim arc lies over.
 * `epoch`: new on each load of the hooks module, so a running Client posts a
 * fresh frame to a module that has none yet. `ack`: the last frame the hooks
 * module took, handed back in its answer to the post (0 in the drawing, which
 * then never changes the Client's props from frame to frame), so the Client
 * posts no faster than frames are taken.
 */
export type GameProps = {
  forge: Forge
  level: number
  best: number
  vector: boolean
  cols: number
  rows: number
  epoch: number
  ack: number
  /** The flight the pane last drew, so the Client knows when it shows. */
  drawn?: number
}

/** A finished level, tagged so a repeated post counts once. */
export type GameResult = { id: string; level: number; score: number; won: boolean }

/** What the game's Client posts to the hooks module. */
export type GameMessage =
  | { type: 'result'; level: number; score: number; won: boolean }
  | {
      type: 'frame'
      seq: number
      /** An animation of a whole flight (drawn where SMIL runs), or one still frame. */
      anim: boolean
      svg: string
      alt: string
      results: GameResult[]
    }

declare module 'claude-code' {
  interface PluginState {
    'prompt-and-destroy': { forge: Shaped<Forge>; progress: Shaped<Progress> }
  }
}
