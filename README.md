# Prompt & Destroy

A slingshot physics game that runs in a Claude Code pane, in the desktop app or the terminal.
Type any object (a grand piano, a jar of angry bees, your overflowing inbox) and the Forge
(Claude Sonnet) turns it into a projectile: its size, weight, bounce, a real collision shape,
powers that fit it, and a cartoon drawing of it. Fling it at towers of wood, glass and stone
to squash the bugs hiding inside.

## Install

You need Claude Code 2.1.275 or later. The desktop app draws the game as pictures; the
terminal draws it in coloured cells. Each object you forge is one Claude Sonnet call,
billed to your own Claude Code session.

From the GitHub repository that holds this folder (put its `<owner>/<repo>` in):

```
/plugin install prompt-and-destroy --marketplace <owner>/<repo>
```

Or from a copy of this folder: put it at `~/.claude/skills/prompt-and-destroy/` and
start a new Claude Code session.

## Play

- `/prompt-and-destroy` opens the game; `/prompt-and-destroy reset` starts over at level 1.
- Type in the Forge field and press Enter to make your next shot.
- Drag anywhere on the playfield to aim, release to fling. Or click the playfield and use
  ↑↓ for angle, ←→ for power, space to fling.
- Five handmade levels, then endless generated ones. Progress and best score are kept.

## What the Forge decides

- **Shape**: round things are circles and roll; wedges, cones and pianos get a convex
  outline that tumbles; boxy things are boxes.
- **Traits** (always on, up to two): floaty (low gravity), fragile (shatters into shards),
  sticky (glues itself to the first thing it hits), magnetic (pulls blocks toward it),
  piercing (punches through wood and glass).
- **Ability** (click or press space mid-air, at most one): explode, split into three,
  rocket, grow to nearly double size, dive straight down, boomerang back, vortex
  (a whirlpool that drags blocks in), or shoot what the object fires, sprays or breathes.
- **Matter**: what it is made of and carries, on nine scales: heat (freezing to burning),
  how readily it burns, explodes and melts, how wet it is, the live electricity it carries,
  how well it conducts, how corrosive it is, and how readily corrosion eats it. Whatever
  it fires is rated the same way.

## Chemistry

Everything in a level is rated on the same nine scales: the Forge's objects and what they
fire, the wood, stone and glass, and the bugs. One set of laws works between any two
things that touch, whatever they are; nothing is decided by name.

- Heat sets alight what burns, thaws what is frozen, melts what melts and dries what is wet.
  What burns is eaten away, and is as hot as fire while it burns, so fire spreads to what
  touches it.
- What explodes goes off a moment after it is lit, or at once when shocked. Its blast is hot.
- Cold puts fire out and freezes things, wet ones fastest. What is frozen is brittle and
  breaks at a fraction of the knock.
- Water puts fire out, soaks in (soaked things won't light), and carries electricity.
- Electricity runs through whatever conducts and through wet things, jolting all it
  reaches: it kills what lives, lights what explodes, and its sparks set alight what burns.
- Acid eats what dissolves, and keeps eating where it splashed.
- What breaks or bursts open spills what it held, hot, cold, wet, live or corrosive, on
  what is near.

So an oil barrel left by a tower, then something hot flung at it, sets the tower alight
and blows it apart; water on the fire puts it out; a battery dropped on an iron bar
shocks the bug at the other end.

## How it draws

On the desktop the game is drawn as SVG (`hooks/vector.ts`): the Forge's drawing spins
through the air, blocks crack as they wear, and the bugs watch your shot. The game's
`Client` lies invisible over the picture, taking the drags, clicks and keys and posting
each frame. In the terminal the same game is drawn in half-block cells.

Each forged object is one Sonnet call billed to your Claude Code session; it takes a few
seconds. If the model can't be reached, the Forge improvises from the words.
