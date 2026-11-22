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

In Claude Code, run:

```
/plugin install prompt-and-destroy --marketplace AliAl-Gburi/prompt-and-destroy
```

Or from a copy of this folder: put it at `~/.claude/skills/prompt-and-destroy/` and
start a new Claude Code session.

## Play

- `/prompt-and-destroy` opens the game; `/prompt-and-destroy reset` starts over at level 1.
- Type in the Forge field and press Enter to make your next shot.
- Drag anywhere on the playfield to aim, release to fling. Or click the playfield and use
  ↑↓ for angle, ←→ for power, space to fling.
- Seven handmade levels, then endless generated ones in six styles (bug nests, timber
  yards, glass works, stone forts, steel mills, bunker lines). Progress and best score
  are kept.

## What the Forge decides

- **Shape**: round things are circles and roll; wedges, cones and pianos get a convex
  outline that tumbles; boxy things are boxes.
- **Traits** (always on, up to two): floaty (low gravity), fragile (shatters into shards),
  sticky (glues itself to the first thing it hits), magnetic (pulls what has iron in it,
  steel above all), piercing (punches through wood, glass and bugs).
- **Ability** (click or press space mid-air, at most one): explode, split into three,
  rocket, grow to nearly double size, dive straight down, boomerang (whip back fast and
  flat at the height you click, through a tower you overshot), vortex (a whirlpool that
  drags blocks in), or shoot what the object fires, sprays or breathes.
- **Matter**: what it is made of and carries, on twelve scales: heat (freezing to burning),
  how readily it burns, explodes and melts, how wet it is, the live electricity it carries,
  how well it conducts, how corrosive it is, how readily corrosion eats it, how hard it
  is, how sharp an edge it has, and how much iron is in it. Whatever it fires is rated
  the same way.

## Chemistry and knocks

Everything in a level is rated on the same twelve scales: the Forge's objects and what
they fire, the blocks, and the bugs. One set of laws works between any two things that
touch, whatever they are; nothing is decided by name.

The levels are built of wood (soft, it burns and splits), stone and concrete (hard and
heavy; acid eats them, and concrete has steel bars in it), glass (it breaks at a touch)
and steel (it shrugs off blows and will not burn, but acid eats it, it carries electricity
and heat, and magnets pull it).

- A blow hurts by how much harder the striker is than what it strikes: a pillow bounces
  off concrete and still squashes a bug; an anvil cracks concrete and smashes wood.
- A hard, sharp edge cuts clean through what is softer than itself: a sword goes through
  wood and bugs, and stops at steel. Blunt, it only knocks.
- Magnets pull what has iron in it: steel above all, concrete's bars a little, wood not at all.
- Heat sets alight what burns, thaws what is frozen and dries what is wet, and melts what
  melts once past its melting point: ice at a little warmth, plastic only in a fire.
  Burning things are as hot as fire, so fire spreads to what touches them. What has burnt
  is left charred: blackened, weaker, and with nothing left to catch fire again.
- What conducts electricity carries heat too: steel heated at one end glows, burns what
  touches it, and hisses when water hits it.
- What explodes goes off a moment after it is lit, or at once when shocked. Its blast is hot.
- Cold puts fire out and freezes things, wet ones fastest. What is frozen is brittle and
  breaks at a fraction of the knock.
- Water puts fire out, soaks in (soaked things won't light), and carries electricity.
- Electricity runs through whatever conducts and through wet things, jolting all it
  reaches: it kills what lives, lights what explodes, and its sparks set alight what burns.
- Acid eats what dissolves, and keeps eating where it splashed. What acid or melting has
  eaten into holds less: a half-eaten steel post breaks at a knock it shrugged off whole.
- What breaks or bursts open spills what it held, hot, cold, wet, live or corrosive, on
  what is near.

So an oil barrel left by a tower, then something hot flung at it, sets the tower alight
and blows it apart; water on the fire puts it out; a battery dropped on an iron bar
shocks the bug at the other end; acid on a steel cage eats its posts until it comes down
on the bug inside.

## How it draws

On the desktop the game is drawn as SVG (`hooks/vector.ts`): the Forge's drawing spins
through the air, and the bugs watch your shot. Each material shows its own damage: wood
splits along its grain, stone cracks, concrete cracks and spalls to its bars, glass stars,
steel dents and buckles; acid leaves pits, rusting on steel, and hot steel glows. A shot's
whole flight is worked out when it leaves the sling and played as one SMIL animation,
keyed only where the motion needs it, so even a busy flight keeps every frame, spark and
drawing.
Between shots the scene lives: bugs breathe and blink, clouds drift and stars twinkle, all
kept in step from picture to picture. A cleared level rains confetti; bugs that got away
hop for joy.
The game's `Client` lies invisible over the picture, taking the drags, clicks and keys and
posting each frame. In the terminal the same game is drawn in half-block cells.

Each forged object is one Sonnet call billed to your Claude Code session; it takes a few
seconds. If the model can't be reached, the Forge improvises from the words.
